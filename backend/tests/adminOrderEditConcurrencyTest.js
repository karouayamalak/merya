import assert from 'node:assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { Order } from '../src/models/Order.js';
import { placeOrder, updateOrderStatus } from '../src/services/orderService.js';
import { updateOrderCustomerDetails } from '../src/controllers/orderController.js';
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

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

async function runConcurrencyTests() {
  console.log('================================================================');
  console.log('  MERYA DZ — ADMIN ORDER-EDIT CONCURRENCY & PROTECTION TEST SUITE');
  console.log('================================================================\n');

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(DB_URI);
  }

  let cat = await Category.findOne({ slug: 'admin-edit-cat' });
  if (!cat) {
    cat = await Category.create({
      name: 'Admin Edit Category',
      slug: 'admin-edit-cat',
      description: 'Admin edit test',
      image: 'https://example.com/cat.jpg'
    });
  }

  const prod = await Product.create({
    name: 'Admin Edit Test Product',
    slug: `admin-edit-prod-${Date.now()}`,
    description: 'Product for admin edit testing',
    category: cat._id,
    sellingPrice: 5000,
    costPrice: 2500,
    isActive: true,
    colors: [
      {
        colorName: 'Noir',
        colorCode: '#000000',
        images: ['https://example.com/noir.jpg'],
        sizes: [{ size: 'M', stock: 10 }]
      }
    ]
  });

  // ── TEST 1: Two simultaneous admin edits to customer details: One 200, One 409 CONCURRENT_CONFLICT ──
  console.log('── Test 1: Concurrent admin edits on updateOrderCustomerDetails ──');
  try {
    const { order } = await placeOrder({
      customer: {
        fullName: 'Initial Customer Name',
        phone: '0555001122',
        wilaya: { code: 16, name: 'Algiers' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: '100 Initial St, Algiers'
      },
      items: [{ productId: prod._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }]
    });

    const initialVersion = order.__v;

    // Both Admin 1 and Admin 2 send updates simultaneously with expectedVersion = initialVersion
    const res1 = mockRes();
    const res2 = mockRes();

    const p1 = updateOrderCustomerDetails(
      {
        params: { id: order._id.toString() },
        body: {
          fullName: 'Admin 1 Updated Name',
          expectedVersion: initialVersion
        },
        admin: { username: 'Admin1' }
      },
      res1,
      (err) => { if (err) throw err; }
    );

    const p2 = updateOrderCustomerDetails(
      {
        params: { id: order._id.toString() },
        body: {
          fullName: 'Admin 2 Updated Name',
          expectedVersion: initialVersion
        },
        admin: { username: 'Admin2' }
      },
      res2,
      (err) => { if (err) throw err; }
    );

    await Promise.all([p1, p2]);

    const responses = [res1, res2];
    const successes = responses.filter(r => r.statusCode === 200);
    const conflicts = responses.filter(r => r.statusCode === 409);

    assert.strictEqual(successes.length, 1, 'Exactly one concurrent edit must succeed with 200');
    assert.strictEqual(conflicts.length, 1, 'Exactly one concurrent edit must conflict with 409');

    const conflictRes = conflicts[0];
    assert.strictEqual(conflictRes.body.code, 'CONCURRENT_CONFLICT', '409 response must include code: CONCURRENT_CONFLICT');
    assert.ok(conflictRes.body.message.includes('CONCURRENT_CONFLICT'), 'Error message must specify CONCURRENT_CONFLICT');

    // Verify DB matches the winner's data
    const finalOrder = await Order.findById(order._id);
    const winnerName = successes[0].body.order.customer.fullName;
    assert.strictEqual(finalOrder.customer.fullName, winnerName);
    assert.strictEqual(finalOrder.__v, initialVersion + 1, 'Order version must have incremented by exactly 1');

    pass('Two simultaneous modifications: exactly one 200 and one 409 CONCURRENT_CONFLICT');
  } catch (err) {
    fail('Concurrent admin edits test', err);
  }

  // ── TEST 2: Delivered order historical financial protection under edit requests ──
  console.log('\n── Test 2: Delivered order historical financial protection ──');
  try {
    const { order: delivOrder } = await placeOrder({
      customer: {
        fullName: 'Delivered User',
        phone: '0555332211',
        wilaya: { code: 16, name: 'Algiers' },
        deliveryMethod: DELIVERY_METHODS.AGENCY,
        agencyName: 'Yalidine Kouba'
      },
      items: [{ productId: prod._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }]
    });

    // Advance to Delivered
    await updateOrderStatus(delivOrder._id.toString(), ORDER_STATUS.CONFIRMED, 'Admin');
    await updateOrderStatus(delivOrder._id.toString(), ORDER_STATUS.ON_THE_WAY, 'Admin');
    await updateOrderStatus(delivOrder._id.toString(), ORDER_STATUS.DELIVERED, 'Admin');

    const freshDeliv = await Order.findById(delivOrder._id);
    assert.strictEqual(freshDeliv.status, ORDER_STATUS.DELIVERED);

    // Attempt 1: Try to modify deliveryFee on Delivered order
    const resFee = mockRes();
    await updateOrderCustomerDetails(
      {
        params: { id: delivOrder._id.toString() },
        body: {
          deliveryFee: 1500,
          overrideReason: 'Attempt to alter historical fee'
        },
        admin: { username: 'RogueAdmin' }
      },
      resFee,
      () => {}
    );

    assert.strictEqual(resFee.statusCode, 400, 'Modifying deliveryFee on Delivered order must be rejected with 400');
    assert.ok(resFee.body.message.includes('Historical financial values'), 'Error must specify historical financial values protection');

    // Attempt 2: Try to modify wilaya / delivery destination on Delivered order
    const resWilaya = mockRes();
    await updateOrderCustomerDetails(
      {
        params: { id: delivOrder._id.toString() },
        body: {
          wilaya: { code: 31, name: 'Oran' }
        },
        admin: { username: 'RogueAdmin' }
      },
      resWilaya,
      () => {}
    );

    assert.strictEqual(resWilaya.statusCode, 400, 'Modifying destination on Delivered order must be rejected with 400');
    assert.ok(resWilaya.body.message.includes('Delivery destination cannot be modified'), 'Error must specify destination protection');

    // Attempt 3: Concurrent attempt where one marks Delivered while other tries financial edit
    const unmodDeliv = await Order.findById(delivOrder._id);
    assert.strictEqual(unmodDeliv.deliveryFee, delivOrder.deliveryFee, 'Delivered order deliveryFee must remain unchanged');
    assert.strictEqual(unmodDeliv.customer.wilaya.code, 16, 'Delivered order Wilaya must remain unchanged');

    pass('Delivered order historical financial values and destination remain strictly immutable');
  } catch (err) {
    fail('Delivered order financial protection test', err);
  }

  // ── TEST 3: Strict Agency / Home delivery validation ──
  console.log('\n── Test 3: Strict checkout validation for Agency & Home delivery ──');
  try {
    // 1. Agency checkout with missing agencyName -> Rejects
    await assert.rejects(
      async () => {
        await placeOrder({
          customer: {
            fullName: 'Agency User',
            phone: '0555998877',
            wilaya: { code: 16, name: 'Algiers' },
            deliveryMethod: DELIVERY_METHODS.AGENCY
            // agencyName omitted!
          },
          items: [{ productId: prod._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }]
        });
      },
      /Agency name is required/
    );

    // 2. Agency checkout with empty/whitespace agencyName -> Rejects
    await assert.rejects(
      async () => {
        await placeOrder({
          customer: {
            fullName: 'Agency User',
            phone: '0555998877',
            wilaya: { code: 16, name: 'Algiers' },
            deliveryMethod: DELIVERY_METHODS.AGENCY,
            agencyName: '   '
          },
          items: [{ productId: prod._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }]
        });
      },
      /Agency name is required/
    );

    // 3. Home checkout with missing address -> Rejects
    await assert.rejects(
      async () => {
        await placeOrder({
          customer: {
            fullName: 'Home User',
            phone: '0555998877',
            wilaya: { code: 16, name: 'Algiers' },
            deliveryMethod: DELIVERY_METHODS.HOME
            // address omitted!
          },
          items: [{ productId: prod._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }]
        });
      },
      /Detailed delivery address is required/
    );

    // 4. Home checkout with too short address -> Rejects
    await assert.rejects(
      async () => {
        await placeOrder({
          customer: {
            fullName: 'Home User',
            phone: '0555998877',
            wilaya: { code: 16, name: 'Algiers' },
            deliveryMethod: DELIVERY_METHODS.HOME,
            address: 'Ab'
          },
          items: [{ productId: prod._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }]
        });
      },
      /Detailed delivery address is required/
    );

    pass('Strict agency/home checkout validation enforced (no invented agency names, no missing addresses)');
  } catch (err) {
    fail('Strict checkout validation test', err);
  }

  // Clean up
  await Product.deleteOne({ _id: prod._id });
  await Category.deleteOne({ _id: cat._id });

  await mongoose.disconnect();

  console.log('\n================================================================');
  console.log(`ADMIN CONCURRENCY TEST SUITE: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runConcurrencyTests().catch(err => {
  console.error('Fatal in adminOrderEditConcurrencyTest:', err);
  process.exit(1);
});
