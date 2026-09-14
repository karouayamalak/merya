/**
 * integerMoneyTest.js
 *
 * Targeted regression test suite for:
 * CRITICAL ISSUE #3 — INTEGER DZD MONEY INTEGRITY
 *
 * Enforces integer-only DZD monetary amounts across:
 * - Product creation & update (sellingPrice, costPrice)
 * - Delivery settings (wilayaRates[].homeFee, wilayaRates[].agencyFee, freeDeliveryThreshold, and rejection of legacy global fee fields)
 * - Order checkout & line-item snapshots (unitPrice, unitCost, subtotal, deliveryFee, totalPrice)
 * - Order line-item editing
 *
 * Tests rejection of:
 * - Decimals (100.5, 1999.99, 1000.25, 0.5)
 * - Numeric strings with decimals ("1999.50")
 * - NaN, Infinity, -Infinity
 * - Negative amounts
 *
 * Tests acceptance of:
 * - 0 (where valid, e.g. costPrice, freeDeliveryThreshold, deliveryFee)
 * - 1, 100, 1999, 10000
 *
 * Verifies that all persisted MongoDB values remain strict integers.
 */

import assert from 'node:assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { Order } from '../src/models/Order.js';
import { DeliverySetting } from '../src/models/DeliverySetting.js';
import { productSchema, updateProductSchema } from '../src/middleware/validation.js';
import { createProduct, updateProduct } from '../src/controllers/productController.js';
import { updateDeliverySettings } from '../src/controllers/deliverySettingController.js';
import { placeOrder, updateOrderItemsService } from '../src/services/orderService.js';
import { ALGERIA_WILAYAS, DELIVERY_METHODS } from '../src/config/constants.js';

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
  console.log('  MERYA DZ — INTEGER DZD MONEY INTEGRITY REGRESSION SUITE');
  console.log('================================================================\n');

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(DB_URI);
  }

  let testCat = await Category.findOne();
  if (!testCat) {
    testCat = await Category.create({
      name: 'Money Integrity Category',
      slug: `money-cat-${Date.now()}`,
      description: 'Cat for money tests',
      image: 'https://example.com/cat.jpg'
    });
  }

  // Setup delivery settings with all 58 rates
  let ds = await DeliverySetting.findOne();
  const rates = ALGERIA_WILAYAS.map(w => ({
    wilayaCode: w.code,
    wilayaName: w.name,
    wilayaNameAr: w.nameAr,
    homeFee: 800,
    agencyFee: 500,
    isAvailable: true
  }));
  if (!ds) {
    ds = await DeliverySetting.create({
      singletonKey: 'default',
      freeDeliveryThreshold: 0,
      wilayaRates: rates
    });
  } else {
    ds.wilayaRates = rates;
    ds.freeDeliveryThreshold = 0;
    await ds.save();
  }

  console.log('── Part 1: Zod Validation Boundary — Product Creation ──');
  const invalidSellingPrices = [1999.50, 100.25, 0.5, '1999.50', NaN, Infinity, -100];
  for (const price of invalidSellingPrices) {
    const payload = {
      name: 'Invalid Price Abaya',
      description: 'Test description',
      category: testCat._id.toString(),
      sellingPrice: price,
      costPrice: 1000,
      colors: [
        {
          colorName: 'Noir',
          colorCode: '#000',
          images: ['https://example.com/img.jpg'],
          sizes: [{ size: 'M' }]
        }
      ]
    };
    const result = productSchema.safeParse(payload);
    assert.strictEqual(result.success, false, `sellingPrice: ${price} MUST be rejected by productSchema`);
  }
  pass(`productSchema rejected all invalid selling prices: ${invalidSellingPrices.join(', ')}`);

  const invalidCostPrices = [500.50, 10.75, '500.50', NaN, -50];
  for (const cost of invalidCostPrices) {
    const payload = {
      name: 'Invalid Cost Abaya',
      description: 'Test description',
      category: testCat._id.toString(),
      sellingPrice: 2000,
      costPrice: cost,
      colors: [
        {
          colorName: 'Noir',
          colorCode: '#000',
          images: ['https://example.com/img.jpg'],
          sizes: [{ size: 'M' }]
        }
      ]
    };
    const result = productSchema.safeParse(payload);
    assert.strictEqual(result.success, false, `costPrice: ${cost} MUST be rejected by productSchema`);
  }
  pass(`productSchema rejected all invalid cost prices: ${invalidCostPrices.join(', ')}`);

  // Valid product creation
  const validPrices = [
    { selling: 1, cost: 0 },
    { selling: 100, cost: 50 },
    { selling: 1999, cost: 1000 },
    { selling: 10000, cost: 6000 }
  ];
  for (const vp of validPrices) {
    const payload = {
      name: `Valid Price Abaya ${vp.selling}`,
      description: 'Test description',
      category: testCat._id.toString(),
      sellingPrice: vp.selling,
      costPrice: vp.cost,
      colors: [
        {
          colorName: 'Noir',
          colorCode: '#000',
          images: ['https://example.com/img.jpg'],
          sizes: [{ size: 'M' }]
        }
      ]
    };
    const result = productSchema.safeParse(payload);
    assert.strictEqual(result.success, true, `sellingPrice ${vp.selling} & costPrice ${vp.cost} must be valid`);
  }
  pass('productSchema accepted valid integer prices: 0, 1, 100, 1999, 10000');

  console.log('\n── Part 2: Controller & Mongoose Model Boundary — Product Creation & Update ──');
  // Attempt to save product directly via Mongoose with decimals
  try {
    const decProduct = new Product({
      name: 'Decimal Mongoose Product',
      slug: `dec-prod-${Date.now()}`,
      description: 'Mongoose decimal validation test',
      category: testCat._id,
      sellingPrice: 1999.50,
      costPrice: 1000,
      colors: [
        {
          colorName: 'Bleu',
          colorCode: '#00F',
          images: ['https://example.com/bleu.jpg'],
          sizes: [{ size: 'M', stock: 5 }]
        }
      ]
    });
    let rejected = false;
    try {
      await decProduct.save();
    } catch (err) {
      rejected = true;
      assert.ok(err.errors?.sellingPrice, 'Mongoose validator must reject decimal sellingPrice');
    }
    assert.strictEqual(rejected, true, 'Product.save() with sellingPrice 1999.50 must fail Mongoose validation');
    pass('Product Mongoose schema strictly rejected decimal sellingPrice: 1999.50');
  } catch (err) {
    fail('Mongoose schema sellingPrice validation', err);
  }

  try {
    const decCostProd = new Product({
      name: 'Decimal Cost Product',
      slug: `dec-cost-${Date.now()}`,
      description: 'Mongoose decimal cost validation test',
      category: testCat._id,
      sellingPrice: 2000,
      costPrice: 999.99,
      colors: [
        {
          colorName: 'Bleu',
          colorCode: '#00F',
          images: ['https://example.com/bleu.jpg'],
          sizes: [{ size: 'M', stock: 5 }]
        }
      ]
    });
    let rejected = false;
    try {
      await decCostProd.save();
    } catch (err) {
      rejected = true;
      assert.ok(err.errors?.costPrice, 'Mongoose validator must reject decimal costPrice');
    }
    assert.strictEqual(rejected, true, 'Product.save() with costPrice 999.99 must fail Mongoose validation');
    pass('Product Mongoose schema strictly rejected decimal costPrice: 999.99');
  } catch (err) {
    fail('Mongoose schema costPrice validation', err);
  }

  // Create clean valid product via controller
  let createdProd;
  try {
    const resCreate = mockRes();
    const reqCreate = {
      body: {
        name: `Integer Prod ${Date.now()}`,
        description: 'Valid integer product',
        category: testCat._id.toString(),
        sellingPrice: 2500,
        costPrice: 1200,
        colors: [
          {
            colorName: 'Vert',
            colorCode: '#0F0',
            images: ['https://example.com/vert.jpg'],
            sizes: [{ size: 'M' }]
          }
        ]
      }
    };
    await createProduct(reqCreate, resCreate, () => {});
    assert.strictEqual(resCreate.statusCode, 201);
    createdProd = resCreate.body.product;
    assert.strictEqual(Number.isInteger(createdProd.sellingPrice), true);
    assert.strictEqual(Number.isInteger(createdProd.costPrice), true);
    pass('createProduct controller created product with integer DZD amounts (2500, 1200)');
  } catch (err) {
    fail('createProduct controller', err);
  }

  // Attempt to update product with decimal via updateProduct controller
  try {
    const resUpdate = mockRes();
    const reqUpdate = {
      params: { id: createdProd._id.toString() },
      body: {
        sellingPrice: 2999.75
      }
    };
    await updateProduct(reqUpdate, resUpdate, () => {});
    assert.strictEqual(resUpdate.statusCode, 400, 'updateProduct with decimal sellingPrice must return 400');
    assert.ok(resUpdate.body.message.includes('integer'), 'Error message must specify integer DZD');

    const freshProd = await Product.findById(createdProd._id);
    assert.strictEqual(freshProd.sellingPrice, 2500, 'sellingPrice in DB must remain unmodified integer (2500)');
    pass('updateProduct controller rejected decimal sellingPrice (2999.75) with 400; DB intact');
  } catch (err) {
    fail('updateProduct controller decimal rejection', err);
  }

  // Valid update with integer
  try {
    const resUpdate = mockRes();
    const reqUpdate = {
      params: { id: createdProd._id.toString() },
      body: {
        sellingPrice: 3500,
        costPrice: 1800
      }
    };
    await updateProduct(reqUpdate, resUpdate, () => {});
    assert.strictEqual(resUpdate.statusCode, 200);

    const freshProd = await Product.findById(createdProd._id);
    assert.strictEqual(freshProd.sellingPrice, 3500);
    assert.strictEqual(freshProd.costPrice, 1800);
    assert.strictEqual(Number.isInteger(freshProd.sellingPrice), true);
    assert.strictEqual(Number.isInteger(freshProd.costPrice), true);
    pass('updateProduct controller successfully updated to integer amounts (3500, 1800)');
  } catch (err) {
    fail('updateProduct controller valid integer update', err);
  }

  console.log('\n── Part 3: Delivery Settings Boundary — Decimals Rejection & Legacy Removal ──');
  // 1. Attempt to pass legacy global delivery fees -> strictly rejected with 400
  try {
    const resSettings = mockRes();
    const reqSettings = {
      body: {
        agencyDeliveryFee: 450.50
      },
      admin: { _id: new mongoose.Types.ObjectId() }
    };
    await updateDeliverySettings(reqSettings, resSettings, () => {});
    assert.strictEqual(resSettings.statusCode, 400);
    assert.ok(resSettings.body.message.includes('no longer supported'), 'Error must specify legacy fields no longer supported');
    pass('updateDeliverySettings rejected legacy agencyDeliveryFee with 400');
  } catch (err) {
    fail('updateDeliverySettings legacy agencyDeliveryFee rejection', err);
  }

  try {
    const resSettings = mockRes();
    const reqSettings = {
      body: {
        homeDeliveryFee: 800.25
      },
      admin: { _id: new mongoose.Types.ObjectId() }
    };
    await updateDeliverySettings(reqSettings, resSettings, () => {});
    assert.strictEqual(resSettings.statusCode, 400);
    assert.ok(resSettings.body.message.includes('no longer supported'), 'Error must specify legacy fields no longer supported');
    pass('updateDeliverySettings rejected legacy homeDeliveryFee with 400');
  } catch (err) {
    fail('updateDeliverySettings legacy homeDeliveryFee rejection', err);
  }

  // 2. Attempt to update per-Wilaya rates with decimals
  try {
    const invalidRates = rates.map(r => r.wilayaCode === 16 ? { ...r, agencyFee: 350.50 } : r);
    const resSettings = mockRes();
    const reqSettings = {
      body: {
        wilayaRates: invalidRates
      },
      admin: { _id: new mongoose.Types.ObjectId() }
    };
    await updateDeliverySettings(reqSettings, resSettings, () => {});
    assert.strictEqual(resSettings.statusCode, 400);
    assert.ok(resSettings.body.message.includes('integer'), 'Error must specify integer');
    pass('updateDeliverySettings rejected decimal agencyFee in wilayaRates: 350.50');
  } catch (err) {
    fail('updateDeliverySettings decimal agencyFee in wilayaRates', err);
  }

  try {
    const invalidRates = rates.map(r => r.wilayaCode === 31 ? { ...r, homeFee: 750.25 } : r);
    const resSettings = mockRes();
    const reqSettings = {
      body: {
        wilayaRates: invalidRates
      },
      admin: { _id: new mongoose.Types.ObjectId() }
    };
    await updateDeliverySettings(reqSettings, resSettings, () => {});
    assert.strictEqual(resSettings.statusCode, 400);
    assert.ok(resSettings.body.message.includes('integer'), 'Error must specify integer');
    pass('updateDeliverySettings rejected decimal homeFee in wilayaRates: 750.25');
  } catch (err) {
    fail('updateDeliverySettings decimal homeFee in wilayaRates', err);
  }

  try {
    const resSettings = mockRes();
    const reqSettings = {
      body: {
        freeDeliveryThreshold: 5000.50
      },
      admin: { _id: new mongoose.Types.ObjectId() }
    };
    await updateDeliverySettings(reqSettings, resSettings, () => {});
    assert.strictEqual(resSettings.statusCode, 400);
    assert.ok(resSettings.body.message.includes('integer'));
    pass('updateDeliverySettings rejected decimal freeDeliveryThreshold: 5000.50');
  } catch (err) {
    fail('updateDeliverySettings decimal freeDeliveryThreshold', err);
  }

  try {
    // Attempt to update wilayaRates with decimal homeFee
    const currentSettings = await DeliverySetting.findOne();
    const modifiedRates = currentSettings.wilayaRates.map(r => ({
      wilayaCode: r.wilayaCode,
      wilayaName: r.wilayaName,
      homeFee: r.wilayaCode === 16 ? 550.75 : r.homeFee,
      agencyFee: r.agencyFee,
      isAvailable: true
    }));

    const resSettings = mockRes();
    const reqSettings = {
      body: {
        wilayaRates: modifiedRates
      },
      admin: { _id: new mongoose.Types.ObjectId() }
    };
    await updateDeliverySettings(reqSettings, resSettings, () => {});
    assert.strictEqual(resSettings.statusCode, 400);
    assert.ok(resSettings.body.message.includes('integer'), 'Error must specify integer for wilayaRates homeFee');
    pass('updateDeliverySettings rejected decimal in wilayaRates[].homeFee (550.75)');
  } catch (err) {
    fail('updateDeliverySettings decimal in wilayaRates', err);
  }

  console.log('\n── Part 4: Checkout & Order Model Financial Integrity ──');
  // Set stock on createdProd to 10
  await Product.updateOne(
    { _id: createdProd._id, 'colors.colorName': 'Vert', 'colors.sizes.size': 'M' },
    { $set: { 'colors.$[c].sizes.$[s].stock': 10 } },
    { arrayFilters: [{ 'c.colorName': 'Vert' }, { 's.size': 'M' }] }
  );

  // Place order and verify all financial fields are integer
  try {
    const orderResult = await placeOrder({
      idempotencyKey: `idem-int-money-4-${Date.now()}`,
      customer: {
        fullName: 'Integer Money Test User',
        phone: '0552000001',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: 'home',
        address: 'Rue Didouche Mourad'
      },
      items: [
        {
          productId: createdProd._id.toString(),
          colorName: 'Vert',
          size: 'M',
          quantity: 3
        }
      ]
    });

    const o = orderResult.order;
    assert.strictEqual(Number.isInteger(o.subtotal), true, 'subtotal must be integer');
    assert.strictEqual(Number.isInteger(o.deliveryFee), true, 'deliveryFee must be integer');
    assert.strictEqual(Number.isInteger(o.totalPrice), true, 'totalPrice must be integer');
    assert.strictEqual(o.subtotal, 3500 * 3, 'subtotal must be 10500');
    assert.strictEqual(o.deliveryFee, 800, 'deliveryFee must be 800');
    assert.strictEqual(o.totalPrice, 11300, 'totalPrice must be 11300');

    // Check item snapshots
    for (const it of o.items) {
      assert.strictEqual(Number.isInteger(it.unitPrice), true, 'item unitPrice must be integer');
      assert.strictEqual(Number.isInteger(it.unitCost), true, 'item unitCost must be integer');
      assert.strictEqual(Number.isInteger(it.quantity), true, 'item quantity must be integer');
    }

    // Direct Mongoose Model validation: Attempt to save decimal in order.deliveryFee
    o.deliveryFee = 500.50;
    let orderSaveRejected = false;
    try {
      await o.save();
    } catch (err) {
      orderSaveRejected = true;
      assert.ok(err.errors?.deliveryFee, 'Order schema validator must reject decimal deliveryFee');
    }
    assert.strictEqual(orderSaveRejected, true, 'Order.save() with decimal deliveryFee must be rejected');
    pass('Order model strictly rejected decimal deliveryFee (500.50) via Mongoose schema validator');

    // Direct Mongoose Model validation: Attempt to save decimal in order.subtotal
    o.deliveryFee = 800; // Restore
    o.subtotal = 10500.25;
    orderSaveRejected = false;
    try {
      await o.save();
    } catch (err) {
      orderSaveRejected = true;
      assert.ok(err.errors?.subtotal, 'Order schema validator must reject decimal subtotal');
    }
    assert.strictEqual(orderSaveRejected, true, 'Order.save() with decimal subtotal must be rejected');
    pass('Order model strictly rejected decimal subtotal (10500.25) via Mongoose schema validator');

    // Direct Mongoose Model validation: Attempt to save decimal in order.totalPrice
    o.subtotal = 10500; // Restore
    o.totalPrice = 11300.99;
    orderSaveRejected = false;
    try {
      await o.save();
    } catch (err) {
      orderSaveRejected = true;
      assert.ok(err.errors?.totalPrice, 'Order schema validator must reject decimal totalPrice');
    }
    assert.strictEqual(orderSaveRejected, true, 'Order.save() with decimal totalPrice must be rejected');
    pass('Order model strictly rejected decimal totalPrice (11300.99) via Mongoose schema validator');
  } catch (err) {
    fail('Checkout & Order financial integrity', err);
  }

  console.log('\n── Part 5: Line-Item Editing Financial Recalculation Remains Strict Integer ──');
  try {
    // Create an order for line-item editing
    const testOrder = await placeOrder({
      idempotencyKey: `idem-int-money-5-${Date.now()}`,
      customer: {
        fullName: 'Integer Edit Test User',
        phone: '0552000002',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: 'agency',
        agencyName: 'Yalidine Kouba'
      },
      items: [
        {
          productId: createdProd._id.toString(),
          colorName: 'Vert',
          size: 'M',
          quantity: 1
        }
      ]
    });

    // Edit items: change quantity to 2
    const updated = await updateOrderItemsService({
      orderId: testOrder.order._id.toString(),
      newItems: [
        {
          productId: createdProd._id.toString(),
          colorName: 'Vert',
          size: 'M',
          quantity: 2
        }
      ],
      adminUsername: 'AdminMoneyAuditor',
      reason: 'Integer recalculation audit test'
    });

    assert.strictEqual(Number.isInteger(updated.subtotal), true);
    assert.strictEqual(Number.isInteger(updated.deliveryFee), true);
    assert.strictEqual(Number.isInteger(updated.totalPrice), true);
    assert.strictEqual(updated.subtotal, 7000);
    assert.strictEqual(updated.deliveryFee, 500);
    assert.strictEqual(updated.totalPrice, 7500);

    // Attempt to pass decimal quantity to updateOrderItemsService
    let editQtyRejected = false;
    try {
      await updateOrderItemsService({
        orderId: testOrder.order._id.toString(),
        newItems: [
          {
            productId: createdProd._id.toString(),
            colorName: 'Vert',
            size: 'M',
            quantity: 1.5
          }
        ],
        adminUsername: 'AdminMoneyAuditor'
      });
    } catch (err) {
      editQtyRejected = true;
      assert.ok(err.message.includes('integer'), 'Error must specify integer quantity');
    }
    assert.strictEqual(editQtyRejected, true, 'updateOrderItemsService must reject decimal quantity 1.5');
    pass('updateOrderItemsService rejected decimal quantity (1.5) and persisted clean integers (7000, 500, 7500)');
  } catch (err) {
    fail('Line-item edit integer recalculation', err);
  }

  // Summary
  console.log('\n================================================================');
  console.log(`INTEGER MONEY AUDIT RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('================================================================\n');

  // Clean up
  await Order.deleteMany({ 'customer.fullName': { $regex: /Integer.*Test/i } });
  await Product.deleteMany({ name: { $regex: /Integer.*Prod/i } });

  await mongoose.disconnect();

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
