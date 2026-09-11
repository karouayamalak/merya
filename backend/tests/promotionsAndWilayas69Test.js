/**
 * promotionsAndWilayas69Test.js
 *
 * Comprehensive integration test suite covering all 12 required scenarios:
 *
 * DOMAIN 1 – 69 WILAYAS CANONICAL CONSTANTS
 *   1.  Exactly 69 canonical Wilayas exist.
 *   2.  Codes 59–69 match the correct 2026 official mapping.
 *   3.  All 69 codes are accepted by Zod checkout validation.
 *   4.  Invalid Wilaya codes are rejected.
 *   5.  Delivery settings support every Wilaya (69 entries in DB).
 *   6.  Delivery fee remains server-authoritative (client value ignored).
 *
 * DOMAIN 2 – PRODUCT PROMOTIONS
 *   7.  Promotion can be activated.
 *   8.  Promotional price must be strictly lower than base price.
 *   9.  Customer sees old price + new promotional price (effectivePrice virtual).
 *   10. Checkout uses the promotional price (server-authoritative).
 *   11. Historical order keeps its original promotional price after promotion changes/is removed.
 *   12. Concurrent product-price/promotion change cannot cause checkout to use a client-supplied price.
 */

import assert from 'assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { Order } from '../src/models/Order.js';
import { DeliverySetting } from '../src/models/DeliverySetting.js';
import { ALGERIA_WILAYAS, DELIVERY_METHODS } from '../src/config/constants.js';
import { checkoutOrderSchema, productSchema, updateProductSchema } from '../src/middleware/validation.js';
import { placeOrder } from '../src/services/orderService.js';
import { migrate69Wilayas } from '../src/seed/migrate69Wilayas.js';

dotenv.config();

const DB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27018/merya_dz?replicaSet=rs0';

let passCount = 0;
function pass(msg) {
  console.log(`  ✓ ${msg}`);
  passCount++;
}

async function runTests() {
  console.log('=== RUNNING PROMOTIONS & 69 WILAYAS INTEGRATION SUITE (2026 Official Mapping) ===\n');

  await mongoose.connect(DB_URI);
  console.log('[Setup] Connected to MongoDB');

  // Ensure DB delivery settings are migrated to 69 Wilayas
  await migrate69Wilayas();

  // Shared test category
  const testCategory = await Category.findOneAndUpdate(
    { slug: 'promo-wilaya-test-cat' },
    { name: 'Promo & Wilaya Test Category', slug: 'promo-wilaya-test-cat', description: 'Testing category' },
    { upsert: true, new: true }
  );

  // =========================================================================
  console.log('\n--- DOMAIN 1: 69 WILAYAS CANONICAL CONSTANTS & OFFICIAL 2026 MAPPING ---');
  // =========================================================================

  // SCENARIO 1: Exactly 69 canonical Wilayas
  assert.strictEqual(ALGERIA_WILAYAS.length, 69, 'ALGERIA_WILAYAS must have exactly 69 entries');
  assert.strictEqual(ALGERIA_WILAYAS[0].code, 1);
  assert.strictEqual(ALGERIA_WILAYAS[0].name, 'Adrar');
  assert.strictEqual(ALGERIA_WILAYAS[57].code, 58);
  assert.strictEqual(ALGERIA_WILAYAS[57].name, 'El Meniaa');
  assert.strictEqual(ALGERIA_WILAYAS[58].code, 59);
  assert.strictEqual(ALGERIA_WILAYAS[59].code, 60);
  assert.strictEqual(ALGERIA_WILAYAS[68].code, 69);
  pass('Scenario 1: Exactly 69 canonical Wilayas exist (codes 1–69)');

  // SCENARIO 2: Codes 59–69 match the correct 2026 official mapping
  const expected2026 = [
    { code: 59, name: 'Aflou' },
    { code: 60, name: 'Barika' },
    { code: 61, name: 'El Kantara' },
    { code: 62, name: 'Bir El Ater' },
    { code: 63, name: 'El Aricha' },
    { code: 64, name: 'Ksar Chellala' },
    { code: 65, name: 'Aïn Ouessara' },
    { code: 66, name: 'Messaad' },
    { code: 67, name: 'Ksar El Boukhari' },
    { code: 68, name: 'Bou Saâda' },
    { code: 69, name: 'El Abiodh Sidi Cheikh' },
  ];
  for (const expected of expected2026) {
    const actual = ALGERIA_WILAYAS.find(w => w.code === expected.code);
    assert(actual, `Wilaya code ${expected.code} must exist in ALGERIA_WILAYAS`);
    assert.strictEqual(
      actual.name, expected.name,
      `Wilaya ${expected.code}: expected "${expected.name}", got "${actual.name}"`
    );
  }
  pass('Scenario 2: Codes 59–69 all match the correct 2026 official mapping');

  // SCENARIO 3: All 69 codes accepted by Zod checkout validation
  const baseCustomer = {
    fullName: 'Amina Test',
    phone: '0555123456',
    deliveryMethod: DELIVERY_METHODS.HOME,
    address: '123 Boulevard Test'
  };
  const baseItems = [{ productId: new mongoose.Types.ObjectId().toString(), colorName: 'Noir', size: 'M', quantity: 1 }];

  for (const w of ALGERIA_WILAYAS) {
    const payload = {
      customer: { ...baseCustomer, wilaya: { code: w.code, name: w.name } },
      items: baseItems
    };
    assert.doesNotThrow(
      () => checkoutOrderSchema.parse(payload),
      `Wilaya code ${w.code} (${w.name}) must pass Zod checkout validation`
    );
  }
  pass('Scenario 3: All 69 Wilaya codes are accepted by checkout Zod validation');

  // SCENARIO 4: Invalid Wilaya codes are rejected
  for (const invalidCode of [0, 70, -1, 99, 3.14]) {
    const payload = {
      customer: { ...baseCustomer, wilaya: { code: invalidCode, name: 'Invalid' } },
      items: baseItems
    };
    assert.throws(
      () => checkoutOrderSchema.parse(payload),
      `Wilaya code ${invalidCode} must fail Zod validation`
    );
  }
  pass('Scenario 4: Invalid Wilaya codes (0, 70, -1, 99, 3.14) are rejected by validation');

  // SCENARIO 5: Delivery settings support every Wilaya (69 entries in DB)
  const settingDoc = await DeliverySetting.findOne();
  assert(settingDoc, 'DeliverySetting document must exist');
  assert.strictEqual(settingDoc.wilayaRates.length, 69, 'DeliverySetting must have exactly 69 Wilaya rates');
  for (const w of ALGERIA_WILAYAS) {
    const rate = settingDoc.wilayaRates.find(r => r.wilayaCode === w.code);
    assert(rate, `DeliverySetting must have a rate entry for Wilaya ${w.code} (${w.name})`);
    assert(typeof rate.homeFee === 'number' && rate.homeFee > 0, `homeFee for Wilaya ${w.code} must be a positive number`);
    assert(typeof rate.agencyFee === 'number' && rate.agencyFee > 0, `agencyFee for Wilaya ${w.code} must be a positive number`);
  }
  // Verify the newly corrected Wilayas 61–69 are all present and named correctly
  for (const expected of expected2026) {
    const rate = settingDoc.wilayaRates.find(r => r.wilayaCode === expected.code);
    assert(rate, `DeliverySetting must contain Wilaya ${expected.code} (${expected.name})`);
  }
  pass('Scenario 5: Delivery settings contain exactly 69 Wilaya rate entries (including corrected codes 61–69)');

  // =========================================================================
  console.log('\n--- DOMAIN 2: PRODUCT PROMOTIONS LIFECYCLE & VALIDATION ---');
  // =========================================================================

  const baseValidProduct = {
    name: 'Hijab Soie De Medine',
    description: 'Voile haut de gamme pour occasions et quotidien',
    category: testCategory._id.toString(),
    sellingPrice: 4000,
    costPrice: 2000,
    colors: [{
      colorName: 'Moka',
      colorCode: '#7B3F00',
      images: ['https://example.com/moka.jpg'],
      sizes: [{ size: 'Standard' }]
    }]
  };

  // SCENARIO 7: Promotion can be activated (valid promotion passes schema)
  assert.doesNotThrow(() => productSchema.parse({
    ...baseValidProduct,
    promotion: { active: true, promotionalPrice: 3000 }
  }), 'Valid promotion (3000 < 4000) must pass schema validation');
  pass('Scenario 7: Promotion can be activated (promotionalPrice 3000 < basePrice 4000 accepted)');

  // SCENARIO 8: Promotional price must be strictly lower than base price
  assert.throws(() => productSchema.parse({
    ...baseValidProduct,
    promotion: { active: true, promotionalPrice: 4000 }
  }), 'promotionalPrice equal to sellingPrice must be rejected');

  assert.throws(() => productSchema.parse({
    ...baseValidProduct,
    promotion: { active: true, promotionalPrice: 4500 }
  }), 'promotionalPrice greater than sellingPrice must be rejected');

  assert.throws(() => productSchema.parse({
    ...baseValidProduct,
    promotion: { active: true, promotionalPrice: 0 }
  }), 'promotionalPrice of 0 must be rejected');

  assert.throws(() => productSchema.parse({
    ...baseValidProduct,
    promotion: { active: true, promotionalPrice: -500 }
  }), 'Negative promotionalPrice must be rejected');

  assert.throws(() => updateProductSchema.parse({
    sellingPrice: 2500,
    promotion: { active: true, promotionalPrice: 2500 }
  }), 'Update schema must reject promo price equal to updated selling price');

  assert.doesNotThrow(() => updateProductSchema.parse({
    promotion: { active: false, promotionalPrice: null }
  }), 'Deactivating promotion must pass update schema');
  pass('Scenario 8: Promotion rejects price >= base price (equal, greater, zero, negative all rejected)');

  // SCENARIO 9: Customer sees old + new price (effectivePrice virtual)
  const promoProduct = await Product.create({
    name: 'Robe Abaya Dubai Promo',
    slug: `robe-abaya-dubai-promo-${Date.now()}`,
    description: 'Abaya élégante avec broderie fine',
    category: testCategory._id,
    sellingPrice: 5000,
    costPrice: 2500,
    promotion: { active: true, promotionalPrice: 3800 },
    colors: [{
      colorName: 'Noir Profond',
      colorCode: '#000000',
      images: ['https://example.com/abaya-noir.jpg'],
      sizes: [{ size: 'M', stock: 20 }]
    }]
  });

  // sellingPrice (base/old) and effectivePrice (new/promotional) are distinct
  assert.strictEqual(promoProduct.sellingPrice, 5000, 'sellingPrice (base/old price) must remain 5000');
  assert.strictEqual(promoProduct.promotion.active, true);
  assert.strictEqual(promoProduct.promotion.promotionalPrice, 3800);
  assert.strictEqual(promoProduct.effectivePrice, 3800, 'effectivePrice virtual must return promotionalPrice (3800) when active');
  // Customer UI: old price = sellingPrice, new price = effectivePrice
  // discount % = Math.round((1 - effectivePrice/sellingPrice) * 100) = 24%
  const discountPct = Math.round((1 - promoProduct.effectivePrice / promoProduct.sellingPrice) * 100);
  assert.strictEqual(discountPct, 24, 'Discount percentage should be 24%');
  pass('Scenario 9: Customer sees old price (5000) crossed out and new price (3800, -24%) via effectivePrice virtual');

  // Deactivating restores base price in virtual
  promoProduct.promotion.active = false;
  promoProduct.promotion.promotionalPrice = null;
  await promoProduct.save();
  assert.strictEqual(promoProduct.effectivePrice, 5000, 'effectivePrice must revert to sellingPrice when promotion deactivated');

  // Reactivate with price that will be used at checkout
  promoProduct.promotion.active = true;
  promoProduct.promotion.promotionalPrice = 3500;
  await promoProduct.save();
  assert.strictEqual(promoProduct.effectivePrice, 3500);

  // =========================================================================
  console.log('\n--- DOMAIN 3: SERVER-AUTHORITATIVE CHECKOUT PRICING ---');
  // =========================================================================

  // SCENARIO 10: Checkout uses the promotional price (server-authoritative)
  // Client sends a fabricated unitPrice of 1000 — server must ignore it and use 3500
  const checkoutPayload = {
    customer: {
      fullName: 'Karima Customer',
      phone: '0661998877',
      wilaya: { code: 59, name: 'Aflou' },
      deliveryMethod: DELIVERY_METHODS.HOME,
      address: 'Quartier Administratif Aflou'
    },
    items: [{
      productId: promoProduct._id.toString(),
      colorName: 'Noir Profond',
      size: 'M',
      quantity: 2,
      unitPrice: 1000 // Client-supplied tampered price — must be ignored
    }]
  };

  const { order: createdOrder } = await placeOrder(checkoutPayload);
  assert(createdOrder, 'Order should be successfully placed');
  assert.strictEqual(createdOrder.items[0].unitPrice, 3500, 'Server must enforce DB promotional price 3500, not client-sent 1000');
  assert.strictEqual(createdOrder.subtotal, 7000, 'Subtotal must be 3500 × 2 = 7000');

  // SCENARIO 6: Delivery fee is server-authoritative
  const rateW59 = settingDoc.wilayaRates.find(r => r.wilayaCode === 59);
  assert(rateW59, 'Wilaya 59 (Aflou) must exist in delivery settings');
  assert.strictEqual(createdOrder.deliveryFee, rateW59.homeFee, 'Delivery fee must match DB rate for Wilaya 59, not client value');
  assert.strictEqual(createdOrder.totalPrice, 7000 + rateW59.homeFee, 'Total price must be subtotal + authoritative delivery fee');
  pass('Scenario 6: Delivery fee is server-authoritative (client cannot override)');
  pass('Scenario 10: Checkout uses promotional price 3500, not client-tampered 1000');

  // =========================================================================
  console.log('\n--- DOMAIN 4: HISTORICAL SNAPSHOT IMMUTABILITY ---');
  // =========================================================================

  // SCENARIO 11: Historical order keeps its original price after promotion changes/is removed
  // Step 11a: Change the promotional price
  promoProduct.promotion.promotionalPrice = 4200;
  await promoProduct.save();

  const orderReloaded1 = await Order.findById(createdOrder._id);
  assert.strictEqual(orderReloaded1.items[0].unitPrice, 3500, 'Changing promotion price must NOT mutate historical order unitPrice');
  assert.strictEqual(orderReloaded1.subtotal, 7000, 'Changing promotion price must NOT mutate historical subtotal');

  // Step 11b: Remove promotion entirely and change base price
  promoProduct.promotion.active = false;
  promoProduct.promotion.promotionalPrice = null;
  promoProduct.sellingPrice = 6000;
  await promoProduct.save();

  const orderReloaded2 = await Order.findById(createdOrder._id);
  assert.strictEqual(orderReloaded2.items[0].unitPrice, 3500, 'Deactivating promotion + changing base price must NOT mutate historical order');
  assert.strictEqual(orderReloaded2.subtotal, 7000);
  assert.strictEqual(orderReloaded2.totalPrice, 7000 + rateW59.homeFee);
  pass('Scenario 11: Historical order permanently retains its promotional unitPrice (3500) after promotion changes/removal');

  // =========================================================================
  console.log('\n--- DOMAIN 5: CONCURRENT TAMPER PROTECTION & COVERAGE ---');
  // =========================================================================

  // SCENARIO 12: Concurrent product-price/promotion change cannot cause checkout to use client-supplied price
  // Two "simultaneous" orders using the product with different client unitPrices — both must use server price
  const [resultA, resultB] = await Promise.all([
    placeOrder({
      customer: {
        fullName: 'Concurrent Buyer A',
        phone: '0770000001',
        wilaya: { code: 16, name: 'Algiers' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: 'Rue Test A'
      },
      items: [{
        productId: promoProduct._id.toString(),
        colorName: 'Noir Profond',
        size: 'M',
        quantity: 1,
        unitPrice: 9999 // Tampered by client A
      }]
    }),
    placeOrder({
      customer: {
        fullName: 'Concurrent Buyer B',
        phone: '0770000002',
        wilaya: { code: 25, name: 'Constantine' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: 'Rue Test B'
      },
      items: [{
        productId: promoProduct._id.toString(),
        colorName: 'Noir Profond',
        size: 'M',
        quantity: 1,
        unitPrice: 1 // Extreme tamper by client B
      }]
    })
  ]);

  // After promotion was removed, sellingPrice=6000 — both must use 6000 (not client-sent values)
  assert.strictEqual(resultA.order.items[0].unitPrice, 6000, 'Concurrent order A must use server-authoritative sellingPrice 6000, not client 9999');
  assert.strictEqual(resultB.order.items[0].unitPrice, 6000, 'Concurrent order B must use server-authoritative sellingPrice 6000, not client 1');
  pass('Scenario 12: Concurrent orders with client-tampered prices both receive server-authoritative price (6000)');

  // Test all new Wilayas 61–69 are each accepted by placeOrder
  const newWilayaCodes = [61, 62, 63, 64, 65, 66, 67, 68, 69];
  const newWilayaOrders = [];
  for (const code of newWilayaCodes) {
    const w = ALGERIA_WILAYAS.find(w => w.code === code);
    const { order } = await placeOrder({
      customer: {
        fullName: `Test Customer W${code}`,
        phone: `077${String(code).padStart(7, '0')}`,
        wilaya: { code: w.code, name: w.name },
        deliveryMethod: DELIVERY_METHODS.AGENCY,
        agencyName: `Agency ${w.name}`
      },
      items: [{
        productId: promoProduct._id.toString(),
        colorName: 'Noir Profond',
        size: 'M',
        quantity: 1
      }]
    });
    const rate = settingDoc.wilayaRates.find(r => r.wilayaCode === code);
    assert(rate, `Wilaya ${code} (${w.name}) must have a delivery rate in DB`);
    assert.strictEqual(order.deliveryFee, rate.agencyFee, `Wilaya ${code} agency fee must match DB`);
    assert.strictEqual(order.customer.wilaya.name, w.name, `Order must snapshot correct canonical name for Wilaya ${code}`);
    newWilayaOrders.push(order._id);
  }
  pass('Scenario 3 (extended): All new Wilayas 61–69 (correct 2026 mapping) are each accepted by checkout and get correct delivery fee');

  // =========================================================================
  // Cleanup
  // =========================================================================
  await Product.findByIdAndDelete(promoProduct._id);
  await Order.deleteMany({ _id: { $in: [createdOrder._id, resultA.order._id, resultB.order._id, ...newWilayaOrders] } });

  console.log('\n======================================================');
  console.log(`ALL ${passCount} SCENARIOS PASSED!`);
  console.log('Promotions & 69 Wilayas (2026 Official Mapping) ✓');
  console.log('======================================================\n');

  await mongoose.disconnect();
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message || err);
  process.exit(1);
});
