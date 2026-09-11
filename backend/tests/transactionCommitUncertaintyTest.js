import assert from 'node:assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { InventoryAdjustment } from '../src/models/InventoryAdjustment.js';
import { Order } from '../src/models/Order.js';
import { placeOrder } from '../src/services/orderService.js';
import { setStockAtomic } from '../src/services/inventoryService.js';
import {
  withTransactionRetry,
  isTransientTransactionError,
  isUnknownCommitResult
} from '../src/utils/transactionRetry.js';
import { DELIVERY_METHODS } from '../src/config/constants.js';

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

async function runUncertaintyTests() {
  console.log('================================================================');
  console.log('  MERYA DZ — TRANSACTION COMMIT UNCERTAINTY TEST SUITE');
  console.log('================================================================\n');

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(DB_URI);
  }

  // Setup test category
  let category = await Category.findOne({ slug: 'commit-uncertainty-cat' });
  if (!category) {
    category = await Category.create({
      name: 'Uncertainty Test Category',
      slug: 'commit-uncertainty-cat',
      description: 'Category for commit uncertainty verification',
      image: 'https://example.com/cat.jpg'
    });
  }

  // ── TEST 1: UnknownTransactionCommitResult handled at commit-level without re-running workFn ──
  console.log('── Test 1: UnknownTransactionCommitResult retried at commit level (workFn run ONCE) ──');
  try {
    const product1 = await Product.create({
      name: 'Uncertainty Product 1',
      slug: `uncert-prod-1-${Date.now()}`,
      description: 'Uncertainty Product Description',
      category: category._id,
      sellingPrice: 5000,
      costPrice: 2500,
      isActive: true,
      colors: [
        {
          colorName: 'Bleu',
          colorCode: '#0000FF',
          images: ['https://example.com/bleu.jpg'],
          sizes: [{ size: 'L', stock: 20 }]
        }
      ]
    });

    const session1 = await mongoose.startSession();
    let callbackExecutionCount = 0;
    let commitCallCount = 0;

    // Intercept commitTransaction on this session:
    // First commit attempt throws UnknownTransactionCommitResult (simulating network timeout after commit was received).
    // Second commit attempt calls real commitTransaction and succeeds.
    const origCommit = session1.commitTransaction.bind(session1);
    session1.commitTransaction = async function (...args) {
      commitCallCount++;
      if (commitCallCount === 1) {
        const err = new Error('Simulated network timeout: commit acknowledgment lost');
        err.errorLabels = ['UnknownTransactionCommitResult'];
        err.hasErrorLabel = (label) => label === 'UnknownTransactionCommitResult';
        throw err;
      }
      return origCommit(...args);
    };

    const result = await withTransactionRetry(async (txSession) => {
      callbackExecutionCount++;

      // 1. Perform CAS stock update
      const updated = await Product.findOneAndUpdate(
        {
          _id: product1._id,
          __v: 0,
          'colors.colorName': 'Bleu',
          'colors.sizes.size': 'L'
        },
        {
          $set: { 'colors.$[c].sizes.$[s].stock': 15 },
          $inc: { __v: 1 }
        },
        {
          arrayFilters: [{ 'c.colorName': 'Bleu' }, { 's.size': 'L' }],
          new: true,
          session: txSession
        }
      );

      // 2. Insert audit record
      const [audit] = await InventoryAdjustment.create(
        [
          {
            productId: product1._id,
            colorName: 'Bleu',
            size: 'L',
            previousStock: 20,
            newStock: 15,
            admin: 'CommitTester',
            timestamp: new Date(),
            reason: 'Commit uncertainty test'
          }
        ],
        { session: txSession }
      );

      return { updated, audit };
    }, { session: session1, maxRetries: 3 });

    await session1.endSession();

    // Verification 1: Callback must NOT have been executed twice
    assert.strictEqual(
      callbackExecutionCount,
      1,
      `Business callback MUST execute exactly once, but executed ${callbackExecutionCount} times`
    );

    // Verification 2: Commit was retried at commit level
    assert.strictEqual(
      commitCallCount,
      2,
      `commitTransaction must have been retried (expected 2 calls, got ${commitCallCount})`
    );

    // Verification 3: Stock in DB was changed exactly once (20 → 15)
    const dbProd1 = await Product.findById(product1._id);
    const szL = dbProd1.colors[0].sizes.find(s => s.size === 'L');
    assert.strictEqual(szL.stock, 15, 'Stock must be exactly 15 (single deduction of 5)');
    assert.strictEqual(dbProd1.__v, 1, 'Version must be incremented exactly once (__v = 1)');

    // Verification 4: Audit records in DB must contain exactly 1 entry
    const audits1 = await InventoryAdjustment.find({ productId: product1._id, size: 'L' });
    assert.strictEqual(audits1.length, 1, 'Audit history must contain exactly one entry');
    assert.strictEqual(audits1[0].previousStock, 20);
    assert.strictEqual(audits1[0].newStock, 15);

    pass('UnknownTransactionCommitResult resolved at commit level without re-executing callback; exactly 1 stock change and 1 audit');
  } catch (err) {
    fail('UnknownTransactionCommitResult commit-level retry', err);
  }

  // ── TEST 2: Persistent UnknownTransactionCommitResult halts without re-executing callback ──
  console.log('\n── Test 2: Unresolved commit uncertainty fails without re-executing business callback ──');
  try {
    const product2 = await Product.create({
      name: 'Uncertainty Product 2',
      slug: `uncert-prod-2-${Date.now()}`,
      description: 'Uncertainty Product Description',
      category: category._id,
      sellingPrice: 4500,
      costPrice: 2000,
      isActive: true,
      colors: [
        {
          colorName: 'Vert',
          colorCode: '#00FF00',
          images: ['https://example.com/vert.jpg'],
          sizes: [{ size: 'M', stock: 30 }]
        }
      ]
    });

    const session2 = await mongoose.startSession();
    let callbackExecutionCount = 0;

    // Intercept withTransaction to simulate driver executing workFn once, then failing
    // commit with UnknownTransactionCommitResult (e.g. after internal driver commit retries fail)
    session2.withTransaction = async function (fn) {
      await fn(session2);
      const err = new Error('Persistent UnknownTransactionCommitResult: commit outcome unknown');
      err.errorLabels = ['UnknownTransactionCommitResult'];
      err.hasErrorLabel = (label) => label === 'UnknownTransactionCommitResult';
      throw err;
    };

    let caughtError = null;
    try {
      await withTransactionRetry(async (txSession) => {
        callbackExecutionCount++;
        // Simulate work
        return 'DONE';
      }, { session: session2, maxRetries: 5 });
    } catch (err) {
      caughtError = err;
    } finally {
      await session2.endSession().catch(() => {});
    }

    assert.ok(caughtError, 'Must re-throw UnknownTransactionCommitResult');
    assert.ok(
      isUnknownCommitResult(caughtError),
      'Caught error must be classified as UnknownTransactionCommitResult'
    );
    assert.strictEqual(
      isTransientTransactionError(caughtError),
      false,
      'UnknownTransactionCommitResult must NOT be classified as a transient error'
    );

    // CRITICAL: withTransactionRetry must NOT have re-executed the callback!
    assert.strictEqual(
      callbackExecutionCount,
      1,
      `Callback must have executed only ONCE, never restarted (executed ${callbackExecutionCount})`
    );

    pass('Unresolved UnknownTransactionCommitResult halted immediately without re-executing callback');
  } catch (err) {
    fail('Persistent commit uncertainty failure', err);
  }

  // ── TEST 3: Genuine TransientTransactionError safely retries business callback ──
  console.log('\n── Test 3: Genuine TransientTransactionError safely retries business callback ──');
  try {
    const product3 = await Product.create({
      name: 'Transient Retry Product 3',
      slug: `trans-prod-3-${Date.now()}`,
      description: 'Transient Product Description',
      category: category._id,
      sellingPrice: 6000,
      costPrice: 3000,
      isActive: true,
      colors: [
        {
          colorName: 'Rose',
          colorCode: '#FF69B4',
          images: ['https://example.com/rose.jpg'],
          sizes: [{ size: 'S', stock: 10 }]
        }
      ]
    });

    let attempts = 0;
    const result = await withTransactionRetry(async (session, attempt) => {
      attempts++;
      if (attempt === 1) {
        // First attempt encounters a transient write conflict before commit
        const transientErr = new Error('Write conflict on collection due to concurrent operation');
        transientErr.code = 112;
        transientErr.codeName = 'WriteConflict';
        transientErr.errorLabels = ['TransientTransactionError'];
        transientErr.hasErrorLabel = (label) => label === 'TransientTransactionError';
        throw transientErr;
      }

      // Second attempt succeeds: perform stock mutation
      const updated = await Product.findOneAndUpdate(
        {
          _id: product3._id,
          'colors.colorName': 'Rose',
          'colors.sizes.size': 'S'
        },
        {
          $set: { 'colors.$[c].sizes.$[s].stock': 7 },
          $inc: { __v: 1 }
        },
        {
          arrayFilters: [{ 'c.colorName': 'Rose' }, { 's.size': 'S' }],
          new: true,
          session
        }
      );

      await InventoryAdjustment.create(
        [
          {
            productId: product3._id,
            colorName: 'Rose',
            size: 'S',
            previousStock: 10,
            newStock: 7,
            admin: 'TransientTester',
            timestamp: new Date(),
            reason: 'Transient retry test'
          }
        ],
        { session }
      );

      return updated;
    }, { maxRetries: 3, initialDelayMs: 10 });

    assert.strictEqual(attempts, 2, 'Must have attempted exactly 2 times');
    assert.ok(result, 'Must return result of successful attempt 2');

    // Verify DB stock was modified exactly ONCE (not twice)
    const dbProd3 = await Product.findById(product3._id);
    const szS = dbProd3.colors[0].sizes.find(s => s.size === 'S');
    assert.strictEqual(szS.stock, 7, 'Stock must be exactly 7 (single update)');
    assert.strictEqual(dbProd3.__v, 1, 'Version must be 1');

    // Verify audit collection has exactly ONE record
    const audits3 = await InventoryAdjustment.find({ productId: product3._id, size: 'S' });
    assert.strictEqual(audits3.length, 1, 'Audit history must contain exactly one record');

    pass('Genuine TransientTransactionError safely retried; exactly 1 final stock change and 1 audit record');
  } catch (err) {
    fail('Genuine TransientTransactionError retry safety', err);
  }

  // ── TEST 4: Idempotency safety: Checkout retry cannot create duplicate orders or deductions ──
  console.log('\n── Test 4: Idempotency safety under transaction execution ──');
  try {
    const product4 = await Product.create({
      name: 'Idempotent Product 4',
      slug: `idem-prod-4-${Date.now()}`,
      description: 'Idempotent Product Description',
      category: category._id,
      sellingPrice: 3000,
      costPrice: 1500,
      isActive: true,
      colors: [
        {
          colorName: 'Blanc',
          colorCode: '#FFFFFF',
          images: ['https://example.com/blanc.jpg'],
          sizes: [{ size: 'M', stock: 15 }]
        }
      ]
    });

    const idempotencyKey = `idem-uncertainty-key-${Date.now()}`;
    const orderPayload = {
      customer: {
        fullName: 'Idempotency User',
        phone: '0661223344',
        wilaya: { code: 16, name: 'Algiers' },
        deliveryMethod: DELIVERY_METHODS.AGENCY,
        agencyName: 'ZR Express Bab Ezzouar'
      },
      items: [
        {
          productId: product4._id.toString(),
          colorName: 'Blanc',
          size: 'M',
          quantity: 2
        }
      ],
      idempotencyKey
    };

    // First placement
    const firstRes = await placeOrder(orderPayload);
    assert.strictEqual(firstRes.isDuplicate, false);

    // Second concurrent/retry placement with identical idempotencyKey
    const secondRes = await placeOrder(orderPayload);
    assert.strictEqual(secondRes.isDuplicate, true);
    assert.strictEqual(secondRes.order._id.toString(), firstRes.order._id.toString());

    // Verify database invariants:
    // 1. Exactly 1 order in DB
    const orderCount = await Order.countDocuments({ idempotencyKey });
    assert.strictEqual(orderCount, 1, 'Exactly 1 order document must exist');

    // 2. Stock deducted exactly ONCE: 15 - 2 = 13
    const dbProd4 = await Product.findById(product4._id);
    const szM = dbProd4.colors[0].sizes.find(s => s.size === 'M');
    assert.strictEqual(szM.stock, 13, 'Stock must be 13 (deducted exactly once)');

    // 3. Order audit history has exactly 1 ORDER_PLACED entry
    const savedOrder = await Order.findById(firstRes.order._id);
    const placedAudits = savedOrder.auditHistory.filter(a => a.action === 'ORDER_PLACED');
    assert.strictEqual(placedAudits.length, 1, 'Exactly one ORDER_PLACED audit entry in order history');

    pass('Idempotency protection remains 100% intact: exactly 1 order, 1 stock deduction, 1 audit entry');
  } catch (err) {
    fail('Idempotency safety under retry', err);
  }

  // ── TEST 5: Permanent validation error aborts immediately (0 retries, 0 stock changes, 0 audits) ──
  console.log('\n── Test 5: Permanent validation errors abort immediately without retry ──');
  try {
    let attempts = 0;
    await assert.rejects(
      async () => {
        await withTransactionRetry(async () => {
          attempts++;
          throw new Error('INSUFFICIENT_STOCK: Requested 50, available 10');
        }, { maxRetries: 5 });
      },
      /INSUFFICIENT_STOCK/
    );

    assert.strictEqual(attempts, 1, 'Permanent validation error must abort after attempt 1');
    pass('Permanent errors abort immediately on attempt 1 without retry');
  } catch (err) {
    fail('Permanent error abort', err);
  }

  await mongoose.disconnect();

  console.log('\n================================================================');
  console.log(`TRANSACTION COMMIT UNCERTAINTY TEST SUITE: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runUncertaintyTests().catch((err) => {
  console.error('Fatal in transactionCommitUncertaintyTest:', err);
  process.exit(1);
});
