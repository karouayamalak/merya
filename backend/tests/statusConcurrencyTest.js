/**
 * statusConcurrencyTest.js
 *
 * Adversarial concurrent status-transition tests for MERYA DZ.
 *
 * Tests A, B, C, D as specified in the production audit:
 *   A. 10× simultaneous At Agency → Returned  → exactly 1 restoration
 *   B. 10× simultaneous Pending  → Cancelled  → exactly 1 restoration
 *   C. 10× simultaneous Returned → Confirmed  → exactly 1 deduction
 *   D. 10× Returned → Confirmed with 0 stock  → all fail, state unchanged
 */

import assert from 'node:assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { Order } from '../src/models/Order.js';
import { updateOrderStatus } from '../src/services/orderService.js';
import { DeliverySetting } from '../src/models/DeliverySetting.js';
import { ALGERIA_WILAYAS } from '../src/config/constants.js';

dotenv.config();

const DB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/merya_dz';

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  // Build a minimal valid order
  const orderCode = `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const order = await Order.create({
    orderCode,
    customer: {
      fullName: 'Test Customer',
      phone: '0555000000',
      wilaya: { code: 16, name: 'Algiers' },
      deliveryMethod: 'home',
      address: '1 Test Street, Algiers'
    },
    items: [{
      productId,
      productName: 'Test Product',
      colorName,
      colorCode: '#000',
      size,
      quantity,
      unitPrice: 5000,
      unitCost: 2000,
      image: ''
    }],
    subtotal: 5000 * quantity,
    deliveryFee: 500,
    totalPrice: 5000 * quantity + 500,
    status,
    stockRestored
  });
  return order;
}

// ─────────────────────────────────────────────────────────────────────────────

async function runStatusConcurrencyTests() {
  console.log('=================================================================');
  console.log('  MERYA DZ — STATUS TRANSITION CONCURRENCY SAFETY TEST SUITE    ');
  console.log('=================================================================\n');

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(DB_URI);
  }

  // Ensure DeliverySetting exists (required by some code paths)
  let ds = await DeliverySetting.findOne();
  if (!ds) {
    const rates = ALGERIA_WILAYAS.map(w => ({
      wilayaCode: w.code,
      wilayaName: w.name,
      wilayaNameAr: w.nameAr,
      homeFee: 800,
      agencyFee: 500,
      isAvailable: true
    }));
    ds = await DeliverySetting.create({ singletonKey: 'default', freeDeliveryThreshold: 0, wilayaRates: rates });
  }

  // Create a shared test product
  const cat = await Category.create({
    name: 'Status Test Category',
    slug: `status-test-cat-${Date.now()}`,
    image: 'https://example.com/img.jpg'
  });

  const product = await Product.create({
    name: 'Status Concurrency Test Product',
    slug: `status-conc-${Date.now()}`,
    description: 'Concurrency test product for status transitions',
    category: cat._id,
    sellingPrice: 5000,
    costPrice: 2000,
    isActive: true,
    isArchived: false,
    colors: [{
      colorName: 'Black',
      colorCode: '#000000',
      sizes: [{ size: 'M', stock: 0 }]   // start at 0 — will be set per test
    }]
  });

  const productId = product._id.toString();
  const colorName = 'Black';
  const size = 'M';
  const quantity = 1;

  let passCount = 0;
  let failCount = 0;

  // ── TEST A: 10× simultaneous At Agency → Returned ─────────────────────────
  {
    console.log('── TEST A: 10× simultaneous [At Agency → Returned] ──');
    console.log('   Setup: stock = 0, stockRestored = false, status = At Agency');

    await setStock(productId, colorName, size, 0);
    const order = await createTestOrder({ productId, colorName, size, quantity, status: 'At agency', stockRestored: false });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        updateOrderStatus(order._id.toString(), 'Returned', 'TestAdmin', '', false)
      )
    );

    const successes = results.filter(r => r.status === 'fulfilled');
    const failures  = results.filter(r => r.status === 'rejected');

    console.log(`   Successes: ${successes.length}  Failures: ${failures.length}`);

    const finalStock = await getStock(productId, colorName, size);
    const finalOrder = await Order.findById(order._id);

    console.log(`   Final stock: ${finalStock} (expected: 1)`);
    console.log(`   Final order status: ${finalOrder.status} (expected: Returned)`);
    console.log(`   Final stockRestored: ${finalOrder.stockRestored} (expected: true)`);

    try {
      assert.strictEqual(successes.length, 1, `Expected exactly 1 success, got ${successes.length}`);
      assert.strictEqual(finalStock, 1, `Expected stock = 1, got ${finalStock}`);
      assert.strictEqual(finalOrder.status, 'Returned', `Expected status Returned, got ${finalOrder.status}`);
      assert.strictEqual(finalOrder.stockRestored, true, 'Expected stockRestored = true');
      console.log('   ✅ TEST A PASSED\n');
      passCount++;
    } catch (e) {
      console.error(`   ❌ TEST A FAILED: ${e.message}\n`);
      failCount++;
    }

    await Order.deleteOne({ _id: order._id });
  }

  // ── TEST B: 10× simultaneous Pending → Cancelled ──────────────────────────
  {
    console.log('── TEST B: 10× simultaneous [Pending → Cancelled] ──');
    console.log('   Setup: stock = 0 (already deducted upon order creation), stockRestored = false, status = Pending');

    await setStock(productId, colorName, size, 0);
    const order = await createTestOrder({ productId, colorName, size, quantity, status: 'Pending', stockRestored: false });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        updateOrderStatus(order._id.toString(), 'Cancelled', 'TestAdmin', '', false)
      )
    );

    const successes = results.filter(r => r.status === 'fulfilled');
    const failures  = results.filter(r => r.status === 'rejected');

    console.log(`   Successes: ${successes.length}  Failures: ${failures.length}`);

    const finalStock = await getStock(productId, colorName, size);
    const finalOrder = await Order.findById(order._id);

    console.log(`   Final stock: ${finalStock} (expected: 1 = 0 original + 1 restored)`);
    console.log(`   Final order status: ${finalOrder.status} (expected: Cancelled)`);
    console.log(`   Final stockRestored: ${finalOrder.stockRestored} (expected: true)`);

    try {
      assert.strictEqual(successes.length, 1, `Expected exactly 1 success, got ${successes.length}`);
      assert.strictEqual(finalStock, 1, `Expected stock = 1, got ${finalStock}`);
      assert.strictEqual(finalOrder.status, 'Cancelled', `Expected status Cancelled, got ${finalOrder.status}`);
      assert.strictEqual(finalOrder.stockRestored, true, 'Expected stockRestored = true');
      console.log('   ✅ TEST B PASSED\n');
      passCount++;
    } catch (e) {
      console.error(`   ❌ TEST B FAILED: ${e.message}\n`);
      failCount++;
    }

    await Order.deleteOne({ _id: order._id });
  }

  // ── TEST C: 10× simultaneous Returned → Confirmed ─────────────────────────
  {
    console.log('── TEST C: 10× simultaneous [Returned → Confirmed] ──');
    console.log('   Setup: stock = 1, stockRestored = true, status = Returned');

    await setStock(productId, colorName, size, 1);
    const order = await createTestOrder({ productId, colorName, size, quantity, status: 'Returned', stockRestored: true });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        updateOrderStatus(order._id.toString(), 'Confirmed', 'TestAdmin', '', false)
      )
    );

    const successes = results.filter(r => r.status === 'fulfilled');
    const failures  = results.filter(r => r.status === 'rejected');

    console.log(`   Successes: ${successes.length}  Failures: ${failures.length}`);

    const finalStock = await getStock(productId, colorName, size);
    const finalOrder = await Order.findById(order._id);

    console.log(`   Final stock: ${finalStock} (expected: 0)`);
    console.log(`   Final order status: ${finalOrder.status} (expected: Confirmed)`);
    console.log(`   Final stockRestored: ${finalOrder.stockRestored} (expected: false)`);

    try {
      assert.strictEqual(successes.length, 1, `Expected exactly 1 success, got ${successes.length}`);
      assert.strictEqual(finalStock, 0, `Expected stock = 0, got ${finalStock}`);
      assert.strictEqual(finalOrder.status, 'Confirmed', `Expected status Confirmed, got ${finalOrder.status}`);
      assert.strictEqual(finalOrder.stockRestored, false, 'Expected stockRestored = false');
      console.log('   ✅ TEST C PASSED\n');
      passCount++;
    } catch (e) {
      console.error(`   ❌ TEST C FAILED: ${e.message}\n`);
      failCount++;
    }

    await Order.deleteOne({ _id: order._id });
  }

  // ── TEST D: Returned → Confirmed with 0 available stock ───────────────────
  {
    console.log('── TEST D: [Returned → Confirmed] with 0 stock (all must fail) ──');
    console.log('   Setup: stock = 0, stockRestored = true, status = Returned');

    await setStock(productId, colorName, size, 0);
    const order = await createTestOrder({ productId, colorName, size, quantity, status: 'Returned', stockRestored: true });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        updateOrderStatus(order._id.toString(), 'Confirmed', 'TestAdmin', '', false)
      )
    );

    const successes = results.filter(r => r.status === 'fulfilled');
    const failures  = results.filter(r => r.status === 'rejected');

    console.log(`   Successes: ${successes.length}  Failures: ${failures.length}`);

    const finalStock = await getStock(productId, colorName, size);
    const finalOrder = await Order.findById(order._id);

    console.log(`   Final stock: ${finalStock} (expected: 0 — unchanged)`);
    console.log(`   Final order status: ${finalOrder.status} (expected: Returned)`);
    console.log(`   Final stockRestored: ${finalOrder.stockRestored} (expected: true)`);

    try {
      // At most 1 request can win the CAS (switching to Confirmed).
      // But then the inventory deduction must fail (stock=0), and the order must be rolled back.
      // So final result: status = Returned, stockRestored = true, stock = 0.
      assert.strictEqual(finalStock, 0, `Expected stock = 0, got ${finalStock}`);
      assert.strictEqual(finalOrder.status, 'Returned', `Expected status Returned after rollback, got ${finalOrder.status}`);
      assert.strictEqual(finalOrder.stockRestored, true, 'Expected stockRestored = true after rollback');
      console.log('   ✅ TEST D PASSED\n');
      passCount++;
    } catch (e) {
      console.error(`   ❌ TEST D FAILED: ${e.message}\n`);
      failCount++;
    }

    await Order.deleteOne({ _id: order._id });
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  await Product.deleteOne({ _id: productId });
  await Category.deleteOne({ _id: cat._id });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('=================================================================');
  console.log(`  RESULTS: ${passCount} passed / ${failCount} failed`);
  console.log('=================================================================\n');

  await mongoose.disconnect();

  if (failCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runStatusConcurrencyTests().catch(err => {
  console.error('\n[STATUS CONCURRENCY TEST ERROR]:', err);
  process.exit(1);
});
