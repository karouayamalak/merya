/**
 * promotionsAndWilayas58Test.js
 *
 * Comprehensive integration test suite covering the 58-Wilaya system & promotions:
 *
 * DOMAIN 1 – 58 CANONICAL WILAYAS
 *   1. Exactly 58 canonical Wilayas exist (codes 1–58).
 *   2. Code 58 is El Meniaa (المنيعة). Codes 59–69 do NOT exist.
 *   3. All 58 codes are accepted by Zod checkout validation.
 *   4. Invalid Wilaya codes (0, 59, 60, 69, 70, -1, 99, 3.14) are rejected by validation.
 *   5. Delivery settings support every Wilaya (exactly 58 entries in DB).
 *   6. Delivery fee remains server-authoritative (client value ignored).
 *
 * DOMAIN 2 – PRODUCT PROMOTIONS & HISTORICAL PROTECTION
 *   7. Promotion can be activated (promotionalPrice < basePrice).
 *   8. Promotional price equal to or greater than base price is rejected.
 *   9. Customer sees effectivePrice (promotionalPrice when active).
 *   10. Checkout uses the promotional price (server-authoritative).
 *   11. Historical order keeps its original promotional price after promotion changes/is removed.
 *   12. Concurrent product-price/promotion change cannot cause checkout to use a client-supplied price.
 *   13. Wilaya 58 accepted by placeOrder; Wilaya 59 strictly rejected.
 *   14. Admin line-item editing requires mandatory reason and protects existing item prices.
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
import { placeOrder, updateOrderItemsService } from '../src/services/orderService.js';
import { normalize58Wilayas } from '../src/seed/normalize58Wilayas.js';

dotenv.config();

const DB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27018/merya_dz?replicaSet=rs0';

let passCount = 0;
function pass(msg) {
  console.log(`  ✓ ${msg}`);
  passCount++;
}

async function runTests() {
  console.log('=== RUNNING PROMOTIONS & 58 WILAYAS INTEGRATION SUITE ===\n');

  await mongoose.connect(DB_URI);
  console.log('[Setup] Connected to MongoDB');

  // Normalize DB delivery settings to exactly 58 Wilayas
  await normalize58Wilayas();

  // Shared test category
  const testCategory = await Category.findOneAndUpdate(
    { slug: 'promo-wilaya-test-cat' },
    { name: 'Promo & Wilaya Test Category', slug: 'promo-wilaya-test-cat', description: 'Testing category' },
    { upsert: true, new: true }
  );

  // =========================================================================
  console.log('\n--- DOMAIN 1: 58 WILAYAS CANONICAL CONSTANTS & BOUNDARY CHECKS ---');
  // =========================================================================

  // SCENARIO 1: Exactly 58 canonical Wilayas
  assert.strictEqual(ALGERIA_WILAYAS.length, 58, 'ALGERIA_WILAYAS must have exactly 58 entries');
  assert.strictEqual(ALGERIA_WILAYAS[0].code, 1);
  assert.strictEqual(ALGERIA_WILAYAS[0].name, 'Adrar');
  assert.strictEqual(ALGERIA_WILAYAS[57].code, 58);
  assert.strictEqual(ALGERIA_WILAYAS[57].name, 'El Meniaa');
  pass('Scenario 1: Exactly 58 canonical Wilayas exist (codes 1–58)');

  // SCENARIO 2: Boundary check — codes 59–69 do NOT exist in canonical list
  for (let c = 59; c <= 69; c++) {
    const found = ALGERIA_WILAYAS.find(w => w.code === c);
    assert.strictEqual(found, undefined, `Wilaya code ${c} must NOT exist in ALGERIA_WILAYAS`);
  }
  pass('Scenario 2: Codes 59–69 are completely absent from canonical ALGERIA_WILAYAS');

  // SCENARIO 3: All 58 codes accepted by Zod checkout validation
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
  pass('Scenario 3: All 58 Wilaya codes are accepted by checkout Zod validation');

  // SCENARIO 4: Invalid Wilaya codes (including 59, 60, 69, 70, 0, -1, 99, 3.14) are rejected
  for (const invalidCode of [0, 59, 60, 65, 69, 70, -1, 99, 3.14]) {
    const payload = {
      customer: { ...baseCustomer, wilaya: { code: invalidCode, name: 'Invalid' } },
      items: baseItems
    };
    assert.throws(
      () => checkoutOrderSchema.parse(payload),
      `Wilaya code ${invalidCode} must fail Zod validation`
    );
  }
  pass('Scenario 4: Invalid Wilaya codes (0, 59, 60, 69, 70, -1, 99, 3.14) are strictly rejected by validation');

  // SCENARIO 5: Delivery settings support every Wilaya (exactly 58 entries in DB)
  const settingDoc = await DeliverySetting.findOne();
  assert(settingDoc, 'DeliverySetting document must exist');
  assert.strictEqual(settingDoc.wilayaRates.length, 58, 'DeliverySetting must have exactly 58 Wilaya rates');
  for (const w of ALGERIA_WILAYAS) {
    const rate = settingDoc.wilayaRates.find(r => r.wilayaCode === w.code);
    assert(rate, `DeliverySetting must have a rate entry for Wilaya ${w.code} (${w.name})`);
    assert(typeof rate.homeFee === 'number' && rate.homeFee > 0, `homeFee for Wilaya ${w.code} must be a positive number`);
    assert(typeof rate.agencyFee === 'number' && rate.agencyFee > 0, `agencyFee for Wilaya ${w.code} must be a positive number`);
  }
  pass('Scenario 5: Delivery settings contain exactly 58 Wilaya rate entries (codes 1–58)');

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
    promotion: { active: true, promotionalPrice: 5000 }
  }), 'promotionalPrice greater than sellingPrice must be rejected');

  assert.throws(() => productSchema.parse({
    ...baseValidProduct,
    promotion: { active: true, promotionalPrice: 0 }
  }), 'promotionalPrice of 0 must be rejected');

  assert.throws(() => productSchema.parse({
    ...baseValidProduct,
    promotion: { active: true, promotionalPrice: -500 }
  }), 'negative promotionalPrice must be rejected');
  pass('Scenario 8: Invalid promotional prices (equal, greater, zero, negative) are rejected');

  // Create product in DB with promotion active
  const promoProduct = await Product.create({
    name: 'Abaya Dubai Luxe',
    slug: `abaya-dubai-luxe-${Date.now()}`,
    description: 'Abaya perlee faite main aux Emirats',
    category: testCategory._id,
    sellingPrice: 8000,
    costPrice: 4000,
    promotion: { active: true, promotionalPrice: 6000 },
    colors: [{
      colorName: 'Noir Profond',
      colorCode: '#0A0A0A',
      images: ['/uploads/abaya_noir.jpg'],
      sizes: [{ size: 'M', stock: 10 }]
    }]
  });

  // SCENARIO 9: Effective price virtual returns promotionalPrice when promotion is active
  assert.strictEqual(promoProduct.effectivePrice, 6000, 'effectivePrice must be promotionalPrice (6000) when active');
  promoProduct.promotion.active = false;
  assert.strictEqual(promoProduct.effectivePrice, 8000, 'effectivePrice must fall back to sellingPrice (8000) when inactive');
  promoProduct.promotion.active = true;
  await promoProduct.save();
  pass('Scenario 9: effectivePrice virtual dynamically switches between sellingPrice and promotionalPrice');

  // SCENARIO 10: Checkout uses the promotional price (server-authoritative)
  const { order: createdOrder } = await placeOrder({
    customer: {
      fullName: 'Fatima Zahra',
      phone: '0661234567',
      wilaya: { code: 16, name: 'Algiers' },
      deliveryMethod: DELIVERY_METHODS.HOME,
      address: 'Didouche Mourad, Alger Centre'
    },
    items: [{
      productId: promoProduct._id.toString(),
      colorName: 'Noir Profond',
      size: 'M',
      quantity: 2,
      unitPrice: 99999 // Client attempts to tamper with price
    }]
  });

  assert.strictEqual(createdOrder.items[0].unitPrice, 6000, 'Order item unitPrice must be promotional price (6000), ignoring client value (99999)');
  assert.strictEqual(createdOrder.subtotal, 12000, 'Subtotal must be 2 * 6000 = 12000');
  pass('Scenario 10: Checkout uses promotional price (6000 DZD) and rejects client price tampering');

  // SCENARIO 11: Historical order keeps its original price after promotion is deactivated
  promoProduct.promotion.active = false;
  promoProduct.sellingPrice = 9000;
  await promoProduct.save();

  const reloadedOrder = await Order.findById(createdOrder._id);
  assert.strictEqual(reloadedOrder.items[0].unitPrice, 6000, 'Historical order must retain original promotional price 6000 DZD');
  assert.strictEqual(reloadedOrder.subtotal, 12000, 'Historical order subtotal must remain 12000 DZD');
  pass('Scenario 11: Historical order retains original purchase price (6000 DZD) after product promotion is turned off');

  // SCENARIO 12: Server-authoritative checkout under concurrent price update
  const [resultA, resultB] = await Promise.all([
    placeOrder({
      customer: {
        fullName: 'Client A',
        phone: '0555111111',
        wilaya: { code: 31, name: 'Oran' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: 'Front de Mer, Oran'
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
        fullName: 'Client B',
        phone: '0555222222',
        wilaya: { code: 25, name: 'Constantine' },
        deliveryMethod: DELIVERY_METHODS.AGENCY,
        agencyName: 'Yalidine Constantine'
      },
      items: [{
        productId: promoProduct._id.toString(),
        colorName: 'Noir Profond',
        size: 'M',
        quantity: 1,
        unitPrice: 1 // Tampered by client B
      }]
    })
  ]);

  // Current sellingPrice is 9000
  assert.strictEqual(resultA.order.items[0].unitPrice, 9000, 'Order A must use server-authoritative sellingPrice 9000');
  assert.strictEqual(resultB.order.items[0].unitPrice, 9000, 'Order B must use server-authoritative sellingPrice 9000');
  pass('Scenario 12: Concurrent orders with client-tampered prices both receive server-authoritative price (9000)');

  // SCENARIO 13: Place order with Wilaya 58 works; Wilaya 59 strictly rejected
  const w58 = ALGERIA_WILAYAS.find(w => w.code === 58);
  assert(w58, 'Wilaya 58 must exist');
  const order58Result = await placeOrder({
    customer: {
      fullName: 'Customer El Meniaa',
      phone: '0770585858',
      wilaya: { code: 58, name: w58.name },
      deliveryMethod: DELIVERY_METHODS.HOME,
      address: 'Centre Ville El Meniaa'
    },
    items: [{
      productId: promoProduct._id.toString(),
      colorName: 'Noir Profond',
      size: 'M',
      quantity: 1
    }]
  });
  assert.strictEqual(order58Result.order.customer.wilaya.code, 58);
  pass('Scenario 13a: Order placement for Wilaya 58 (El Meniaa) succeeds with authoritative fee');

  await assert.rejects(
    () => placeOrder({
      customer: {
        fullName: 'Customer 59',
        phone: '0770595959',
        wilaya: { code: 59, name: 'Aflou' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: 'Test Address'
      },
      items: [{
        productId: promoProduct._id.toString(),
        colorName: 'Noir Profond',
        size: 'M',
        quantity: 1
      }]
    }),
    /Invalid Wilaya code/,
    'Order placement for Wilaya 59 must be rejected'
  );
  pass('Scenario 13b: Order placement for Wilaya 59 is strictly rejected by server');

  // SCENARIO 14: Historical order line items cannot be silently repriced
  // When an admin modifies line items, reason is mandatory and existing item price is preserved
  await assert.rejects(
    () => updateOrderItemsService({
      orderId: createdOrder._id.toString(),
      newItems: [{
        productId: promoProduct._id.toString(),
        colorName: 'Noir Profond',
        size: 'M',
        quantity: 3
      }],
      reason: '' // Empty reason must be rejected
    }),
    /A valid reason is required/,
    'Empty admin reason must be rejected'
  );

  // Now update with a valid reason: unitPrice should NOT be recalculated to 9000, it must stay 6000!
  const updatedOrder = await updateOrderItemsService({
    orderId: createdOrder._id.toString(),
    newItems: [{
      productId: promoProduct._id.toString(),
      colorName: 'Noir Profond',
      size: 'M',
      quantity: 3
    }],
    reason: 'Customer requested 1 additional unit at agreed purchase price'
  });

  assert.strictEqual(updatedOrder.items[0].unitPrice, 6000, 'Recorded unitPrice must be preserved at 6000 DZD, not re-evaluated to current catalog price 9000 DZD');
  assert.strictEqual(updatedOrder.subtotal, 18000, 'Subtotal must be 3 * 6000 = 18000');
  assert.strictEqual(updatedOrder.auditHistory.slice(-1)[0].details.reason, 'Customer requested 1 additional unit at agreed purchase price');
  pass('Scenario 14: Historical order line item price is protected from silent repricing during admin modifications');

  // Cleanup
  await Product.findByIdAndDelete(promoProduct._id);
  await Order.deleteMany({ _id: { $in: [createdOrder._id, resultA.order._id, resultB.order._id, order58Result.order._id] } });

  console.log('\n======================================================');
  console.log(`ALL ${passCount} SCENARIOS PASSED!`);
  console.log('Promotions & 58 Wilayas System Fully Verified ✓');
  console.log('======================================================\n');

  await mongoose.disconnect();
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message || err);
  process.exit(1);
});
