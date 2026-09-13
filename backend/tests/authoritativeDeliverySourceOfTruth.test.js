import test, { describe, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { Order } from '../src/models/Order.js';
import { DeliverySetting } from '../src/models/DeliverySetting.js';
import { placeOrder } from '../src/services/orderService.js';
import { checkout, updateOrderCustomerDetails, getCartQuote } from '../src/controllers/orderController.js';
import { resolveAuthoritativeDelivery } from '../src/services/deliveryService.js';
import { ORDER_STATUS, DELIVERY_METHODS, ALGERIA_WILAYAS } from '../src/config/constants.js';

dotenv.config();

const DB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27018/merya_dz?replicaSet=rs0&directConnection=true';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

describe('Authoritative Delivery Pricing Source of Truth Regression Suite', () => {
  let testCategory;
  let testProduct;

  before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(DB_URI);
    }

    // Clean up past test fixtures
    await Order.deleteMany({ 'customer.fullName': { $regex: /SourceOfTruthUser/i } });
    await Product.deleteMany({ name: { $regex: /SourceOfTruthProduct/i } });

    testCategory = await Category.findOne();
    if (!testCategory) {
      testCategory = await Category.create({
        name: 'Delivery SOT Category',
        slug: `delivery-sot-cat-${Date.now()}`,
        description: 'Category for delivery source of truth tests',
        image: 'https://example.com/cat.jpg'
      });
    }

    testProduct = await Product.create({
      name: `SourceOfTruthProduct-${Date.now()}`,
      slug: `sot-prod-${Date.now()}`,
      description: 'Product for delivery pricing source of truth tests',
      category: testCategory._id,
      sellingPrice: 4000,
      costPrice: 2000,
      colors: [
        {
          colorName: 'Noir',
          colorCode: '#000000',
          images: ['https://example.com/noir.jpg'],
          sizes: [
            { size: 'M', stock: 50 },
            { size: 'L', stock: 50 }
          ]
        }
      ]
    });

    // Configure DeliverySetting with all 58 canonical Wilayas:
    // Wilaya 16 (Alger): home = 500, agency = 350
    // Wilaya 31 (Oran):  home = 750, agency = 450
    // Wilaya 25 (Constantine): home = 700, agency = 400
    // CRITICAL TEST PROPERTY: Legacy global fallback fields are intentionally set to 9999 DZD
    // to prove that NO customer, checkout, quote, or admin calculation can ever be influenced by them!
    const allRates = ALGERIA_WILAYAS.map(w => {
      let homeFee = 800;
      let agencyFee = 500;
      if (w.code === 16) { homeFee = 500; agencyFee = 350; }
      if (w.code === 31) { homeFee = 750; agencyFee = 450; }
      if (w.code === 25) { homeFee = 700; agencyFee = 400; }
      return {
        wilayaCode: w.code,
        wilayaName: w.name,
        wilayaNameAr: w.nameAr,
        homeFee,
        agencyFee,
        isAvailable: true
      };
    });

    let delSetting = await DeliverySetting.getSingleton();
    if (!delSetting) {
      delSetting = await DeliverySetting.create({
        singletonKey: 'default',
        agencyDeliveryFee: 9999, // Legacy global field set to extreme number
        homeDeliveryFee: 9999,   // Legacy global field set to extreme number
        freeDeliveryThreshold: 0,
        wilayaRates: allRates
      });
    } else {
      delSetting.agencyDeliveryFee = 9999;
      delSetting.homeDeliveryFee = 9999;
      delSetting.freeDeliveryThreshold = 0;
      delSetting.wilayaRates = allRates;
      await delSetting.save();
    }
  });

  after(async () => {
    await Order.deleteMany({ 'customer.fullName': { $regex: /SourceOfTruthUser/i } });
    await Product.deleteMany({ name: { $regex: /SourceOfTruthProduct/i } });
    await mongoose.disconnect();
  });

  // 1. Checkout uses wilayaRates[].agencyFee
  test('1. Checkout uses wilayaRates[].agencyFee strictly and ignores legacy global fee', async () => {
    const res = mockRes();
    const req = {
      body: {
        idempotencyKey: `sot-checkout-agency-${Date.now()}`,
        customer: {
          fullName: 'SourceOfTruthUser Agency',
          phone: '0550111111',
          wilaya: { code: 16, name: 'Alger' },
          deliveryMethod: 'agency',
          agencyName: 'Yalidine Alger Bab Ezzouar'
        },
        items: [
          {
            productId: testProduct._id.toString(),
            colorName: 'Noir',
            size: 'M',
            quantity: 1
          }
        ]
      }
    };

    await checkout(req, res, () => {});
    assert.strictEqual(res.statusCode, 201, `Checkout should succeed: ${JSON.stringify(res.body)}`);
    // Wilaya 16 agencyFee is 350. Legacy global agencyDeliveryFee is 9999.
    assert.strictEqual(res.body.deliveryFee, 350, 'Must use wilayaRates agencyFee (350), NOT legacy global 9999');
    assert.notStrictEqual(res.body.deliveryFee, 9999, 'Must NEVER use legacy agencyDeliveryFee');
    assert.strictEqual(res.body.totalPrice, 4000 + 350, 'Total must equal item subtotal (4000) + wilaya agency fee (350)');

    const savedOrder = await Order.findOne({ orderCode: res.body.orderCode });
    assert.strictEqual(savedOrder.deliveryFee, 350);
    assert.strictEqual(savedOrder.totalPrice, 4350);
  });

  // 2. Checkout uses wilayaRates[].homeFee
  test('2. Checkout uses wilayaRates[].homeFee strictly and ignores legacy global fee', async () => {
    const res = mockRes();
    const req = {
      body: {
        idempotencyKey: `sot-checkout-home-${Date.now()}`,
        customer: {
          fullName: 'SourceOfTruthUser Home',
          phone: '0550222222',
          wilaya: { code: 31, name: 'Oran' },
          deliveryMethod: 'home',
          address: 'Rue Larbi Ben M\'hidi, Oran'
        },
        items: [
          {
            productId: testProduct._id.toString(),
            colorName: 'Noir',
            size: 'M',
            quantity: 1
          }
        ]
      }
    };

    await checkout(req, res, () => {});
    assert.strictEqual(res.statusCode, 201);
    // Wilaya 31 homeFee is 750. Legacy global homeDeliveryFee is 9999.
    assert.strictEqual(res.body.deliveryFee, 750, 'Must use wilayaRates homeFee (750), NOT legacy global 9999');
    assert.notStrictEqual(res.body.deliveryFee, 9999, 'Must NEVER use legacy homeDeliveryFee');
    assert.strictEqual(res.body.totalPrice, 4000 + 750);
  });

  // 3. Cart quote cannot use legacy global fields
  test('3. Cart quote (POST /orders/quote) strictly uses wilayaRates and ignores legacy global fees', async () => {
    const res = mockRes();
    const req = {
      body: {
        wilayaCode: 25, // Constantine: agency = 400, home = 700
        deliveryMethod: 'agency',
        items: [
          {
            productId: testProduct._id.toString(),
            colorName: 'Noir',
            size: 'M',
            quantity: 1
          }
        ]
      }
    };

    await getCartQuote(req, res, () => {});
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.isValid, true);
    assert.strictEqual(res.body.deliveryFee, 400, 'Quote must return wilayaRates agency fee (400), not legacy global (9999)');
    assert.notStrictEqual(res.body.deliveryFee, 9999);
    assert.strictEqual(res.body.totalPrice, 4000 + 400);

    // Now test quote with home delivery for Wilaya 25
    const resHome = mockRes();
    const reqHome = {
      body: {
        wilayaCode: 25,
        deliveryMethod: 'home',
        items: [
          {
            productId: testProduct._id.toString(),
            colorName: 'Noir',
            size: 'M',
            quantity: 1
          }
        ]
      }
    };

    await getCartQuote(reqHome, resHome, () => {});
    assert.strictEqual(resHome.statusCode, 200);
    assert.strictEqual(resHome.body.deliveryFee, 700, 'Quote must return wilayaRates home fee (700), not legacy global (9999)');
    assert.notStrictEqual(resHome.body.deliveryFee, 9999);
  });

  // 4. Admin order recalculation cannot use legacy global fields
  test('4. Admin order destination update recalculates delivery fee from wilayaRates, not legacy global fields', async () => {
    // First create an order in Wilaya 16 home (fee: 500)
    const { order: initialOrder } = await placeOrder({
      idempotencyKey: `sot-admin-recalc-${Date.now()}`,
      customer: {
        fullName: 'SourceOfTruthUser Recalc',
        phone: '0550333333',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: 'home',
        address: 'Didouche Mourad, Alger'
      },
      items: [
        {
          productId: testProduct._id.toString(),
          colorName: 'Noir',
          size: 'M',
          quantity: 1
        }
      ]
    });

    assert.strictEqual(initialOrder.deliveryFee, 500);

    // Admin updates customer destination to Wilaya 31 agency (authoritative fee: 450)
    const resAdmin = mockRes();
    const reqAdmin = {
      params: { id: initialOrder._id.toString() },
      body: {
        wilaya: { code: 31, name: 'Oran' },
        deliveryMethod: 'agency',
        agencyName: 'Yalidine Oran Centre'
      },
      admin: { _id: new mongoose.Types.ObjectId() }
    };

    await updateOrderCustomerDetails(reqAdmin, resAdmin, () => {});
    assert.strictEqual(resAdmin.statusCode, 200);
    assert.strictEqual(resAdmin.body.order.deliveryFee, 450, 'Recalculated fee must be 450 (Wilaya 31 agency fee)');
    assert.notStrictEqual(resAdmin.body.order.deliveryFee, 9999, 'Recalculated fee must never use legacy global 9999');
    assert.strictEqual(resAdmin.body.order.totalPrice, 4000 + 450);

    const updatedDb = await Order.findById(initialOrder._id);
    assert.strictEqual(updatedDb.deliveryFee, 450);
    assert.strictEqual(updatedDb.totalPrice, 4450);
  });

  // 5. Client tampering: Client-supplied deliveryFee is ignored
  test('5. Client-supplied deliveryFee is strictly ignored and cannot manipulate the final delivery fee', async () => {
    const res = mockRes();
    const req = {
      body: {
        idempotencyKey: `sot-tamper-fee-${Date.now()}`,
        // Malicious client supplies deliveryFee: 0 or deliveryFee: 1
        deliveryFee: 0,
        totalPrice: 4000,
        customer: {
          fullName: 'SourceOfTruthUser Tamper',
          phone: '0550444444',
          wilaya: { code: 16, name: 'Alger' },
          deliveryMethod: 'home',
          address: 'Didouche Mourad, Alger'
        },
        items: [
          {
            productId: testProduct._id.toString(),
            colorName: 'Noir',
            size: 'M',
            quantity: 1
          }
        ]
      }
    };

    await checkout(req, res, () => {});
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.deliveryFee, 500, 'Tampered deliveryFee: 0 must be ignored, server uses authoritative 500');
    assert.strictEqual(res.body.totalPrice, 4500, 'Total must be 4500, not tampered 4000');

    const dbOrder = await Order.findOne({ orderCode: res.body.orderCode });
    assert.strictEqual(dbOrder.deliveryFee, 500);
    assert.strictEqual(dbOrder.totalPrice, 4500);
  });

  // 6. All 58 Wilayas canonical integrity
  test('6. All 58 Wilayas exist with valid non-negative integer agency and home rates', async () => {
    const setting = await DeliverySetting.getSingleton();
    assert.ok(setting, 'DeliverySetting singleton must exist');
    assert.strictEqual(setting.wilayaRates.length, 58, 'Exactly 58 Wilayas must be configured');

    const seenCodes = new Set();
    for (const rate of setting.wilayaRates) {
      assert.ok(Number.isInteger(rate.wilayaCode), `wilayaCode must be integer: ${rate.wilayaCode}`);
      assert.ok(rate.wilayaCode >= 1 && rate.wilayaCode <= 58, `wilayaCode out of range: ${rate.wilayaCode}`);
      assert.ok(!seenCodes.has(rate.wilayaCode), `Duplicate wilayaCode: ${rate.wilayaCode}`);
      seenCodes.add(rate.wilayaCode);

      assert.ok(Number.isInteger(rate.homeFee) && rate.homeFee >= 0, `homeFee must be non-negative integer for Wilaya ${rate.wilayaCode}`);
      assert.ok(Number.isInteger(rate.agencyFee) && rate.agencyFee >= 0, `agencyFee must be non-negative integer for Wilaya ${rate.wilayaCode}`);
      assert.strictEqual(typeof rate.isAvailable, 'boolean');
    }

    assert.strictEqual(seenCodes.size, 58);
  });

  // 7. Invalid Wilaya codes strictly rejected
  test('7. Invalid Wilaya codes (0, 59, 99, non-numeric) are strictly rejected', async () => {
    // Test code 59 (out of range)
    const quoteRes = await resolveAuthoritativeDelivery({
      wilayaCode: 59,
      deliveryMethod: 'home',
      throwOnError: false
    });
    assert.strictEqual(quoteRes.success, false);
    assert.strictEqual(quoteRes.code, 'INVALID_WILAYA_CODE');

    // Test code 0
    const zeroRes = await resolveAuthoritativeDelivery({
      wilayaCode: 0,
      deliveryMethod: 'home',
      throwOnError: false
    });
    assert.strictEqual(zeroRes.success, false);

    // Test invalid format string '1.5'
    const floatRes = await resolveAuthoritativeDelivery({
      wilayaCode: '1.5',
      deliveryMethod: 'home',
      throwOnError: false
    });
    assert.strictEqual(floatRes.success, false);
  });

  // 8. Historical orders retain their delivery fees when current delivery settings change
  test('8. Changing current delivery settings does not rewrite historical order delivery fees', async () => {
    // Create an order under current Wilaya 16 home rate (500 DZD)
    const { order: historicalOrder } = await placeOrder({
      idempotencyKey: `sot-historical-${Date.now()}`,
      customer: {
        fullName: 'SourceOfTruthUser Historical',
        phone: '0550555555',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: 'home',
        address: 'Rue Didouche, Alger'
      },
      items: [
        {
          productId: testProduct._id.toString(),
          colorName: 'Noir',
          size: 'M',
          quantity: 1
        }
      ]
    });

    assert.strictEqual(historicalOrder.deliveryFee, 500);

    // Now modify the DeliverySetting for Wilaya 16 homeFee to 1200 DZD
    const setting = await DeliverySetting.getSingleton();
    const algerRate = setting.wilayaRates.find(r => r.wilayaCode === 16);
    algerRate.homeFee = 1200;
    await setting.save();

    // Re-query historical order from DB
    const reloadedOrder = await Order.findById(historicalOrder._id);
    assert.strictEqual(reloadedOrder.deliveryFee, 500, 'Historical order deliveryFee MUST NOT be modified by current settings update');
    assert.strictEqual(reloadedOrder.totalPrice, 4500);

    // Restore Wilaya 16 homeFee to 500
    algerRate.homeFee = 500;
    await setting.save();
  });

  // 9. Delivery settings singleton constraint
  test('9. DeliverySetting singletonKey constraint prevents duplicate settings documents', async () => {
    const singleton = await DeliverySetting.getSingleton();
    assert.ok(singleton);
    assert.strictEqual(singleton.singletonKey, 'default');

    // Attempting to create another document with singletonKey: 'default' must fail with duplicate key error E11000
    let duplicateError = null;
    try {
      await DeliverySetting.create({
        singletonKey: 'default',
        wilayaRates: singleton.wilayaRates
      });
    } catch (err) {
      duplicateError = err;
    }
    assert.ok(duplicateError, 'Duplicate singletonKey insertion must throw an error');
    assert.ok(duplicateError.code === 11000 || duplicateError.message.includes('duplicate key'), 'Must be duplicate key E11000');
  });

  // 10. Checkout idempotency prevents duplicate stock deduction and charges
  test('10. Checkout idempotency safely returns cached order on resubmission without double stock deduction', async () => {
    const key = `sot-idemp-${Date.now()}`;
    const initialProduct = await Product.findById(testProduct._id);
    const initialStock = initialProduct.colors[0].sizes[0].stock;

    const payload = {
      idempotencyKey: key,
      customer: {
        fullName: 'SourceOfTruthUser Idempotency',
        phone: '0550666666',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: 'agency',
        agencyName: 'Yalidine Alger'
      },
      items: [
        {
          productId: testProduct._id.toString(),
          colorName: 'Noir',
          size: 'M',
          quantity: 2
        }
      ]
    };

    const { order: firstOrder } = await placeOrder(payload);
    assert.strictEqual(firstOrder.deliveryFee, 350);

    const midProduct = await Product.findById(testProduct._id);
    assert.strictEqual(midProduct.colors[0].sizes[0].stock, initialStock - 2, 'Stock decremented by 2');

    // Resubmit exact same order
    const { order: secondOrder } = await placeOrder(payload);
    assert.strictEqual(secondOrder.orderCode, firstOrder.orderCode, 'Must return identical orderCode');
    assert.strictEqual(secondOrder.deliveryFee, 350);

    const finalProduct = await Product.findById(testProduct._id);
    assert.strictEqual(finalProduct.colors[0].sizes[0].stock, initialStock - 2, 'Stock must NOT be decremented again on idempotency replay');
  });
});
