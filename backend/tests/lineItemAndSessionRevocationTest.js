/**
 * lineItemAndSessionRevocationTest.js
 *
 * Comprehensive production regression test suite covering:
 * 1. Admin Line-Item Editing (product, color, size, quantity swaps, atomic stock deltas)
 * 2. Insufficient replacement stock & zero-leak rollback
 * 3. CAS (__v) concurrent item editing protection (200 vs 409)
 * 4. Delivered order & Cancelled order modification protection
 * 5. Delivery fee recalculation & client deliveryFee tampering prevention
 * 6. JWT Session Revocation on logout (HTTP 401 on old token)
 * 7. WebSocket rejection of revoked admin sessions
 * 8. Order cancellation inventory restoration exactly once after item edit
 */

import assert from 'node:assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import http from 'node:http';

import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { Order } from '../src/models/Order.js';
import { Admin } from '../src/models/Admin.js';
import { Session } from '../src/models/Session.js';
import { createSession, revokeSession } from '../src/services/sessionService.js';
import { DeliverySetting } from '../src/models/DeliverySetting.js';
import { placeOrder as basePlaceOrder, updateOrderStatus, updateOrderItemsService } from '../src/services/orderService.js';
const placeOrder = (params) => basePlaceOrder({
  idempotencyKey: `idem-line-rev-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
  ...params
});
import { updateOrderItems } from '../src/controllers/orderController.js';
import { logout } from '../src/controllers/authController.js';
import { authenticateAdmin } from '../src/middleware/auth.js';
import { wsService } from '../src/services/websocketService.js';
import { ORDER_STATUS, DELIVERY_METHODS } from '../src/config/constants.js';

dotenv.config();

const DB_URI = process.env.MONGODB_LOCAL_URI || 'mongodb://127.0.0.1:27018/merya_dz?replicaSet=rs0&directConnection=true';

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
    headers: {},
    cookies: {},
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    cookie(name, val, opts) { this.cookies[name] = { val, opts }; return this; },
    clearCookie(name, opts) { delete this.cookies[name]; this.cleared = true; return this; }
  };
}

async function runAllTests() {
  console.log('================================================================');
  console.log('  MERYA DZ — LINE-ITEM EDITING & SESSION REVOCATION AUDIT SUITE');
  console.log('================================================================\n');

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(DB_URI);
  }

  // Setup category
  let cat = await Category.findOne({ slug: 'line-item-test-cat' });
  if (!cat) {
    cat = await Category.create({
      name: 'Line Item Test Category',
      slug: 'line-item-test-cat',
      description: 'Category for line item testing',
      image: 'https://example.com/cat.jpg'
    });
  }

  // Setup Product A
  let prodA = await Product.findOne({ slug: 'abaya-silk-luxe-a-test' });
  if (prodA) await Product.deleteOne({ _id: prodA._id });

  prodA = await Product.create({
    name: 'Abaya Silk Luxe A',
    slug: 'abaya-silk-luxe-a-test',
    description: 'Product A for item swap',
    category: cat._id,
    sellingPrice: 4000,
    costPrice: 2000,
    isActive: true,
    colors: [
      {
        colorName: 'Noir',
        colorCode: '#000000',
        images: ['https://example.com/noir.jpg'],
        sizes: [
          { size: 'M', stock: 10 },
          { size: 'L', stock: 5 }
        ]
      },
      {
        colorName: 'Bleu',
        colorCode: '#0000FF',
        images: ['https://example.com/bleu.jpg'],
        sizes: [
          { size: 'M', stock: 8 },
          { size: 'L', stock: 4 }
        ]
      }
    ]
  });

  // Setup Product B
  let prodB = await Product.findOne({ slug: 'khimar-medina-b-test' });
  if (prodB) await Product.deleteOne({ _id: prodB._id });

  prodB = await Product.create({
    name: 'Khimar Medina B',
    slug: 'khimar-medina-b-test',
    description: 'Product B for item swap',
    category: cat._id,
    sellingPrice: 6000,
    costPrice: 3000,
    isActive: true,
    colors: [
      {
        colorName: 'Beige',
        colorCode: '#F5F5DC',
        images: ['https://example.com/beige.jpg'],
        sizes: [
          { size: 'Standard', stock: 6 },
          { size: 'XL', stock: 2 }
        ]
      }
    ]
  });

  async function resetProducts() {
    await Product.updateOne(
      { _id: prodA._id },
      {
        $set: {
          'colors.0.sizes.0.stock': 10,
          'colors.0.sizes.1.stock': 5,
          'colors.1.sizes.0.stock': 8,
          'colors.1.sizes.1.stock': 4
        }
      }
    );
    await Product.updateOne(
      { _id: prodB._id },
      {
        $set: {
          'colors.0.sizes.0.stock': 6,
          'colors.0.sizes.1.stock': 2
        }
      }
    );
  }

  // Setup DeliverySettings with freeDeliveryThreshold: 10000 and Wilaya 16 rates (500 / 300)
  let delSetting = await DeliverySetting.findOne();
  const w16 = { wilayaCode: 16, wilayaName: 'Alger', homeFee: 500, agencyFee: 300, isAvailable: true };
  if (!delSetting) {
    delSetting = await DeliverySetting.create({
      singletonKey: 'default',
      freeDeliveryThreshold: 10000,
      wilayaRates: [w16]
    });
  } else {
    delSetting.freeDeliveryThreshold = 10000;
    const w16Idx = delSetting.wilayaRates.findIndex(r => r.wilayaCode === 16);
    if (w16Idx >= 0) {
      delSetting.wilayaRates[w16Idx].homeFee = 500;
      delSetting.wilayaRates[w16Idx].agencyFee = 300;
      delSetting.wilayaRates[w16Idx].isAvailable = true;
    } else {
      delSetting.wilayaRates.push(w16);
    }
    await delSetting.save();
  }

  // Setup Admin
  let testAdmin = await Admin.findOne({ email: 'line_item_admin@merya.dz' });
  if (!testAdmin) {
    testAdmin = await Admin.create({
      username: 'line_item_admin',
      email: 'line_item_admin@merya.dz',
      passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqr',
      role: 'owner',
      isActive: true,
    });
  }

  // ── TEST 1: Admin Product Change (Product A -> Product B) ──────────────────
  console.log('── Test 1: Admin Product Swap (A -> B) with Atomic Inventory Deltas ──');
  try {
    await resetProducts();
    const { order } = await placeOrder({
      customer: {
        fullName: 'Customer Swap',
        phone: '0555112233',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: 'Rue Didouche Mourad'
      },
      items: [{ productId: prodA._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }]
    });

    // Initial stock check
    let pA = await Product.findById(prodA._id);
    let pB = await Product.findById(prodB._id);
    assert.strictEqual(pA.colors[0].sizes.find(s => s.size === 'M').stock, 9, 'Prod A Noir M stock was 10 - 1 = 9');
    assert.strictEqual(pB.colors[0].sizes.find(s => s.size === 'Standard').stock, 6, 'Prod B Beige Standard stock is 6');

    // Admin swaps item to Product B (Beige, Standard, qty: 1)
    const updated = await updateOrderItemsService({
      orderId: order._id.toString(),
      newItems: [{ productId: prodB._id.toString(), colorName: 'Beige', size: 'Standard', quantity: 1 }],
      expectedVersion: order.__v,
      adminUsername: 'AdminTester',
      reason: 'Customer requested Khimar B instead of Abaya A'
    });

    // Check inventory
    pA = await Product.findById(prodA._id);
    pB = await Product.findById(prodB._id);
    assert.strictEqual(pA.colors[0].sizes.find(s => s.size === 'M').stock, 10, 'Prod A Noir M stock restored to 10 (+1)');
    assert.strictEqual(pB.colors[0].sizes.find(s => s.size === 'Standard').stock, 5, 'Prod B Beige Standard stock deducted to 5 (-1)');

    // Check updated order snapshot
    assert.strictEqual(updated.items.length, 1);
    assert.strictEqual(updated.items[0].productName, 'Khimar Medina B');
    assert.strictEqual(updated.items[0].unitPrice, 6000);
    assert.strictEqual(updated.items[0].unitCost, 3000);
    assert.strictEqual(updated.subtotal, 6000);
    assert.strictEqual(updated.totalPrice, 6500, 'Subtotal 6000 + Delivery 500 = 6500');
    assert.strictEqual(updated.auditHistory[updated.auditHistory.length - 1].action, 'LINE_ITEMS_UPDATED');

    pass('Product swap (A -> B) atomically released old stock, deducted new stock, and updated financials');
  } catch (err) {
    fail('Admin product swap test', err);
  }

  // ── TEST 2: Admin Color Change within same product (Noir -> Bleu) ──────────
  console.log('\n── Test 2: Admin Color Change (Noir -> Bleu) ──');
  try {
    await resetProducts();
    const { order } = await placeOrder({
      customer: {
        fullName: 'Color Change User',
        phone: '0555223344',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: '12 Boulevard Mohamed V'
      },
      items: [{ productId: prodA._id.toString(), colorName: 'Noir', size: 'M', quantity: 2 }]
    });

    let pA = await Product.findById(prodA._id);
    assert.strictEqual(pA.colors[0].sizes.find(s => s.size === 'M').stock, 8, 'Noir M: 10 - 2 = 8');
    assert.strictEqual(pA.colors[1].sizes.find(s => s.size === 'M').stock, 8, 'Bleu M: 8');

    // Admin updates color to Bleu M (qty 2)
    const updated = await updateOrderItemsService({
      orderId: order._id.toString(),
      newItems: [{ productId: prodA._id.toString(), colorName: 'Bleu', size: 'M', quantity: 2 }],
      expectedVersion: order.__v,
      adminUsername: 'AdminTester',
      reason: 'Customer preferred Bleu color'
    });

    pA = await Product.findById(prodA._id);
    assert.strictEqual(pA.colors[0].sizes.find(s => s.size === 'M').stock, 10, 'Noir M stock restored to 10 (+2)');
    assert.strictEqual(pA.colors[1].sizes.find(s => s.size === 'M').stock, 6, 'Bleu M stock deducted to 6 (-2)');
    assert.strictEqual(updated.items[0].colorName, 'Bleu');

    pass('Color swap (Noir -> Bleu) restored old color stock and deducted new color stock');
  } catch (err) {
    fail('Admin color change test', err);
  }

  // ── TEST 3: Admin Size Change (M -> L) ────────────────────────────────────
  console.log('\n── Test 3: Admin Size Change (M -> L) ──');
  try {
    await resetProducts();
    const { order } = await placeOrder({
      customer: {
        fullName: 'Size Change User',
        phone: '0555334455',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: 'Rue Didouche'
      },
      items: [{ productId: prodA._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }]
    });

    let pA = await Product.findById(prodA._id);
    assert.strictEqual(pA.colors[0].sizes.find(s => s.size === 'M').stock, 9, 'Noir M: 10 - 1 = 9');
    assert.strictEqual(pA.colors[0].sizes.find(s => s.size === 'L').stock, 5, 'Noir L: 5');

    // Admin updates size to L
    const updated = await updateOrderItemsService({
      orderId: order._id.toString(),
      newItems: [{ productId: prodA._id.toString(), colorName: 'Noir', size: 'L', quantity: 1 }],
      expectedVersion: order.__v,
      adminUsername: 'AdminTester',
      reason: 'Customer requested size L'
    });

    pA = await Product.findById(prodA._id);
    assert.strictEqual(pA.colors[0].sizes.find(s => s.size === 'M').stock, 10, 'Noir M restored to 10');
    assert.strictEqual(pA.colors[0].sizes.find(s => s.size === 'L').stock, 4, 'Noir L deducted to 4');
    assert.strictEqual(updated.items[0].size, 'L');

    pass('Size change (M -> L) restored old size stock and deducted new size stock');
  } catch (err) {
    fail('Admin size change test', err);
  }

  // ── TEST 4: Admin Quantity Increase (1 -> 3) ──────────────────────────────
  console.log('\n── Test 4: Admin Quantity Increase (1 -> 3) ──');
  try {
    await resetProducts();
    const { order } = await placeOrder({
      customer: {
        fullName: 'Qty Increase User',
        phone: '0555445566',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: 'Rue Didouche'
      },
      items: [{ productId: prodA._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }]
    });

    let pA = await Product.findById(prodA._id);
    assert.strictEqual(pA.colors[0].sizes.find(s => s.size === 'M').stock, 9);

    // Increase qty from 1 to 3 (net delta = +2)
    const updated = await updateOrderItemsService({
      orderId: order._id.toString(),
      newItems: [{ productId: prodA._id.toString(), colorName: 'Noir', size: 'M', quantity: 3 }],
      expectedVersion: order.__v,
      adminUsername: 'AdminTester',
      reason: 'Customer added 2 more items'
    });

    pA = await Product.findById(prodA._id);
    assert.strictEqual(pA.colors[0].sizes.find(s => s.size === 'M').stock, 7, 'Noir M stock: 9 - 2 = 7');
    assert.strictEqual(updated.items[0].quantity, 3);
    assert.strictEqual(updated.subtotal, 12000, '4000 * 3 = 12000');
    // Threshold is 10000, so subtotal 12000 triggers free delivery!
    assert.strictEqual(updated.deliveryFee, 0, 'Subtotal >= 10000 triggers free delivery fee = 0');
    assert.strictEqual(updated.totalPrice, 12000);

    pass('Quantity increase (1 -> 3) deducted net delta and recalculated free delivery threshold');
  } catch (err) {
    fail('Admin quantity increase test', err);
  }

  // ── TEST 5: Admin Quantity Decrease (3 -> 1) ──────────────────────────────
  console.log('\n── Test 5: Admin Quantity Decrease (3 -> 1) ──');
  try {
    await resetProducts();
    const { order } = await placeOrder({
      customer: {
        fullName: 'Qty Decrease User',
        phone: '0555556677',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: 'Rue Didouche'
      },
      items: [{ productId: prodA._id.toString(), colorName: 'Noir', size: 'M', quantity: 3 }]
    });

    let pA = await Product.findById(prodA._id);
    assert.strictEqual(pA.colors[0].sizes.find(s => s.size === 'M').stock, 7);

    // Decrease qty from 3 to 1 (net delta = -2)
    const updated = await updateOrderItemsService({
      orderId: order._id.toString(),
      newItems: [{ productId: prodA._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }],
      expectedVersion: order.__v,
      adminUsername: 'AdminTester',
      reason: 'Customer reduced order'
    });

    pA = await Product.findById(prodA._id);
    assert.strictEqual(pA.colors[0].sizes.find(s => s.size === 'M').stock, 9, 'Stock restored by +2 to 9');
    assert.strictEqual(updated.items[0].quantity, 1);
    assert.strictEqual(updated.subtotal, 4000);
    // Subtotal dropped below 10000, delivery fee restored to 500
    assert.strictEqual(updated.deliveryFee, 500);
    assert.strictEqual(updated.totalPrice, 4500);

    pass('Quantity decrease (3 -> 1) restored surplus stock and recalculated standard delivery fee');
  } catch (err) {
    fail('Admin quantity decrease test', err);
  }

  // ── TEST 6: Insufficient Replacement Stock & Rollback ─────────────────────
  console.log('\n── Test 6: Insufficient Replacement Stock Rollback ──');
  try {
    await resetProducts();
    const { order } = await placeOrder({
      customer: {
        fullName: 'Insufficient Stock User',
        phone: '0555667788',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: 'Rue Didouche'
      },
      items: [{ productId: prodA._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }]
    });

    // Product B XL only has stock: 2
    let pA_before = await Product.findById(prodA._id);
    let pB_before = await Product.findById(prodB._id);
    const pA_stockBefore = pA_before.colors[0].sizes.find(s => s.size === 'M').stock;
    const pB_stockBefore = pB_before.colors[0].sizes.find(s => s.size === 'XL').stock;

    // Try to update to 10 units of XL (exceeds available 2)
    await assert.rejects(
      async () => {
        await updateOrderItemsService({
          orderId: order._id.toString(),
          newItems: [{ productId: prodB._id.toString(), colorName: 'Beige', size: 'XL', quantity: 10 }],
          expectedVersion: order.__v,
          adminUsername: 'AdminTester',
          reason: 'Attempting stock-exceeding swap'
        });
      },
      /Insufficient stock/
    );

    // Verify complete rollback: zero stock leaks
    let pA_after = await Product.findById(prodA._id);
    let pB_after = await Product.findById(prodB._id);
    assert.strictEqual(pA_after.colors[0].sizes.find(s => s.size === 'M').stock, pA_stockBefore, 'Prod A stock completely unchanged');
    assert.strictEqual(pB_after.colors[0].sizes.find(s => s.size === 'XL').stock, pB_stockBefore, 'Prod B stock completely unchanged');

    const unmodOrder = await Order.findById(order._id);
    assert.strictEqual(unmodOrder.items[0].productName, 'Abaya Silk Luxe A', 'Order items remain original');

    pass('Insufficient stock aborted cleanly; transaction rolled back with zero stock changes');
  } catch (err) {
    fail('Insufficient stock test', err);
  }

  // ── TEST 7: Concurrent Admin Order Item Edits (CAS __v: 200 vs 409) ───────
  console.log('\n── Test 7: Concurrent Admin Edits on Line Items ──');
  try {
    await resetProducts();
    const { order } = await placeOrder({
      customer: {
        fullName: 'Concurrent Edit User',
        phone: '0555778899',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: 'Rue Didouche'
      },
      items: [{ productId: prodA._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }]
    });

    const initialVersion = order.__v;

    // Admin 1 and Admin 2 submit edits simultaneously with the same expectedVersion
    const res1 = mockRes();
    const res2 = mockRes();

    const p1 = updateOrderItems(
      {
        params: { id: order._id.toString() },
        body: {
          items: [{ productId: prodA._id.toString(), colorName: 'Noir', size: 'L', quantity: 1 }],
          expectedVersion: initialVersion,
          reason: 'Admin 1 edit'
        },
        admin: { username: 'Admin1' }
      },
      res1,
      (err) => { if (err) throw err; }
    );

    const p2 = updateOrderItems(
      {
        params: { id: order._id.toString() },
        body: {
          items: [{ productId: prodA._id.toString(), colorName: 'Bleu', size: 'M', quantity: 1 }],
          expectedVersion: initialVersion,
          reason: 'Admin 2 edit'
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

    assert.strictEqual(successes.length, 1, 'Exactly one concurrent edit succeeded with 200');
    assert.strictEqual(conflicts.length, 1, 'Exactly one concurrent edit was rejected with 409');
    assert.strictEqual(conflicts[0].body.code, 'CONCURRENT_CONFLICT');

    pass('Concurrent admin item edits: exactly one 200 and one 409 CONCURRENT_CONFLICT');
  } catch (err) {
    fail('Concurrent admin edits test', err);
  }

  // ── TEST 8: Delivered and Cancelled Order Protection ───────────────────────
  console.log('\n── Test 8: Delivered and Cancelled Order Item Modification Protection ──');
  try {
    await resetProducts();
    // 8a. Delivered order
    const { order: delOrder } = await placeOrder({
      customer: {
        fullName: 'Delivered Order User',
        phone: '0555889900',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: 'Rue Didouche'
      },
      items: [{ productId: prodA._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }]
    });

    await updateOrderStatus(delOrder._id.toString(), ORDER_STATUS.CONFIRMED, 'Admin');
    await updateOrderStatus(delOrder._id.toString(), ORDER_STATUS.ON_THE_WAY, 'Admin');
    await updateOrderStatus(delOrder._id.toString(), ORDER_STATUS.DELIVERED, 'Admin');

    const resDel = mockRes();
    await updateOrderItems(
      {
        params: { id: delOrder._id.toString() },
        body: {
          items: [{ productId: prodA._id.toString(), colorName: 'Bleu', size: 'M', quantity: 1 }]
        },
        admin: { username: 'RogueAdmin' }
      },
      resDel,
      () => {}
    );
    assert.strictEqual(resDel.statusCode, 400);
    assert.ok(resDel.body.message.includes('Historical financial values and items cannot be modified'));

    // 8b. Cancelled order
    const { order: cancOrder } = await placeOrder({
      customer: {
        fullName: 'Cancelled Order User',
        phone: '0555990011',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: 'Rue Didouche'
      },
      items: [{ productId: prodA._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }]
    });

    await updateOrderStatus(cancOrder._id.toString(), ORDER_STATUS.CANCELLED, 'Admin');

    const resCanc = mockRes();
    await updateOrderItems(
      {
        params: { id: cancOrder._id.toString() },
        body: {
          items: [{ productId: prodA._id.toString(), colorName: 'Bleu', size: 'M', quantity: 1 }]
        },
        admin: { username: 'RogueAdmin' }
      },
      resCanc,
      () => {}
    );
    assert.strictEqual(resCanc.statusCode, 400);
    assert.ok(resCanc.body.message.includes('Cannot modify items on a Cancelled order'));

    pass('Delivered and Cancelled orders strictly protected against item modification (HTTP 400)');
  } catch (err) {
    fail('Delivered/Cancelled order protection test', err);
  }

  // ── TEST 9: Cancellation Exactly-Once Stock Restoration after Item Edit ────
  console.log('\n── Test 9: Cancellation Exactly-Once Restoration After Item Edit ──');
  try {
    await resetProducts();
    const { order } = await placeOrder({
      customer: {
        fullName: 'Cancel After Edit User',
        phone: '0555001133',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: 'Rue Didouche'
      },
      items: [{ productId: prodA._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }]
    });

    // Edit item to Product B (Standard, qty 2)
    await updateOrderItemsService({
      orderId: order._id.toString(),
      newItems: [{ productId: prodB._id.toString(), colorName: 'Beige', size: 'Standard', quantity: 2 }],
      expectedVersion: order.__v,
      adminUsername: 'Admin',
      reason: 'Customer switch to Khimar for cancellation test'
    });

    let pB = await Product.findById(prodB._id);
    const pB_stock = pB.colors[0].sizes.find(s => s.size === 'Standard').stock;

    // Now cancel the order
    await updateOrderStatus(order._id.toString(), ORDER_STATUS.CANCELLED, 'Admin');

    pB = await Product.findById(prodB._id);
    assert.strictEqual(
      pB.colors[0].sizes.find(s => s.size === 'Standard').stock,
      pB_stock + 2,
      'Product B stock correctly restored by +2 upon cancellation'
    );

    // Repeated cancellation without override is rejected by state machine
    await assert.rejects(
      async () => {
        await updateOrderStatus(order._id.toString(), ORDER_STATUS.CANCELLED, 'Admin');
      },
      /already in status/
    );

    // Repeated cancellation WITH override executes cleanly without double-restoring stock
    await updateOrderStatus(order._id.toString(), ORDER_STATUS.CANCELLED, 'Admin', '', true, 'Admin override re-cancel');

    pB = await Product.findById(prodB._id);
    assert.strictEqual(
      pB.colors[0].sizes.find(s => s.size === 'Standard').stock,
      pB_stock + 2,
      'Stock restoration is strictly idempotent: no double restoration under override'
    );

    pass('Cancellation after item edit restored updated items exactly once with idempotency');
  } catch (err) {
    fail('Cancellation restoration test', err);
  }

  // ── TEST 10: Client Delivery Fee Tampering Prevention ─────────────────────
  console.log('\n── Test 10: Client Delivery Fee Tampering Prevention ──');
  try {
    await resetProducts();
    // Client sends malicious deliveryFee: 1 or 999999999
    const { order: orderTamper1 } = await placeOrder({
      customer: {
        fullName: 'Fee Tamper User',
        phone: '0555123456',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: 'Rue Didouche'
      },
      items: [{ productId: prodA._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }],
      deliveryFee: 1, // Malicious attempt to inject 1 DZD
      totalPrice: 4001
    });

    assert.strictEqual(orderTamper1.deliveryFee, 500, 'Server enforced authoritative 500 DZD fee and ignored client 1 DZD');
    assert.strictEqual(orderTamper1.totalPrice, 4500, 'Total price calculated authoritatively');

    pass('Client delivery fee tampering ({ deliveryFee: 1 }) completely ignored; authoritative fee enforced');
  } catch (err) {
    fail('Delivery fee tampering test', err);
  }

  // ── TEST 11: JWT / Session Revocation on Logout ───────────────────────────
  console.log('\n── Test 11: JWT / Session Revocation on Logout ──');
  try {
    const admin = await Admin.findOne({ email: 'line_item_admin@merya.dz' });

    // 1. Issue Session with Access and Refresh tokens
    const { session, accessToken, refreshToken } = await createSession({ adminId: admin._id });

    // 2. Verify request succeeds with valid active session
    let nextCalled = false;
    const reqActive = {
      cookies: { accessToken },
      headers: {}
    };
    const resActive = mockRes();
    await authenticateAdmin(reqActive, resActive, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true, 'Active session accepted by authenticateAdmin');

    // 3. Admin logs out -> Session is marked revoked in DB
    const reqLogout = {
      cookies: { accessToken, refreshToken },
      authSession: session
    };
    const resLogout = mockRes();
    await logout(reqLogout, resLogout, () => {});
    assert.strictEqual(resLogout.cleared, true, 'Cookie cleared');

    const updatedSession = await Session.findById(session._id);
    assert.ok(updatedSession.revokedAt, 'Session marked revoked in DB');

    // 4. Attempt authenticated request using previously issued access token
    let nextCalledAfterRevoke = false;
    const reqRevoked = {
      cookies: { accessToken },
      headers: {}
    };
    const resRevoked = mockRes();
    await authenticateAdmin(reqRevoked, resRevoked, () => { nextCalledAfterRevoke = true; });

    assert.strictEqual(nextCalledAfterRevoke, false, 'Revoked token MUST NOT call next()');
    assert.strictEqual(resRevoked.statusCode, 401, 'Revoked token rejected with HTTP 401');
    assert.ok(resRevoked.body.message.includes('revoked'), 'Error message indicates revoked session');

    pass('Logout revokes Session in DB; previously issued accessToken immediately rejected with 401');
  } catch (err) {
    fail('JWT session revocation test', err);
  }

  // ── TEST 12: WebSocket Rejection of Revoked Admin Session ─────────────────
  console.log('\n── Test 12: WebSocket Rejection of Revoked Admin Session ──');
  try {
    const admin = await Admin.findOne({ email: 'line_item_admin@merya.dz' });
    const { session, accessToken } = await createSession({ adminId: admin._id });
    await revokeSession(session._id, 'TEST_REVOKE');

    // Start a temporary test server with wsService
    const port = 5098;
    const testServer = http.createServer();
    wsService.init(testServer, ['http://localhost:5173']);
    await new Promise(r => testServer.listen(port, r));

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: {
        Origin: 'http://localhost:5173',
        Cookie: `accessToken=${accessToken}`
      }
    });

    const errorReceived = await new Promise((resolve, reject) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ action: 'SUBSCRIBE_ADMIN' }));
      });
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'ERROR' && msg.message.includes('Unauthorized')) {
          ws.close();
          resolve(true);
        } else if (msg.type === 'SUBSCRIBED' && msg.channel === 'admin') {
          ws.close();
          reject(new Error('Revoked session should not have received SUBSCRIBED'));
        }
      });
      ws.on('error', reject);
    });

    assert.strictEqual(errorReceived, true);

    if (wsService.wss) {
      wsService.wss.close();
    }
    testServer.close();

    pass('WebSocket upgrade rejected revoked admin session with Unauthorized error');
  } catch (err) {
    fail('WebSocket session revocation test', err);
  }

  // Cleanup test products and settings
  await Product.deleteMany({ _id: { $in: [prodA._id, prodB._id] } });
  await Category.deleteOne({ _id: cat._id });
  await DeliverySetting.updateOne({}, { $set: { freeDeliveryThreshold: 0 } });

  await mongoose.disconnect();

  console.log('\n================================================================');
  console.log(`AUDIT RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Fatal in lineItemAndSessionRevocationTest:', err);
  process.exit(1);
});
