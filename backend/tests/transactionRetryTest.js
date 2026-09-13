import assert from 'node:assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { Order } from '../src/models/Order.js';
import { placeOrder, updateOrderStatus } from '../src/services/orderService.js';
import { wsService } from '../src/services/websocketService.js';
import { withTransactionRetry, isTransientTransactionError, isUnknownCommitResult } from '../src/utils/transactionRetry.js';
import { ORDER_STATUS, DELIVERY_METHODS } from '../src/config/constants.js';

dotenv.config();

const DB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27018/merya_dz?replicaSet=rs0&directConnection=true';

let passCount = 0;
let failCount = 0;

function pass(name) {
  console.log(`  ✓ ${name}`);
  passCount++;
}

function fail(name, err) {
  console.error(`  ✗ FAIL: ${name}`, err?.message || err);
  failCount++;
}

async function runTests() {
  console.log('================================================================');
  console.log('  MERYA DZ — TRANSACTION RETRY SAFETY & IDEMPOTENCY TEST SUITE');
  console.log('================================================================\n');

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(DB_URI);
  }

  // Ensure test category
  let category = await Category.findOne({ slug: 'tx-retry-test-cat' });
  if (!category) {
    category = await Category.create({
      name: 'Tx Retry Category',
      slug: 'tx-retry-test-cat',
      description: 'Tx Retry Category',
      image: 'https://example.com/cat.jpg'
    });
  }

  // ── TEST 1: isTransientTransactionError correctly identifies transient conditions ──
  console.log('── Test 1: Transient error classifier ──');
  try {
    const errLabel = new Error('WriteConflict');
    errLabel.errorLabels = ['TransientTransactionError'];
    assert.strictEqual(isTransientTransactionError(errLabel), true);

    const errCode112 = new Error('Write conflict on doc');
    errCode112.code = 112;
    errCode112.codeName = 'WriteConflict';
    assert.strictEqual(isTransientTransactionError(errCode112), true);

    const errLockTimeout = new Error('Unable to acquire IX lock on collection');
    assert.strictEqual(isTransientTransactionError(errLockTimeout), true);

    const nonTransientErr = new Error('Insufficient stock for item');
    assert.strictEqual(isTransientTransactionError(nonTransientErr), false);

    const conflictErr = new Error('CONCURRENT_CONFLICT: Order modified');
    assert.strictEqual(isTransientTransactionError(conflictErr), false);

    // Critical check: UnknownTransactionCommitResult MUST NOT be classified as a transient retryable error!
    const unknownCommitErr = new Error('Commit outcome uncertain');
    unknownCommitErr.errorLabels = ['UnknownTransactionCommitResult'];
    assert.strictEqual(isUnknownCommitResult(unknownCommitErr), true);
    assert.strictEqual(isTransientTransactionError(unknownCommitErr), false, 'UnknownTransactionCommitResult must NEVER be classified as a transient retry error');

    pass('isTransientTransactionError accurately classifies transient vs permanent errors, excluding commit uncertainty');
  } catch (err) {
    fail('isTransientTransactionError classification', err);
  }

  // ── TEST 2: withTransactionRetry retries on transient errors and bounds retries ──
  console.log('\n── Test 2: Bounded retry execution ──');
  try {
    let attempts = 0;
    const result = await withTransactionRetry(async (session, attempt) => {
      attempts++;
      if (attempt === 1) {
        const transientErr = new Error('Transient error attempt 1');
        transientErr.errorLabels = ['TransientTransactionError'];
        throw transientErr;
      }
      return 'SUCCESS_AFTER_RETRY';
    }, { maxRetries: 3, initialDelayMs: 10 });

    assert.strictEqual(attempts, 2, 'Must have attempted exactly 2 times');
    assert.strictEqual(result, 'SUCCESS_AFTER_RETRY', 'Must succeed on attempt 2');
    pass('withTransactionRetry retried transient failure and completed successfully on attempt 2');
  } catch (err) {
    fail('Bounded retry execution', err);
  }

  // ── TEST 3: withTransactionRetry aborts immediately on non-transient error (no infinite loop) ──
  console.log('\n── Test 3: Immediate abort on non-transient error ──');
  try {
    let attempts = 0;
    await assert.rejects(
      async () => {
        await withTransactionRetry(async () => {
          attempts++;
          throw new Error('PERMANENT_VALIDATION_ERROR: Cannot proceed');
        }, { maxRetries: 5 });
      },
      /PERMANENT_VALIDATION_ERROR/
    );

    assert.strictEqual(attempts, 1, 'Must abort after exactly 1 attempt on non-transient error');
    pass('withTransactionRetry aborts immediately on non-transient error without retry');
  } catch (err) {
    fail('Immediate abort on non-transient error', err);
  }

  // ── TEST 4: Bounded retry limit: Stops after maxRetries ──
  console.log('\n── Test 4: Bounded retry limit stops after maxRetries ──');
  try {
    let attempts = 0;
    await assert.rejects(
      async () => {
        await withTransactionRetry(async () => {
          attempts++;
          const err = new Error('Continuous WriteConflict');
          err.code = 112;
          err.codeName = 'WriteConflict';
          throw err;
        }, { maxRetries: 4, initialDelayMs: 10 });
      },
      /WriteConflict/
    );

    assert.strictEqual(attempts, 4, 'Must not retry past maxRetries');
    pass('withTransactionRetry halts at maxRetries without infinite loop');
  } catch (err) {
    fail('Bounded retry limit', err);
  }

  // ── TEST 5: Checkout transaction retry safety: No duplicate orders, no duplicate deductions ──
  console.log('\n── Test 5: Checkout transaction retry safety ──');
  try {
    const product = await Product.create({
      name: 'Tx Test Product',
      slug: `tx-test-product-${Date.now()}`,
      description: 'Tx Test Product Description',
      category: category._id,
      sellingPrice: 4000,
      costPrice: 2000,
      isActive: true,
      colors: [
        {
          colorName: 'Noir',
          colorCode: '#000000',
          images: ['https://example.com/img.jpg'],
          sizes: [{ size: 'M', stock: 10 }]
        }
      ]
    });

    // Mock wsService.broadcastNewOrder to track broadcasts
    let broadcastCount = 0;
    const origBroadcast = wsService.broadcastNewOrder;
    wsService.broadcastNewOrder = () => {
      broadcastCount++;
    };

    const idempotencyKey = `tx-retry-key-${Date.now()}`;
    const { order, isDuplicate } = await placeOrder({
      customer: {
        fullName: 'Tx Retry User',
        phone: '0555112233',
        wilaya: { code: 16, name: 'Algiers' },
        deliveryMethod: DELIVERY_METHODS.AGENCY,
        agencyName: 'Yalidine Kouba'
      },
      items: [
        {
          productId: product._id.toString(),
          colorName: 'Noir',
          size: 'M',
          quantity: 2
        }
      ],
      idempotencyKey
    });

    assert.strictEqual(isDuplicate, false);
    assert.strictEqual(broadcastCount, 1, 'Exactly 1 WebSocket broadcast must be sent after successful commit');

    // Check DB stock: 10 - 2 = 8
    const updatedProd = await Product.findById(product._id);
    const stockM = updatedProd.colors[0].sizes.find(s => s.size === 'M').stock;
    assert.strictEqual(stockM, 8, 'DB stock must be exactly 8 (single deduction)');

    // Ensure only 1 order exists with this idempotency key
    const orderCount = await Order.countDocuments({ idempotencyKey });
    assert.strictEqual(orderCount, 1, 'Exactly 1 order must be created in DB');

    // Restore wsService
    wsService.broadcastNewOrder = origBroadcast;

    pass('Checkout transaction completed with single stock deduction, single order, and single broadcast');
  } catch (err) {
    fail('Checkout transaction retry safety', err);
  }

  // ── TEST 6: Order cancellation transaction safety: No double restoration, single broadcast ──
  console.log('\n── Test 6: Order cancellation transaction safety ──');
  try {
    const prod = await Product.create({
      name: 'Cancel Test Product',
      slug: `cancel-test-prod-${Date.now()}`,
      description: 'Cancel Test Product Description',
      category: category._id,
      sellingPrice: 3000,
      costPrice: 1500,
      isActive: true,
      colors: [
        {
          colorName: 'Bleu',
          colorCode: '#0000FF',
          images: ['https://example.com/img.jpg'],
          sizes: [{ size: 'L', stock: 5 }]
        }
      ]
    });

    const { order: testOrder } = await placeOrder({
      idempotencyKey: `tx-cancel-key-${Date.now()}`,
      customer: {
        fullName: 'Cancel User',
        phone: '0555334455',
        wilaya: { code: 16, name: 'Algiers' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: '10 Rue de la Liberte'
      },
      items: [
        {
          productId: prod._id.toString(),
          colorName: 'Bleu',
          size: 'L',
          quantity: 2
        }
      ]
    });

    // Stock should be 5 - 2 = 3
    let pAfterPlace = await Product.findById(prod._id);
    assert.strictEqual(pAfterPlace.colors[0].sizes[0].stock, 3);

    // Track status broadcast
    let statusBroadcastCount = 0;
    const origStatusBroadcast = wsService.broadcastOrderStatus;
    wsService.broadcastOrderStatus = () => {
      statusBroadcastCount++;
    };

    // Cancel order
    const cancelledOrder = await updateOrderStatus(testOrder._id.toString(), ORDER_STATUS.CANCELLED, 'Admin', 'Customer requested cancellation');

    assert.strictEqual(cancelledOrder.status, ORDER_STATUS.CANCELLED);
    assert.strictEqual(cancelledOrder.stockRestored, true);
    assert.strictEqual(statusBroadcastCount, 1, 'Exactly 1 status broadcast emitted post-commit');

    // Check stock restored: 3 + 2 = 5
    let pAfterCancel = await Product.findById(prod._id);
    assert.strictEqual(pAfterCancel.colors[0].sizes[0].stock, 5, 'Stock restored exactly once to 5');

    // Attempt to transition cancelled order to Cancelled again
    await assert.rejects(
      async () => {
        await updateOrderStatus(testOrder._id.toString(), ORDER_STATUS.CANCELLED, 'Admin');
      },
      /Cannot transition order/
    );

    // Verify stock was NOT restored again (remains 5)
    let pAfterSecond = await Product.findById(prod._id);
    assert.strictEqual(pAfterSecond.colors[0].sizes[0].stock, 5, 'Stock must not be restored twice');

    wsService.broadcastOrderStatus = origStatusBroadcast;
    pass('Order cancellation restored stock exactly once without double restoration');
  } catch (err) {
    fail('Order cancellation transaction safety', err);
  }

  await mongoose.disconnect();

  console.log('\n================================================================');
  console.log(`TRANSACTION RETRY TEST SUITE: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in transactionRetryTest:', err);
  process.exit(1);
});
