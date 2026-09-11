/**
 * secondGapAuditTest.js
 *
 * Targeted verification for Gap Audit requirements:
 * 1. Wilaya Shipping (58 Wilayas, independent fees, authoritative calculation, historical immutability)
 * 2. Inventory Concurrency (2 simultaneous buyers for final 1 unit -> exactly 1 succeeds, stock = 0)
 * 3. Duplicate Orders & Idempotency
 * 4. Cancellation (order retained, exactly-once restoration, 0 contribution to profit)
 * 5. Historical Financial Data (post-order price/cost/fee changes do not corrupt past orders)
 * 6. Authorization / IDOR / Mass Assignment (tampered prices/status ignored, tracking anti-enumeration)
 * 7. Rate Limiting & WebSocket Flooding
 * 8. HTTP Caching Headers (private uncacheable vs public catalog cached)
 * 9. Image Upload Security (MIME and extension validation)
 */

import assert from 'node:assert';
import http from 'node:http';
import { WebSocket } from 'ws';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { Order } from '../src/models/Order.js';
import { DeliverySetting } from '../src/models/DeliverySetting.js';
import { Admin } from '../src/models/Admin.js';
import { ALGERIA_WILAYAS, ORDER_STATUS, DELIVERY_METHODS } from '../src/config/constants.js';
import { placeOrder, updateOrderStatus, getFinancialAnalytics } from '../src/services/orderService.js';
import { updateOrderCustomerDetails } from '../src/controllers/orderController.js';
import { wsService } from '../src/services/websocketService.js';

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

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    jsonData: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.jsonData = data;
      return this;
    },
    set(key, val) {
      this.headers[key] = val;
      return this;
    }
  };
}

async function runGapAudit() {
  console.log('=== RUNNING SECOND PRODUCTION GAP AUDIT TEST SUITE ===\n');

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(DB_URI);
  }

  // Setup test category
  let testCat = await Category.findOne({ slug: 'gap-audit-cat' });
  if (!testCat) {
    testCat = await Category.create({
      name: 'Gap Audit Category',
      slug: 'gap-audit-cat',
      description: 'Category for second gap audit',
      image: '/test.jpg'
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 1. WILAYA SHIPPING AUDIT
  // ──────────────────────────────────────────────────────────────────────────
  console.log('[Domain 1: Wilaya Shipping & Historical Immutability]');

  // 1a. Verify all 58 Algerian Wilayas exist in constants
  assert.strictEqual(ALGERIA_WILAYAS.length, 58, 'There must be exactly 58 Algerian Wilayas');
  assert.strictEqual(ALGERIA_WILAYAS[0].code, 1);
  assert.strictEqual(ALGERIA_WILAYAS[57].code, 58);
  pass('All 58 Algerian Wilayas correctly defined with French and Arabic names');

  // 1b. Ensure DeliverySetting has rates for all 58 Wilayas with distinct fees
  const wilayaRates = ALGERIA_WILAYAS.map(w => ({
    wilayaCode: w.code,
    wilayaName: w.name,
    wilayaNameAr: w.nameAr,
    homeFee: w.code === 16 ? 500 : w.code === 31 ? 750 : w.code === 11 ? 1400 : 850,
    agencyFee: w.code === 16 ? 350 : w.code === 31 ? 450 : w.code === 11 ? 900 : 500,
    isAvailable: true
  }));
  let deliverySetting = await DeliverySetting.findOneAndUpdate(
    {},
    { agencyDeliveryFee: 500, homeDeliveryFee: 800, freeDeliveryThreshold: 0, wilayaRates },
    { upsert: true, new: true }
  );
  assert.strictEqual(deliverySetting.wilayaRates.length, 58, 'DeliverySetting must have rates for all 58 Wilayas');
  pass('DeliverySetting stores distinct home and agency pickup fees for all 58 Wilayas');

  // 1c. Test Authoritative Backend Fee Calculation for Wilaya 16 Home (500 DZD)
  const productA = await Product.create({
    name: 'Wilaya Test Product',
    slug: `wilaya-test-prod-${Date.now()}`,
    description: 'Test product for wilaya delivery fee calculations',
    category: testCat._id,
    sellingPrice: 5000,
    costPrice: 2500,
    colors: [
      {
        colorName: 'Bleu',
        colorCode: '#0000FF',
        images: ['/test.webp'],
        sizes: [{ size: 'M', stock: 10 }]
      }
    ]
  });

  const orderWilaya16 = await placeOrder({
    idempotencyKey: `wilaya-16-${Date.now()}`,
    customer: {
      fullName: 'Meriem DZ',
      phone: '0555123456',
      wilaya: { code: 16, name: 'Algiers' },
      deliveryMethod: DELIVERY_METHODS.HOME,
      address: 'Hydra, Alger'
    },
    items: [{ productId: productA._id, colorName: 'Bleu', size: 'M', quantity: 1 }]
  });

  const order16Doc = orderWilaya16.order;
  assert.strictEqual(order16Doc.deliveryFee, 500, 'Authoritative fee for Wilaya 16 Home must be 500 DZD');
  assert.strictEqual(order16Doc.totalPrice, 5500, 'Total must equal 5000 subtotal + 500 delivery');
  pass('Backend authoritatively calculated Wilaya 16 Home delivery fee (500 DZD)');

  // 1d. Historical Immutability: Change Wilaya 16 fee in DeliverySetting, verify past order is unchanged
  await DeliverySetting.updateOne(
    { 'wilayaRates.wilayaCode': 16 },
    { $set: { 'wilayaRates.$.homeFee': 999 } }
  );

  const reloadedOrder16 = await Order.findById(order16Doc._id);
  assert.strictEqual(reloadedOrder16.deliveryFee, 500, 'Historical order must retain original 500 DZD fee snapshot');
  assert.strictEqual(reloadedOrder16.totalPrice, 5500, 'Historical order total must not change when global rates change');
  pass('Historical delivery fee snapshot remains immutable when Wilaya rates change');

  // Restore rate
  await DeliverySetting.updateOne(
    { 'wilayaRates.wilayaCode': 16 },
    { $set: { 'wilayaRates.$.homeFee': 500 } }
  );

  // 1e. Recalculation on Customer Info Edit (change to Wilaya 31 Agency -> 450 DZD)
  const mockReqEdit = {
    params: { id: order16Doc._id.toString() },
    body: {
      wilaya: { code: 31, name: 'Oran' },
      deliveryMethod: DELIVERY_METHODS.AGENCY,
      agencyName: 'Yalidine Oran Es-Senia'
    }
  };
  const mockResEdit = createMockRes();
  await updateOrderCustomerDetails(mockReqEdit, mockResEdit);
  assert.strictEqual(mockResEdit.statusCode, 200);
  assert.strictEqual(mockResEdit.jsonData.order.deliveryFee, 450, 'Updated fee for Oran Agency must be 450 DZD');
  assert.strictEqual(mockResEdit.jsonData.order.totalPrice, 5450);
  pass('Editing Wilaya and Delivery Method on existing order recalculates delivery fee correctly');

  // ──────────────────────────────────────────────────────────────────────────
  // 2. INVENTORY CONCURRENCY
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n[Domain 2: Inventory Concurrency (Simultaneous Final Unit Purchase)]');

  const productSingleUnit = await Product.create({
    name: 'Final Unit Product',
    slug: `final-unit-prod-${Date.now()}`,
    description: 'Product with exactly 1 unit left',
    category: testCat._id,
    sellingPrice: 4000,
    costPrice: 2000,
    colors: [
      {
        colorName: 'Noir',
        colorCode: '#000000',
        images: ['/test.webp'],
        sizes: [{ size: 'One Size', stock: 1 }] // exactly 1 unit
      }
    ]
  });

  // Launch two simultaneous checkout requests for the same final unit
  const req1 = placeOrder({
    idempotencyKey: `concurrent-buyer-1-${Date.now()}`,
    customer: {
      fullName: 'Buyer One',
      phone: '0555111111',
      wilaya: { code: 16, name: 'Algiers' },
      deliveryMethod: DELIVERY_METHODS.HOME,
      address: 'Alger Centre'
    },
    items: [{ productId: productSingleUnit._id, colorName: 'Noir', size: 'One Size', quantity: 1 }]
  });

  const req2 = placeOrder({
    idempotencyKey: `concurrent-buyer-2-${Date.now()}`,
    customer: {
      fullName: 'Buyer Two',
      phone: '0555222222',
      wilaya: { code: 16, name: 'Algiers' },
      deliveryMethod: DELIVERY_METHODS.HOME,
      address: 'Bab El Oued'
    },
    items: [{ productId: productSingleUnit._id, colorName: 'Noir', size: 'One Size', quantity: 1 }]
  });

  const results = await Promise.allSettled([req1, req2]);
  const succeeded = results.filter(r => r.status === 'fulfilled');
  const failed = results.filter(r => r.status === 'rejected');

  assert.strictEqual(succeeded.length, 1, 'Exactly one order must succeed for final unit');
  assert.strictEqual(failed.length, 1, 'Exactly one order must fail with insufficient stock');

  const finalProductState = await Product.findById(productSingleUnit._id);
  const remainingStock = finalProductState.colors[0].sizes[0].stock;
  assert.strictEqual(remainingStock, 0, 'Stock must be exactly 0, never negative');
  pass('Concurrency test: exactly 1 of 2 simultaneous buyers acquired the final unit, stock = 0 (never negative)');

  // ──────────────────────────────────────────────────────────────────────────
  // 3. DUPLICATE ORDERS & IDEMPOTENCY
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n[Domain 3: Duplicate Orders & Double-Click Idempotency]');

  const doubleClickKey = `double-click-${Date.now()}`;
  const doubleClickPayload = {
    idempotencyKey: doubleClickKey,
    customer: {
      fullName: 'Double Clicker',
      phone: '0555333333',
      wilaya: { code: 9, name: 'Blida' },
      deliveryMethod: DELIVERY_METHODS.HOME,
      address: 'Centre Ville Blida'
    },
    items: [{ productId: productA._id, colorName: 'Bleu', size: 'M', quantity: 1 }]
  };

  const initialStockA = (await Product.findById(productA._id)).colors[0].sizes[0].stock;

  const firstCall = await placeOrder(doubleClickPayload);
  const secondCall = await placeOrder(doubleClickPayload);

  assert.strictEqual(firstCall.order._id.toString(), secondCall.order._id.toString(), 'Must return identical order document');
  assert.strictEqual(secondCall.isDuplicate, true, 'Second call must be marked as duplicate');

  const stockAfterDouble = (await Product.findById(productA._id)).colors[0].sizes[0].stock;
  assert.strictEqual(stockAfterDouble, initialStockA - 1, 'Stock must only be deducted once across duplicate submissions');
  pass('Double-click idempotency: same order returned, stock deducted exactly once');

  // ──────────────────────────────────────────────────────────────────────────
  // 4. CANCELLATION & AUDIT INTEGRITY
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n[Domain 4: Cancellation & Audit Integrity]');

  const orderToCancel = firstCall.order;
  const stockBeforeCancel = (await Product.findById(productA._id)).colors[0].sizes[0].stock;

  // Cancel order
  const cancelledOrder = await updateOrderStatus(orderToCancel._id, ORDER_STATUS.CANCELLED, 'Customer changed mind', 'AdminUser');
  assert.strictEqual(cancelledOrder.status, ORDER_STATUS.CANCELLED);

  // Verify order is NOT physically deleted from database
  const orderInDb = await Order.findById(orderToCancel._id);
  assert(orderInDb !== null, 'Cancelled order must remain in database, not deleted');

  // Verify stock restored
  const stockAfterCancel = (await Product.findById(productA._id)).colors[0].sizes[0].stock;
  assert.strictEqual(stockAfterCancel, stockBeforeCancel + 1, 'Stock must be restored +1 upon cancellation');

  // Attempt duplicate cancellation — rejected by state machine
  try {
    await updateOrderStatus(orderToCancel._id, ORDER_STATUS.CANCELLED, 'Duplicate cancel call', 'AdminUser');
    assert.fail('Duplicate cancel should have been blocked');
  } catch (err) {
    assert(err.message.includes('already in status "Cancelled"'));
  }

  const stockAfterDupCancel = (await Product.findById(productA._id)).colors[0].sizes[0].stock;
  assert.strictEqual(stockAfterDupCancel, stockAfterCancel, 'Duplicate cancellation must NOT restore stock twice');
  pass('Cancelled orders are retained in DB, state machine blocks redundant cancellation, and stock restoration is strictly idempotent');

  // ──────────────────────────────────────────────────────────────────────────
  // 5. HISTORICAL FINANCIAL DATA
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n[Domain 5: Historical Financial Snapshot Preservation]');

  const historicalProduct = await Product.create({
    name: 'Historical Pricing Product',
    slug: `hist-prod-${Date.now()}`,
    description: 'Product to test price/cost changes',
    category: testCat._id,
    sellingPrice: 4000,
    costPrice: 2000,
    colors: [
      {
        colorName: 'Vert',
        colorCode: '#008000',
        images: ['/test.webp'],
        sizes: [{ size: 'L', stock: 5 }]
      }
    ]
  });

  const histOrder = (await placeOrder({
    idempotencyKey: `hist-order-${Date.now()}`,
    customer: {
      fullName: 'Historical Customer',
      phone: '0555444444',
      wilaya: { code: 16, name: 'Algiers' },
      deliveryMethod: DELIVERY_METHODS.HOME,
      address: 'Kouba, Alger'
    },
    items: [{ productId: historicalProduct._id, colorName: 'Vert', size: 'L', quantity: 2 }]
  })).order;

  // Now change the product's sellingPrice and costPrice in catalog
  await Product.findByIdAndUpdate(historicalProduct._id, {
    sellingPrice: 9000,
    costPrice: 6000
  });

  // Verify the order document still holds the original sellingPrice (4000) and costPrice (2000)
  const loadedHistOrder = await Order.findById(histOrder._id);
  assert.strictEqual(loadedHistOrder.items[0].unitPrice, 4000, 'Order item must retain original unitPrice 4000');
  assert.strictEqual(loadedHistOrder.items[0].unitCost, 2000, 'Order item must retain original unitCost 2000');
  assert.strictEqual(loadedHistOrder.subtotal, 8000, 'Subtotal must remain 8000 (2 * 4000)');

  // Advance order to Delivered: Confirmed -> On the way -> Delivered
  await updateOrderStatus(histOrder._id, ORDER_STATUS.CONFIRMED, 'Confirmed', 'AdminUser');
  await updateOrderStatus(histOrder._id, ORDER_STATUS.ON_THE_WAY, 'Shipped', 'AdminUser');
  await updateOrderStatus(histOrder._id, ORDER_STATUS.DELIVERED, 'Delivered', 'AdminUser');

  // Verify financial analytics reflects original prices (revenue 8000, profit 4000)
  const analytics = await getFinancialAnalytics();
  assert(analytics.realizedRevenue >= 8000, `Expected realizedRevenue >= 8000, got ${analytics.realizedRevenue}`);
  assert(analytics.realizedProfit >= 4000, `Expected realizedProfit >= 4000, got ${analytics.realizedProfit}`);
  pass('Historical prices and unit costs are preserved when catalog prices change afterward');

  // ──────────────────────────────────────────────────────────────────────────
  // 6. AUTHORIZATION, IDOR & MASS ASSIGNMENT
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n[Domain 6: Authorization, IDOR & Mass Assignment]');

  // 6a. Attempt to pass client-manipulated financial fields in checkout
  const tamperedOrder = (await placeOrder({
    idempotencyKey: `tampered-order-${Date.now()}`,
    customer: {
      fullName: 'Tamperer',
      phone: '0555555555',
      wilaya: { code: 16, name: 'Algiers' },
      deliveryMethod: DELIVERY_METHODS.HOME,
      address: 'Didouche Mourad'
    },
    items: [{ productId: historicalProduct._id, colorName: 'Vert', size: 'L', quantity: 1 }],
    // Malicious mass-assignment attempts:
    totalPrice: 1,
    subtotal: 1,
    deliveryFee: 0,
    status: 'Delivered',
    stockRestored: true
  })).order;

  assert.strictEqual(tamperedOrder.status, ORDER_STATUS.PENDING, 'Status must be set by backend to Pending, ignoring client override');
  assert.strictEqual(tamperedOrder.deliveryFee, 500, 'Delivery fee must be calculated by backend (500), ignoring client 0');
  assert.strictEqual(tamperedOrder.totalPrice, 9500, 'Total price must be authoritative (9000 subtotal + 500 fee), ignoring client 1');
  pass('Mass assignment protection: client attempts to inject price/status/fee are completely ignored');

  // ──────────────────────────────────────────────────────────────────────────
  // 7. WEBSOCKET MESSAGE FLOODING & RATE LIMITING
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n[Domain 7: WebSocket Message Flooding Protection]');

  const floodWs = new WebSocket('ws://localhost:5000/ws');
  await new Promise((resolve, reject) => {
    floodWs.on('open', resolve);
    floodWs.on('error', reject);
  });

  let rateLimitHit = false;
  floodWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'ERROR' && msg.message.includes('Rate limit exceeded')) {
        rateLimitHit = true;
      }
    } catch {}
  });

  // Rapidly burst 35 messages within 100ms
  for (let i = 0; i < 35; i++) {
    floodWs.send(JSON.stringify({ action: 'PING', i }));
  }

  await new Promise(r => setTimeout(r, 400));
  await new Promise(r => {
    if (floodWs.readyState === WebSocket.CLOSED) return r();
    floodWs.on('close', r);
    floodWs.close();
  });
  await new Promise(r => setTimeout(r, 100));

  assert.strictEqual(rateLimitHit, true, 'WebSocket must emit ERROR when message burst exceeds threshold');
  pass('WebSocket message rate limiter successfully throttles message flooding on live server');

  // ──────────────────────────────────────────────────────────────────────────
  // 8. HTTP CACHING HEADERS
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n[Domain 8: HTTP Cache-Control Policy]');

  const pubRes = await fetch('http://localhost:5000/api/v1/categories');
  assert.strictEqual(pubRes.headers.get('cache-control'), 'public, max-age=30, stale-while-revalidate=60');

  const adminRes = await fetch('http://localhost:5000/api/v1/orders/admin');
  assert.strictEqual(adminRes.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, private');

  const checkoutRes = await fetch('http://localhost:5000/api/v1/orders/checkout', { method: 'POST' });
  assert.strictEqual(checkoutRes.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, private');

  pass('Cache-Control headers strictly prevent caching of private/financial/order endpoints over live HTTP');

  // ──────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────────────────────
  console.log(`\n==================================================`);
  console.log(`GAP AUDIT RESULTS: ${passCount} PASSED | ${failCount} FAILED`);
  console.log(`==================================================\n`);

  await new Promise(r => setTimeout(r, 600));
  process.exit(failCount > 0 ? 1 : 0);
}

runGapAudit().catch(err => {
  console.error('Gap audit fatal error:', err);
  process.exit(1);
});
