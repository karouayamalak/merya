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
  if (!ds || !ds.wilayaRates || ds.wilayaRates.length < 58) {
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

  // ── TEST 1: At Agency → Returned raced by Returned → Confirmed on inventory failure
  {
    console.log('── TEST 1: Request A (At Agency → Returned) failure does NOT overwrite Request B (Returned → Confirmed) ──');
    console.log('   Setup: stock = 0, status = "At Agency", stockRestored = false');

    await setStock(productId, colorName, size, 0);
    const order = await createTestOrder({ productId, colorName, size, quantity, status: ORDER_STATUS.AT_AGENCY, stockRestored: false });

    // We hook Product.updateOne so that when Request A attempts to restore stock:
    // 1. We execute Request B: Returned → Confirmed (with stock replenished for B)
    // 2. Request B wins its CAS, deducts stock, and completes!
    // 3. Request A's updateOne throws an intentional error simulating inventory failure
    // 4. Request A attempts conditional rollback on its own state/version
    // 5. Result: A's rollback matches 0 documents and does NOT overwrite B's Confirmed state!

    const originalUpdateOne = Product.updateOne;
    let intercepted = false;

    Product.updateOne = async function (filter, update, options) {
      if (!intercepted && filter._id && filter._id.toString() === productId.toString()) {
        intercepted = true;
        console.log('   [Interception] Request A is in Phase 2 restoring stock. Launching concurrent Request B...');

        // Replenish stock so Request B can successfully deduct
        await originalUpdateOne.call(Product,
          { _id: productId },
          { $set: { 'colors.$[c].sizes.$[s].stock': 1 } },
          { arrayFilters: [{ 'c.colorName': colorName }, { 's.size': size }] }
        );

        // Request B: Returned → Confirmed
        const resB = await updateOrderStatus(order._id.toString(), 'Confirmed', 'AdminB', 'Confirmed by B');
        console.log(`   [Interception] Request B completed: status = ${resB.status}, __v = ${resB.__v}`);

        // Now simulate Request A's inventory restoration failure
        throw new Error('Simulated network failure during Request A stock restoration');
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

    // Inspect final state in DB
    const finalOrder = await Order.findById(order._id);
    const finalStock = await getStock(productId, colorName, size);

    console.log(`   Final order status: ${finalOrder.status} (expected: Confirmed)`);
    console.log(`   Final stockRestored: ${finalOrder.stockRestored} (expected: false)`);
    console.log(`   Final stock: ${finalStock} (expected: 0)`);

    try {
      assert.strictEqual(finalOrder.status, 'Confirmed', 'Order status must remain Confirmed (B wins, A rollback was skipped)');
      assert.strictEqual(finalOrder.stockRestored, false, 'stockRestored must be false');
      assert.strictEqual(finalStock, 0, 'Final stock must be 0 (deducted by B)');
      console.log('   ✅ TEST 1 PASSED: Conditional rollback safely protected Request B from blind overwrite!\n');
      passCount++;
    } catch (e) {
      console.error(`   ❌ TEST 1 FAILED: ${e.message}\n`);
      failCount++;
    }

    await Order.deleteOne({ _id: order._id });
  }

  // ── TEST 2: Reverse Direction — Returned → Confirmed fails inventory deduction while order is concurrently updated
  {
    console.log('── TEST 2: Request A (Returned → Confirmed) failed deduction does NOT overwrite concurrent modification ──');
    console.log('   Setup: stock = 0, status = "Returned", stockRestored = true');

    await setStock(productId, colorName, size, 0);
    const order = await createTestOrder({ productId, colorName, size, quantity, status: 'Returned', stockRestored: true });

    // Hook Product.findOneAndUpdate so that when Request A is in deductStockAtomic:
    // Before the deduction fails (or right as it attempts deduction):
    // A concurrent event updates the order (e.g. status transition or admin update that bumps __v)
    const originalFindOneAndUpdate = Product.findOneAndUpdate;
    let intercepted2 = false;

    Product.findOneAndUpdate = async function (filter, update, options) {
      if (!intercepted2 && filter._id && filter._id.toString() === productId.toString()) {
        intercepted2 = true;
        console.log('   [Interception] Request A is attempting stock deduction. Concurrent admin modifies order in background...');

        // Concurrent update modifies the order directly in DB, bumping __v and changing status
        await Order.updateOne(
          { _id: order._id },
          {
            $set: { status: 'Cancelled', notes: 'Concurrently cancelled by owner' },
            $inc: { __v: 1 }
          }
        );
        console.log('   [Interception] Concurrent order modification completed (__v incremented, status = Cancelled).');
      }
      return originalFindOneAndUpdate.call(this, filter, update, options);
    };

    let requestAFailed2 = false;
    try {
      // With stock = 0, deductStockAtomic will fail
      await updateOrderStatus(order._id.toString(), 'Confirmed', 'AdminA', 'Confirmed by A');
    } catch (err) {
      requestAFailed2 = true;
      console.log(`   Request A caught expected error: ${err.message}`);
    } finally {
      Product.findOneAndUpdate = originalFindOneAndUpdate;
    }

    assert.strictEqual(requestAFailed2, true, 'Request A must fail because stock is 0');

    const finalOrder2 = await Order.findById(order._id);
    console.log(`   Final order status: ${finalOrder2.status} (expected: Cancelled)`);

    try {
      assert.strictEqual(finalOrder2.status, 'Cancelled', 'Order status must remain Cancelled (concurrent state preserved)');
      console.log('   ✅ TEST 2 PASSED: Conditional rollback did NOT overwrite concurrent state!\n');
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
