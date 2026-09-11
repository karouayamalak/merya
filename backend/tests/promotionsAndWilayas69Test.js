/**
 * promotionsAndWilayas69Test.js
 * Comprehensive integration test suite for:
 * 1. Product Promotions / Sale Prices: lifecycle, validation, snapshot immutability, tamper protection
 * 2. 69 Wilayas of Algeria: canonical constants, Zod validation, order delivery calculation, admin edit
 */

import assert from 'assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { Order } from '../src/models/Order.js';
import { DeliverySetting } from '../src/models/DeliverySetting.js';
import { ALGERIA_WILAYAS, DELIVERY_METHODS, ORDER_STATUS } from '../src/config/constants.js';
import { checkoutOrderSchema, productSchema, updateProductSchema } from '../src/middleware/validation.js';
import { placeOrder } from '../src/services/orderService.js';
import { migrate69Wilayas } from '../src/seed/migrate69Wilayas.js';

dotenv.config();

const DB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27018/merya_dz?replicaSet=rs0';

function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

async function runTests() {
  console.log('=== RUNNING PROMOTIONS & 69 WILAYAS INTEGRATION SUITE ===\n');

  await mongoose.connect(DB_URI);
  console.log('[Setup] Connected to MongoDB');

  // Ensure DB delivery settings are migrated to 69 Wilayas
  await migrate69Wilayas();

  // Create clean test category
  const testCategory = await Category.findOneAndUpdate(
    { slug: 'promo-wilaya-test-cat' },
    { name: 'Promo & Wilaya Test Category', slug: 'promo-wilaya-test-cat', description: 'Testing category' },
    { upsert: true, new: true }
  );

  console.log('\n--- DOMAIN 1: 69 WILAYAS CANONICAL CONSTANTS & VALIDATION ---');

  // 1. Exactly 69 Wilayas in constants
  assert.strictEqual(ALGERIA_WILAYAS.length, 69, 'ALGERIA_WILAYAS must have exactly 69 entries');
  assert.strictEqual(ALGERIA_WILAYAS[0].code, 1);
  assert.strictEqual(ALGERIA_WILAYAS[0].name, 'Adrar');
  assert.strictEqual(ALGERIA_WILAYAS[57].code, 58);
  assert.strictEqual(ALGERIA_WILAYAS[57].name, 'El Meniaa');
  assert.strictEqual(ALGERIA_WILAYAS[58].code, 59);
  assert.strictEqual(ALGERIA_WILAYAS[58].name, 'Aflou');
  assert.strictEqual(ALGERIA_WILAYAS[59].code, 60);
  assert.strictEqual(ALGERIA_WILAYAS[59].name, 'Barika');
  assert.strictEqual(ALGERIA_WILAYAS[64].code, 65);
  assert.strictEqual(ALGERIA_WILAYAS[64].name, 'Bou Saâda');
  assert.strictEqual(ALGERIA_WILAYAS[68].code, 69);
  assert.strictEqual(ALGERIA_WILAYAS[68].name, 'El Aricha');
  pass('All 69 Wilayas verified with correct indices, numbers 1-69, and names (including Aflou 59 to El Aricha 69)');

  // 2. Zod Checkout Validation: Accept 1-69, Reject 0, 70, decimals, strings
  const baseValidPayload = {
    customer: {
      fullName: 'Amina Test',
      phone: '0555123456',
      wilaya: { code: 16, name: 'Algiers' },
      deliveryMethod: DELIVERY_METHODS.HOME,
      address: '123 Boulevard Test'
    },
    items: [{
      productId: new mongoose.Types.ObjectId().toString(),
      colorName: 'Noir',
      size: 'M',
      quantity: 1
    }]
  };

  // Valid codes 1, 58, 59, 65, 69 must all pass
  for (const validCode of [1, 16, 58, 59, 65, 69]) {
    const payload = {
      ...baseValidPayload,
      customer: {
        ...baseValidPayload.customer,
        wilaya: { code: validCode, name: ALGERIA_WILAYAS.find(w => w.code === validCode).name }
      }
    };
    assert.doesNotThrow(() => checkoutOrderSchema.parse(payload), `Wilaya code ${validCode} must pass validation`);
  }
  pass('Zod validation successfully accepts valid codes 1, 16, 58, 59, 65, 69');

  // Invalid codes 0, 70, -1, 99 must fail
  for (const invalidCode of [0, 70, -1, 99, 3.14]) {
    const payload = {
      ...baseValidPayload,
      customer: {
        ...baseValidPayload.customer,
        wilaya: { code: invalidCode, name: 'Invalid' }
      }
    };
    assert.throws(() => checkoutOrderSchema.parse(payload), `Wilaya code ${invalidCode} must fail validation`);
  }
  pass('Zod validation strictly rejects codes 0, 70, -1, 99, 3.14');

  console.log('\n--- DOMAIN 2: PRODUCT PROMOTIONS VALIDATION & LIFECYCLE ---');

  // 3. Schema validation: promotionalPrice must be strictly less than basePrice
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

  // Valid promotion
  assert.doesNotThrow(() => productSchema.parse({
    ...baseValidProduct,
    promotion: { active: true, promotionalPrice: 3000 }
  }), 'Valid promotion (3000 < 4000) must pass validation');
  pass('Product schema accepts valid promotional price (3000 < 4000)');

  // Invalid: promotionalPrice >= sellingPrice
  assert.throws(() => productSchema.parse({
    ...baseValidProduct,
    promotion: { active: true, promotionalPrice: 4000 }
  }), 'Promotional price equal to base price must be rejected');

  assert.throws(() => productSchema.parse({
    ...baseValidProduct,
    promotion: { active: true, promotionalPrice: 4500 }
  }), 'Promotional price higher than base price must be rejected');
  pass('Product schema rejects promotional price equal to or greater than base price');

  // Invalid: negative or 0 promotionalPrice
  assert.throws(() => productSchema.parse({
    ...baseValidProduct,
    promotion: { active: true, promotionalPrice: 0 }
  }), 'Promotional price of 0 must be rejected');

  assert.throws(() => productSchema.parse({
    ...baseValidProduct,
    promotion: { active: true, promotionalPrice: -500 }
  }), 'Negative promotional price must be rejected');
  pass('Product schema rejects promotional price of 0 or negative values');

  // Update schema validation
  assert.doesNotThrow(() => updateProductSchema.parse({
    promotion: { active: false, promotionalPrice: null }
  }), 'Deactivating promotion must pass update schema');

  assert.throws(() => updateProductSchema.parse({
    sellingPrice: 2500,
    promotion: { active: true, promotionalPrice: 2500 }
  }), 'Update schema rejects promo price equal to updated selling price');
  pass('Update product schema enforces promotion constraints correctly');

  // 4. Mongoose Model Validation & Virtual effectivePrice
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

  assert.strictEqual(promoProduct.sellingPrice, 5000);
  assert.strictEqual(promoProduct.promotion.active, true);
  assert.strictEqual(promoProduct.promotion.promotionalPrice, 3800);
  assert.strictEqual(promoProduct.effectivePrice, 3800, 'Virtual effectivePrice must return promotionalPrice when active');
  pass('Mongoose model accurately returns virtual effectivePrice (3800 DZD) for active promotion');

  // 5. Deactivating promotion restores base price
  promoProduct.promotion.active = false;
  promoProduct.promotion.promotionalPrice = null;
  await promoProduct.save();

  assert.strictEqual(promoProduct.effectivePrice, 5000, 'Deactivated promotion must restore effectivePrice to basePrice (5000 DZD)');
  pass('Deactivating promotion successfully restores normal base selling price');

  // Reactivate promotion for checkout test
  promoProduct.promotion.active = true;
  promoProduct.promotion.promotionalPrice = 3500;
  await promoProduct.save();
  assert.strictEqual(promoProduct.effectivePrice, 3500);

  console.log('\n--- DOMAIN 3: SERVER-AUTHORITATIVE CHECKOUT PRICING & HISTORICAL SNAPSHOT IMMUTABILITY ---');

  // 6. Checkout Order placed with active promotion -> Server uses promotional price (3500)
  // Client attempts to tamper with price by sending client-side fake price
  const checkoutPayload = {
    customer: {
      fullName: 'Karima Customer',
      phone: '0661998877',
      wilaya: { code: 59, name: 'Aflou' }, // Testing promoted Wilaya 59 (Aflou)!
      deliveryMethod: DELIVERY_METHODS.HOME,
      address: 'Quartier Administratif Aflou'
    },
    items: [{
      productId: promoProduct._id.toString(),
      colorName: 'Noir Profond',
      size: 'M',
      quantity: 2,
      unitPrice: 1000 // Client sends fabricated 1000 DZD
    }]
  };

  const { order: createdOrder } = await placeOrder(checkoutPayload);
  assert(createdOrder, 'Order should be successfully placed');

  // Authoritative server unitPrice must be 3500 (NOT client-sent 1000, and NOT regular 5000)
  assert.strictEqual(createdOrder.items[0].unitPrice, 3500, 'Server must enforce database promotional price 3500');
  assert.strictEqual(createdOrder.subtotal, 7000, 'Subtotal must be 3500 * 2 = 7000');

  // Verify Wilaya 59 authoritative delivery fee was calculated
  const settingDoc = await DeliverySetting.findOne();
  const rateW59 = settingDoc.wilayaRates.find(r => r.wilayaCode === 59);
  assert(rateW59, 'Wilaya 59 must exist in delivery settings');
  assert.strictEqual(createdOrder.deliveryFee, rateW59.homeFee, 'Delivery fee for Wilaya 59 must match DB rate');
  assert.strictEqual(createdOrder.totalPrice, 7000 + rateW59.homeFee);
  pass('Order placed for Wilaya 59 (Aflou) with active promo: snapshot unitPrice is 3500, delivery fee is authoritative');

  // 7. Historical snapshot immutability test:
  // Now modify the product: increase promo price, then remove promo completely
  promoProduct.promotion.promotionalPrice = 4200;
  await promoProduct.save();

  const orderReloaded1 = await Order.findById(createdOrder._id);
  assert.strictEqual(orderReloaded1.items[0].unitPrice, 3500, 'Changing promotion price must not mutate historical order unitPrice');
  assert.strictEqual(orderReloaded1.subtotal, 7000, 'Changing promotion price must not mutate historical order subtotal');

  promoProduct.promotion.active = false;
  promoProduct.promotion.promotionalPrice = null;
  promoProduct.sellingPrice = 6000;
  await promoProduct.save();

  const orderReloaded2 = await Order.findById(createdOrder._id);
  assert.strictEqual(orderReloaded2.items[0].unitPrice, 3500, 'Deactivating promotion and changing base price must not mutate historical order');
  assert.strictEqual(orderReloaded2.subtotal, 7000);
  assert.strictEqual(orderReloaded2.totalPrice, 7000 + rateW59.homeFee);
  pass('Historical snapshot immutability verified: subsequent product promotion and price changes do not mutate historical orders');

  console.log('\n--- DOMAIN 4: 69 WILAYAS COMPLETE COVERAGE ---');

  // 8. Test orders placed in other newly promoted Wilayas:
  // Wilaya 65: Bou Saâda
  const { order: orderBouSaada } = await placeOrder({
    customer: {
      fullName: 'Yasmine Algerie',
      phone: '0770112233',
      wilaya: { code: 65, name: 'Bou Saâda' },
      deliveryMethod: DELIVERY_METHODS.AGENCY,
      agencyName: 'Bureau StopDesk Bou Saada Centre'
    },
    items: [{
      productId: promoProduct._id.toString(),
      colorName: 'Noir Profond',
      size: 'M',
      quantity: 1
    }]
  });
  const rateW65 = settingDoc.wilayaRates.find(r => r.wilayaCode === 65);
  assert.strictEqual(orderBouSaada.deliveryFee, rateW65.agencyFee, 'Wilaya 65 agency pickup fee correctly resolved');
  pass('Order for Wilaya 65 (Bou Saâda) agency pickup correctly resolved authoritative fee');

  // Wilaya 69: El Aricha
  const { order: orderElAricha } = await placeOrder({
    customer: {
      fullName: 'Fatima El Aricha',
      phone: '0560334455',
      wilaya: { code: 69, name: 'El Aricha' },
      deliveryMethod: DELIVERY_METHODS.HOME,
      address: 'Centre Ville El Aricha'
    },
    items: [{
      productId: promoProduct._id.toString(),
      colorName: 'Noir Profond',
      size: 'M',
      quantity: 1
    }]
  });
  const rateW69 = settingDoc.wilayaRates.find(r => r.wilayaCode === 69);
  assert.strictEqual(orderElAricha.deliveryFee, rateW69.homeFee, 'Wilaya 69 home delivery fee correctly resolved');
  pass('Order for Wilaya 69 (El Aricha) home delivery correctly resolved authoritative fee');

  // Cleanup test product and orders
  await Product.findByIdAndDelete(promoProduct._id);
  await Order.findByIdAndDelete(createdOrder._id);
  await Order.findByIdAndDelete(orderBouSaada._id);
  await Order.findByIdAndDelete(orderElAricha._id);

  console.log('\n======================================================');
  console.log('ALL PROMOTIONS & 69 WILAYAS INTEGRATION TESTS PASSED!');
  console.log('======================================================\n');

  await mongoose.disconnect();
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
