/**
 * deliveryFeeIntegrityTest.js
 *
 * Targeted regression test suite for:
 * CRITICAL ISSUE #1 — DELIVERY FEE FALLBACK PREVENTION & FAIL-SAFE INTEGRITY
 * CRITICAL ISSUE #2 — ADMIN DELIVERY FEE TAMPERING PREVENTION VIA REAL HTTP/API ENDPOINTS
 *
 * Exercises the real production code paths:
 * Client Input -> Controller -> orderService -> MongoDB Transaction -> Database
 */

import assert from 'node:assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { Order } from '../src/models/Order.js';
import { DeliverySetting } from '../src/models/DeliverySetting.js';
import { placeOrder } from '../src/services/orderService.js';
import { checkout, updateOrderCustomerDetails } from '../src/controllers/orderController.js';
import { ORDER_STATUS, DELIVERY_METHODS, ALGERIA_WILAYAS } from '../src/config/constants.js';

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

async function runTests() {
  console.log('================================================================');
  console.log('  MERYA DZ — DELIVERY FEE INTEGRITY & TAMPERING REGRESSION SUITE');
  console.log('================================================================\n');

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(DB_URI);
  }

  // Setup test environment
  await Order.deleteMany({ 'customer.fullName': { $regex: /IntegrityTest/i } });
  await Product.deleteMany({ name: { $regex: /IntegrityProduct/i } });

  let testCategory = await Category.findOne();
  if (!testCategory) {
    testCategory = await Category.create({
      name: 'Integrity Category',
      slug: `integrity-cat-${Date.now()}`,
      description: 'Category for delivery fee tests',
      image: 'https://example.com/cat.jpg'
    });
  }

  // Create test product with stock = 20
  const testProduct = await Product.create({
    name: `IntegrityProduct-${Date.now()}`,
    slug: `integrity-prod-${Date.now()}`,
    description: 'Test product for delivery fee audit',
    category: testCategory._id,
    sellingPrice: 3000,
    costPrice: 1500,
    colors: [
      {
        colorName: 'Rose',
        colorCode: '#FF007F',
        images: ['https://example.com/rose.jpg'],
        sizes: [
          { size: 'M', stock: 20 },
          { size: 'L', stock: 20 }
        ]
      }
    ]
  });

  // Ensure DeliverySettings has all 58 Wilayas with distinct known rates
  // Wilaya 16 (Alger): home = 500, agency = 350
  // Wilaya 31 (Oran):  home = 750, agency = 450
  // Wilaya 9 (Blida):  home = 600, agency = 400
  let delSetting = await DeliverySetting.findOne();
  const allRates = ALGERIA_WILAYAS.map(w => {
    let homeFee = 800;
    let agencyFee = 500;
    if (w.code === 16) { homeFee = 500; agencyFee = 350; }
    if (w.code === 31) { homeFee = 750; agencyFee = 450; }
    if (w.code === 9)  { homeFee = 600; agencyFee = 400; }
    return {
      wilayaCode: w.code,
      wilayaName: w.name,
      wilayaNameAr: w.nameAr,
      homeFee,
      agencyFee,
      isAvailable: true
    };
  });

  if (!delSetting) {
    delSetting = await DeliverySetting.create({
      agencyDeliveryFee: 500,
      homeDeliveryFee: 800,
      freeDeliveryThreshold: 0,
      wilayaRates: allRates
    });
  } else {
    delSetting.wilayaRates = allRates;
    delSetting.freeDeliveryThreshold = 0;
    await delSetting.save();
  }

  console.log('── Test A: Valid Wilaya + Home Delivery (Authoritative Fee Used) ──');
  try {
    const res = mockRes();
    const req = {
      body: {
        idempotencyKey: `idem-del-fee-a-${Date.now()}`,
        customer: {
          fullName: 'IntegrityTest User Home',
          phone: '0551000001',
          wilaya: { code: 16, name: 'Alger' },
          deliveryMethod: 'home',
          address: '123 Didouche Mourad, Alger Centre'
        },
        items: [
          {
            productId: testProduct._id.toString(),
            colorName: 'Rose',
            size: 'M',
            quantity: 2
          }
        ]
      }
    };

    await checkout(req, res, () => {});
    assert.strictEqual(res.statusCode, 201, `Expected 201 Created, got ${res.statusCode}`);
    assert.strictEqual(res.body.deliveryFee, 500, 'Authoritative home delivery fee for Wilaya 16 must be 500 DZD');
    assert.strictEqual(res.body.subtotal, 6000, 'Subtotal must be 2 * 3000 = 6000 DZD');
    assert.strictEqual(res.body.totalPrice, 6500, 'Total must be 6000 + 500 = 6500 DZD');

    // Verify database persisted value
    const dbOrder = await Order.findOne({ orderCode: res.body.orderCode });
    assert.strictEqual(dbOrder.deliveryFee, 500, 'Persisted DB delivery fee must equal authoritative fee 500');
    assert.strictEqual(dbOrder.totalPrice, 6500, 'Persisted DB total must equal 6500');
    pass('Test A: Valid Wilaya + Home Delivery used authoritative fee (500 DZD) and persisted correctly');
  } catch (err) {
    fail('Test A', err);
  }

  console.log('\n── Test B: Valid Wilaya + Agency Delivery (Authoritative Agency Fee Used) ──');
  try {
    const res = mockRes();
    const req = {
      body: {
        idempotencyKey: `idem-del-fee-b-${Date.now()}`,
        customer: {
          fullName: 'IntegrityTest User Agency',
          phone: '0551000002',
          wilaya: { code: 31, name: 'Oran' },
          deliveryMethod: 'agency',
          agencyName: 'Yalidine Oran Medina'
        },
        items: [
          {
            productId: testProduct._id.toString(),
            colorName: 'Rose',
            size: 'M',
            quantity: 1
          }
        ]
      }
    };

    await checkout(req, res, () => {});
    assert.strictEqual(res.statusCode, 201, `Expected 201 Created, got ${res.statusCode}`);
    assert.strictEqual(res.body.deliveryFee, 450, 'Authoritative agency fee for Wilaya 31 must be 450 DZD');
    assert.strictEqual(res.body.subtotal, 3000, 'Subtotal must be 3000 DZD');
    assert.strictEqual(res.body.totalPrice, 3450, 'Total must be 3450 DZD');

    const dbOrder = await Order.findOne({ orderCode: res.body.orderCode });
    assert.strictEqual(dbOrder.deliveryFee, 450, 'Persisted DB delivery fee must equal authoritative fee 450');
    pass('Test B: Valid Wilaya + Agency Delivery used authoritative agency fee (450 DZD)');
  } catch (err) {
    fail('Test B', err);
  }

  console.log('\n── Test C: Missing / Unconfigured Wilaya Fee Fails Safely ──');
  try {
    // Temporarily remove Wilaya 47 (Ghardaïa) rate from DeliverySetting
    await DeliverySetting.updateOne(
      {},
      { $pull: { wilayaRates: { wilayaCode: 47 } } }
    );

    const stockBefore = (await Product.findById(testProduct._id)).colors[0].sizes.find(s => s.size === 'L').stock;

    const res = mockRes();
    const req = {
      body: {
        idempotencyKey: `idem-del-fee-c-${Date.now()}`,
        customer: {
          fullName: 'IntegrityTest Missing Wilaya',
          phone: '0551000003',
          wilaya: { code: 47, name: 'Ghardaïa' },
          deliveryMethod: 'home',
          address: 'Ksar de Ghardaïa'
        },
        items: [
          {
            productId: testProduct._id.toString(),
            colorName: 'Rose',
            size: 'L',
            quantity: 2
          }
        ]
      }
    };

    await checkout(req, res, () => {});
    assert.strictEqual(res.statusCode, 400, `Expected 400 Bad Request for unconfigured Wilaya, got ${res.statusCode}`);
    assert.ok(
      res.body.message.includes('Delivery configuration missing') || res.body.message.includes('not configured'),
      `Error message must indicate missing configuration: ${res.body.message}`
    );

    // Verify NO order created in database
    const createdOrder = await Order.findOne({ 'customer.fullName': 'IntegrityTest Missing Wilaya' });
    assert.strictEqual(createdOrder, null, 'No order must be created in DB when fee is unconfigured');

    // Verify stock is untouched (no inventory deduction)
    const stockAfter = (await Product.findById(testProduct._id)).colors[0].sizes.find(s => s.size === 'L').stock;
    assert.strictEqual(stockAfter, stockBefore, 'Stock must remain completely unchanged after rejected unconfigured fee');

    // Restore Wilaya 47 rate
    await DeliverySetting.updateOne(
      {},
      {
        $push: {
          wilayaRates: {
            wilayaCode: 47,
            wilayaName: 'Ghardaïa',
            wilayaNameAr: 'غرداية',
            homeFee: 1000,
            agencyFee: 700,
            isAvailable: true
          }
        }
      }
    );

    pass('Test C: Missing Wilaya fee failed safely with 400; zero order created; zero inventory deducted');
  } catch (err) {
    fail('Test C', err);
  }

  console.log('\n── Test D: Malicious Frontend Fee Tampering (deliveryFee: 1) Ignored by Server ──');
  try {
    const res = mockRes();
    // Attacker submits deliveryFee: 1 in request payload
    const req = {
      body: {
        idempotencyKey: `idem-del-fee-d-${Date.now()}`,
        deliveryFee: 1, // Malicious tamper
        customer: {
          fullName: 'IntegrityTest Tamper Attacker 1',
          phone: '0551000004',
          wilaya: { code: 16, name: 'Alger' },
          deliveryMethod: 'home',
          address: 'Bab El Oued'
        },
        items: [
          {
            productId: testProduct._id.toString(),
            colorName: 'Rose',
            size: 'M',
            quantity: 1
          }
        ]
      }
    };

    await checkout(req, res, () => {});
    assert.strictEqual(res.statusCode, 201, `Order creation response code: ${res.statusCode}`);
    assert.notStrictEqual(res.body.deliveryFee, 1, 'Client-supplied deliveryFee: 1 must NOT be accepted');
    assert.strictEqual(res.body.deliveryFee, 500, 'Server must enforce authoritative fee (500 DZD)');
    assert.strictEqual(res.body.totalPrice, 3500, 'Total price must be 3000 + 500 = 3500 DZD');

    const persisted = await Order.findOne({ orderCode: res.body.orderCode });
    assert.strictEqual(persisted.deliveryFee, 500, 'Persisted DB delivery fee must be authoritative 500, NOT 1');
    assert.strictEqual(persisted.totalPrice, 3500, 'Persisted DB total must be 3500, NOT 3001');
    pass('Test D: Client-supplied deliveryFee: 1 ignored; authoritative fee 500 persisted');
  } catch (err) {
    fail('Test D', err);
  }

  console.log('\n── Test E: Malicious Huge Fee Tampering (deliveryFee: 999999999) Cannot Alter Fee ──');
  try {
    const res = mockRes();
    const req = {
      body: {
        idempotencyKey: `idem-del-fee-e-${Date.now()}`,
        deliveryFee: 999999999, // Malicious huge fee
        customer: {
          fullName: 'IntegrityTest Tamper Attacker Huge',
          phone: '0551000005',
          wilaya: { code: 9, name: 'Blida' },
          deliveryMethod: 'home',
          address: 'Boufarik Centre'
        },
        items: [
          {
            productId: testProduct._id.toString(),
            colorName: 'Rose',
            size: 'M',
            quantity: 1
          }
        ]
      }
    };

    await checkout(req, res, () => {});
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.deliveryFee, 600, 'Server must enforce authoritative Blida fee 600 DZD');
    assert.notStrictEqual(res.body.deliveryFee, 999999999, 'Huge fee must be rejected/ignored');

    const persisted = await Order.findOne({ orderCode: res.body.orderCode });
    assert.strictEqual(persisted.deliveryFee, 600);
    assert.strictEqual(persisted.totalPrice, 3600);
    pass('Test E: Malicious huge fee 999999999 ignored; authoritative fee 600 persisted');
  } catch (err) {
    fail('Test E', err);
  }

  console.log('\n── Test F: Admin Editing Wilaya Recalculates Authoritative Fee & Ignores Client Fee ──');
  try {
    // Create an order in Wilaya 16 (home fee 500)
    const initialOrder = await placeOrder({
      idempotencyKey: `idem-del-fee-f-${Date.now()}`,
      customer: {
        fullName: 'IntegrityTest Edit Wilaya Order',
        phone: '0551000006',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: 'home',
        address: 'Hydra'
      },
      items: [
        {
          productId: testProduct._id.toString(),
          colorName: 'Rose',
          size: 'M',
          quantity: 1
        }
      ]
    });
    assert.strictEqual(initialOrder.order.deliveryFee, 500);

    // Admin updates Wilaya to 31 (Oran) AND maliciously passes deliveryFee: 50
    const resEdit = mockRes();
    const reqEdit = {
      params: { id: initialOrder.order._id.toString() },
      body: {
        wilaya: { code: 31, name: 'Oran' },
        deliveryFee: 50, // Tampered client value
        expectedVersion: initialOrder.order.__v
      },
      admin: { username: 'AdminAuditor' }
    };

    await updateOrderCustomerDetails(reqEdit, resEdit, () => {});
    assert.strictEqual(resEdit.statusCode, 200, `Admin update failed: ${resEdit.body?.message}`);

    const updatedOrder = await Order.findById(initialOrder.order._id);
    // Authoritative home fee for Oran (code 31) is 750 DZD
    assert.strictEqual(updatedOrder.deliveryFee, 750, 'Updated order delivery fee must be authoritative Oran rate 750 DZD');
    assert.notStrictEqual(updatedOrder.deliveryFee, 50, 'Client tampered deliveryFee: 50 must NOT be assigned');
    assert.strictEqual(updatedOrder.totalPrice, 3750, 'Total price must be recalculated to 3000 + 750 = 3750 DZD');
    pass('Test F: Changing Wilaya recalculated authoritative fee (750 DZD); client fee: 50 ignored');
  } catch (err) {
    fail('Test F', err);
  }

  console.log('\n── Test G: Admin Editing Delivery Method Recalculates Authoritative Method Fee ──');
  try {
    // Order in Oran (home fee = 750, agency fee = 450)
    const initialOrder = await placeOrder({
      idempotencyKey: `idem-del-fee-g-${Date.now()}`,
      customer: {
        fullName: 'IntegrityTest Edit Method Order',
        phone: '0551000007',
        wilaya: { code: 31, name: 'Oran' },
        deliveryMethod: 'home',
        address: 'Canastel'
      },
      items: [
        {
          productId: testProduct._id.toString(),
          colorName: 'Rose',
          size: 'M',
          quantity: 1
        }
      ]
    });
    assert.strictEqual(initialOrder.order.deliveryFee, 750);

    // Change delivery method from home to agency
    const resEdit = mockRes();
    const reqEdit = {
      params: { id: initialOrder.order._id.toString() },
      body: {
        deliveryMethod: 'agency',
        agencyName: 'Yalidine Oran Akid Lotfi',
        expectedVersion: initialOrder.order.__v
      },
      admin: { username: 'AdminAuditor' }
    };

    await updateOrderCustomerDetails(reqEdit, resEdit, () => {});
    assert.strictEqual(resEdit.statusCode, 200, `Admin update failed: ${resEdit.body?.message}`);

    const updatedOrder = await Order.findById(initialOrder.order._id);
    assert.strictEqual(updatedOrder.deliveryFee, 450, 'Delivery fee must be recalculated to agency fee (450 DZD)');
    assert.strictEqual(updatedOrder.totalPrice, 3450, 'Total price must be 3000 + 450 = 3450 DZD');
    pass('Test G: Changing delivery method recalculated authoritative agency fee (450 DZD)');
  } catch (err) {
    fail('Test G', err);
  }

  console.log('\n── Test H: Missing / Unconfigured Fee During Admin Editing Fails Safely ──');
  try {
    const initialOrder = await placeOrder({
      idempotencyKey: `idem-del-fee-h-${Date.now()}`,
      customer: {
        fullName: 'IntegrityTest Edit Missing Fee',
        phone: '0551000008',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: 'home',
        address: 'El Biar'
      },
      items: [
        {
          productId: testProduct._id.toString(),
          colorName: 'Rose',
          size: 'M',
          quantity: 1
        }
      ]
    });

    // Temporarily mark Wilaya 31 unavailable
    await DeliverySetting.updateOne(
      { 'wilayaRates.wilayaCode': 31 },
      { $set: { 'wilayaRates.$.isAvailable': false } }
    );

    // Attempt to change destination to unavailable Wilaya 31
    const resEdit = mockRes();
    const reqEdit = {
      params: { id: initialOrder.order._id.toString() },
      body: {
        wilaya: { code: 31, name: 'Oran' },
        expectedVersion: initialOrder.order.__v
      },
      admin: { username: 'AdminAuditor' }
    };

    await updateOrderCustomerDetails(reqEdit, resEdit, () => {});
    assert.strictEqual(resEdit.statusCode, 400, `Expected 400 for unavailable destination, got ${resEdit.statusCode}`);
    assert.ok(resEdit.body.message.includes('unavailable'), 'Error message must state wilaya is unavailable');

    // Verify order was NOT changed
    const unchangedOrder = await Order.findById(initialOrder.order._id);
    assert.strictEqual(unchangedOrder.customer.wilaya.code, 16, 'Wilaya must remain 16');
    assert.strictEqual(unchangedOrder.deliveryFee, 500, 'Delivery fee must remain 500');

    // Restore Wilaya 31 availability
    await DeliverySetting.updateOne(
      { 'wilayaRates.wilayaCode': 31 },
      { $set: { 'wilayaRates.$.isAvailable': true } }
    );

    pass('Test H: Missing / unavailable fee during admin edit rejected with 400; order unchanged');
  } catch (err) {
    fail('Test H', err);
  }

  console.log('\n── Test I: Historical Order Delivery Fee Immutability on Global Rate Changes ──');
  try {
    // Order in Alger (fee was 500)
    const initialOrder = await placeOrder({
      idempotencyKey: `idem-del-fee-i-${Date.now()}`,
      customer: {
        fullName: 'IntegrityTest Historical Fee',
        phone: '0551000009',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: 'home',
        address: 'Bachdjerrah'
      },
      items: [
        {
          productId: testProduct._id.toString(),
          colorName: 'Rose',
          size: 'M',
          quantity: 1
        }
      ]
    });
    assert.strictEqual(initialOrder.order.deliveryFee, 500);

    // Now change the active rate for Wilaya 16 to 900 DZD in DeliverySetting
    await DeliverySetting.updateOne(
      { 'wilayaRates.wilayaCode': 16 },
      { $set: { 'wilayaRates.$.homeFee': 900 } }
    );

    // Verify the historical order's deliveryFee has NOT changed
    const historicalOrder = await Order.findById(initialOrder.order._id);
    assert.strictEqual(historicalOrder.deliveryFee, 500, 'Past order deliveryFee must remain 500 DZD (immutable snapshot)');
    assert.strictEqual(historicalOrder.totalPrice, 3500, 'Past order totalPrice must remain 3500 DZD');

    // Restore Wilaya 16 to 500
    await DeliverySetting.updateOne(
      { 'wilayaRates.wilayaCode': 16 },
      { $set: { 'wilayaRates.$.homeFee': 500 } }
    );

    pass('Test I: Changing current delivery configuration does NOT alter past orders (immutable snapshot)');
  } catch (err) {
    fail('Test I', err);
  }

  // Summary
  console.log('\n================================================================');
  console.log(`DELIVERY FEE AUDIT RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('================================================================\n');

  // Clean up
  await Order.deleteMany({ 'customer.fullName': { $regex: /IntegrityTest/i } });
  await Product.deleteMany({ name: { $regex: /IntegrityProduct/i } });

  await mongoose.disconnect();

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
