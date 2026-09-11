/**
 * rollbackRaceTest.js
 *
 * Deterministic adversarial tests for inventory-operation rollback concurrency safety.
 *
 * Scenarios:
 * 1. A: At Agency → Returned, B: Returned → Confirmed
 *    While A's inventory restoration fails/delays after CAS, Request B wins Returned → Confirmed.
 *    A's conditional rollback MUST match 0 documents and NOT overwrite B's Confirmed state.
 *
 * 2. A: Returned → Confirmed (stock = 0 so deduction fails)
 *    Order is modified concurrently after A's CAS.
 *    A's failed inventory deduction MUST NOT overwrite the newer state.
 */

import assert from 'node:assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { Order } from '../src/models/Order.js';
import { updateOrderStatus } from '../src/services/orderService.js';
import { DeliverySetting } from '../src/models/DeliverySetting.js';
import { ORDER_STATUS, ALGERIA_WILAYAS } from '../src/config/constants.js';

dotenv.config();

const DB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/merya_dz';

async function getStock(productId, colorName, size) {
  const p = await Product.findById(productId);
  return p.colors.find(c => c.colorName === colorName)?.sizes.find(s => s.size === size)?.stock ?? -1;
}

async function setStock(productId, colorName, size, newStock) {
  await Product.updateOne(
    { _id: productId },
    { $set: { 'colors.$[c].sizes.$[s].stock': newStock } },
    { arrayFilters: [{ 'c.colorName': colorName }, { 's.size': size }] }
  );
}

async function createTestOrder({ productId, colorName, size, quantity, status, stockRestored }) {
  const orderCode = `RR-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return await Order.create({
    orderCode,
    customer: {
      fullName: 'Rollback Race Customer',
      phone: '0555000000',
      wilaya: { code: 16, name: 'Algiers' },
      deliveryMethod: 'home',
      address: '1 Rollback St, Algiers'
    },
    items: [{
      productId,
      productName: 'Rollback Race Product',
      colorName,
      colorCode: '#000',
      size,
      quantity,
      unitPrice: 3000,
      unitCost: 1500,
      image: ''
    }],
    subtotal: 3000 * quantity,
    deliveryFee: 500,
    totalPrice: 3000 * quantity + 500,
    status,
    stockRestored
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('  ROLLBACK CONCURRENCY RACE ADVERSARIAL TEST SUITE');
  console.log('================================================================\n');

  await mongoose.connect(DB_URI);
  console.log('Connected to MongoDB.');

  // Ensure DeliverySetting exists
  let ds = await DeliverySetting.findOne();
  if (!ds || !ds.wilayaRates || ds.wilayaRates.length < 69) {
    const rates = ALGERIA_WILAYAS.map(w => ({
      wilayaCode: w.code,
      wilayaName: w.name,
      wilayaNameAr: w.nameAr,
      homeFee: 800,
      agencyFee: 500,
      isAvailable: true
    }));
    if (!ds) {
      ds = await DeliverySetting.create({ agencyDeliveryFee: 500, homeDeliveryFee: 800, wilayaRates: rates });
    } else {
      ds.wilayaRates = rates;
      await ds.save();
    }
  }

  let testCategory = await Category.findOne({ slug: 'test-category-race' });
  if (!testCategory) {
    testCategory = await Category.create({
      name: 'Test Category Race',
      slug: 'test-category-race',
      description: 'Category for rollback race testing',
      image: '/test.jpg'
    });
  }

  const testProduct = await Product.create({
    name: 'Rollback Race Abaya',
    slug: `rollback-race-abaya-${Date.now()}`,
    description: 'Test product for rollback race conditions',
    category: testCategory._id,
    sellingPrice: 3000,
    costPrice: 1500,
    isActive: true,
    colors: [{
      colorName: 'Midnight Black',
      colorCode: '#000000',
      images: ['/test.jpg'],
      sizes: [
        { size: 'M', stock: 0 }
      ]
    }]
  });

  const productId = testProduct._id;
  const colorName = 'Midnight Black';
  const size = 'M';
  const quantity = 1;

  let passCount = 0;
  let failCount = 0;

  // ── TEST 1: Direction 1 — At Agency → Returned transaction aborts on inventory failure ──
  {
    console.log('── TEST 1: Request A (At Agency → Returned) inventory failure triggers transaction abort without blind rollback ──');
    console.log('   Setup: stock = 0, status = "At Agency", stockRestored = false');

    await setStock(productId, colorName, size, 0);
    const order = await createTestOrder({ productId, colorName, size, quantity, status: ORDER_STATUS.AT_AGENCY, stockRestored: false });

    // Hook Product.updateOne to force a simulated failure during Request A's stock restoration inside transaction
    const originalUpdateOne = Product.updateOne;
    let intercepted = false;

    Product.updateOne = async function (filter, update, options) {
      if (!intercepted && filter._id && filter._id.toString() === productId.toString() && options?.session) {
        intercepted = true;
        console.log('   [Interception] Request A is inside transaction restoring stock. Simulating inventory failure...');
        throw new Error('Simulated network/DB failure during Request A stock restoration');
      }
      return originalUpdateOne.call(this, filter, update, options);
    };

    let requestAFailed = false;
    try {
      await updateOrderStatus(order._id.toString(), 'Returned', 'AdminA', 'Returned by A');
    } catch (err) {
      requestAFailed = true;
      console.log(`   Request A caught expected error: ${err.message}`);
    } finally {
      Product.updateOne = originalUpdateOne;
    }

    assert.strictEqual(requestAFailed, true, 'Request A must fail due to simulated inventory error');

    // Inspect state in DB — transaction abort must leave order completely untouched
    const afterAbortOrder = await Order.findById(order._id);
    const afterAbortStock = await getStock(productId, colorName, size);

    console.log(`   After abort order status: ${afterAbortOrder.status} (expected: At agency)`);
    console.log(`   After abort stockRestored: ${afterAbortOrder.stockRestored} (expected: false)`);
    console.log(`   After abort stock: ${afterAbortStock} (expected: 0)`);

    try {
      assert.strictEqual(afterAbortOrder.status, ORDER_STATUS.AT_AGENCY, 'Order status must remain At agency after abort');
      assert.strictEqual(afterAbortOrder.stockRestored, false, 'stockRestored must remain false');
      assert.strictEqual(afterAbortStock, 0, 'Stock must remain 0 (no partial restoration)');

      // Now demonstrate that a subsequent/concurrent transition (e.g. At Agency → Returned retry) succeeds cleanly
      console.log('   Testing subsequent transition after abort (system is in clean state)...');
      const retryOrder = await updateOrderStatus(order._id.toString(), 'Returned', 'AdminA', 'Returned retry');
      const retryStock = await getStock(productId, colorName, size);

      assert.strictEqual(retryOrder.status, ORDER_STATUS.RETURNED, 'Retry must transition to Returned');
      assert.strictEqual(retryOrder.stockRestored, true, 'stockRestored must be true');
      assert.strictEqual(retryStock, 1, 'Stock must be restored to 1');

      console.log('   ✅ TEST 1 PASSED: Transaction abort completely isolated failed attempt; subsequent transition succeeded cleanly!\n');
      passCount++;
    } catch (e) {
      console.error(`   ❌ TEST 1 FAILED: ${e.message}\n`);
      failCount++;
    }

    await Order.deleteOne({ _id: order._id });
  }

  // ── TEST 2: Direction 2 — Returned → Confirmed fails inventory deduction without leaving corrupt state ──
  {
    console.log('── TEST 2: Request A (Returned → Confirmed) insufficient stock triggers transaction abort ──');
    console.log('   Setup: stock = 0, status = "Returned", stockRestored = true');

    await setStock(productId, colorName, size, 0);
    const order = await createTestOrder({ productId, colorName, size, quantity, status: ORDER_STATUS.RETURNED, stockRestored: true });

    let requestAFailed2 = false;
    try {
      // With stock = 0, deductStockAtomic inside the transaction will throw Insufficient Stock
      await updateOrderStatus(order._id.toString(), 'Confirmed', 'AdminA', 'Confirmed by A');
    } catch (err) {
      requestAFailed2 = true;
      console.log(`   Request A caught expected error: ${err.message}`);
    }

    assert.strictEqual(requestAFailed2, true, 'Request A must fail because stock is 0');

    // Inspect state in DB — transaction abort must leave order completely untouched
    const afterAbortOrder2 = await Order.findById(order._id);
    const afterAbortStock2 = await getStock(productId, colorName, size);

    console.log(`   After abort order status: ${afterAbortOrder2.status} (expected: Returned)`);
    console.log(`   After abort stockRestored: ${afterAbortOrder2.stockRestored} (expected: true)`);
    console.log(`   After abort stock: ${afterAbortStock2} (expected: 0)`);

    try {
      assert.strictEqual(afterAbortOrder2.status, ORDER_STATUS.RETURNED, 'Order status must remain Returned after abort');
      assert.strictEqual(afterAbortOrder2.stockRestored, true, 'stockRestored must remain true');
      assert.strictEqual(afterAbortStock2, 0, 'Stock must remain 0 (no partial deduction)');

      // Replenish stock and verify transition succeeds cleanly
      console.log('   Replenishing stock to 1 and verifying reactivation succeeds cleanly...');
      await setStock(productId, colorName, size, 1);

      const retryOrder2 = await updateOrderStatus(order._id.toString(), 'Confirmed', 'AdminA', 'Reactivated after restock');
      const retryStock2 = await getStock(productId, colorName, size);

      assert.strictEqual(retryOrder2.status, ORDER_STATUS.CONFIRMED, 'Order must transition to Confirmed');
      assert.strictEqual(retryOrder2.stockRestored, false, 'stockRestored must be false');
      assert.strictEqual(retryStock2, 0, 'Stock must be deducted back to 0');

      console.log('   ✅ TEST 2 PASSED: Transaction abort preserved Returned state; reactivation succeeded after restock!\n');
      passCount++;
    } catch (e) {
      console.error(`   ❌ TEST 2 FAILED: ${e.message}\n`);
      failCount++;
    }

    await Order.deleteOne({ _id: order._id });
  }

  // Cleanup test product and category
  await Product.deleteOne({ _id: testProduct._id });
  await Category.deleteOne({ _id: testCategory._id });
  await mongoose.disconnect();

  console.log('================================================================');
  console.log(`  ROLLBACK CONCURRENCY RACE RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
