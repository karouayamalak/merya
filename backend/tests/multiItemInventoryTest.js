/**
 * multiItemInventoryTest.js
 *
 * Adversarial tests for multi-item inventory atomicity using MongoDB transactions.
 *
 * Test E — Multi-item restoration failure:
 *   3-item order, At Agency → Returned, 3rd inventory update forced to fail.
 *   Expects: transaction aborts, order stays At Agency, stockRestored=false,
 *            NO partial stock changes on any of the 3 products.
 *
 * Test F — Multi-item reactivation failure:
 *   3-item Returned order, Returned → Confirmed, 3rd item has insufficient stock.
 *   Expects: transaction aborts, order stays Returned, stockRestored=true,
 *            NO partial stock deductions on any of the 3 items.
 *
 * Test G — 3-item full lifecycle:
 *   Pending → Confirmed → On the way → At Agency → Returned → Confirmed → Delivered
 *   Verifies stock at every step for all 3 products.
 *
 * Requirements:
 *   - MONGO_URI env var pointing to a replica-set-capable MongoDB (Atlas or local RS).
 *   - Standalone MongoDB instances cannot run multi-document transactions.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

// ─── Models ──────────────────────────────────────────────────────────────────
import { Product } from '../src/models/Product.js';
import { Order } from '../src/models/Order.js';
import { Category } from '../src/models/Category.js';
import { DeliverySetting } from '../src/models/DeliverySetting.js';

// ─── Services ─────────────────────────────────────────────────────────────────
import { placeOrder, updateOrderStatus } from '../src/services/orderService.js';
import { restoreStockAtomic, deductStockAtomic } from '../src/services/inventoryService.js';
import { ORDER_STATUS } from '../src/config/constants.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let testCategoryId = null;

async function getOrCreateCategory() {
  if (testCategoryId) return testCategoryId;
  let cat = await Category.findOne();
  if (!cat) {
    cat = await Category.create({
      name: 'Test Multi Item Category',
      slug: `test-multi-cat-${Date.now()}`,
      description: 'Test category for multi-item inventory'
    });
  }
  testCategoryId = cat._id;
  return testCategoryId;
}

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

async function getStock(productId, colorName, size) {
  const product = await Product.findById(productId).lean();
  const color = product.colors.find(c => c.colorName === colorName);
  const sizeObj = color?.sizes.find(s => s.size === size);
  return sizeObj?.stock ?? null;
}

async function createTestProduct(name, stock) {
  const categoryId = await getOrCreateCategory();
  return await Product.create({
    name,
    slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    description: `Test description for ${name}`,
    category: categoryId,
    sellingPrice: 100,
    costPrice: 50,
    isActive: true,
    isArchived: false,
    colors: [{
      colorName: 'Red',
      colorCode: '#FF0000',
      images: ['/test.jpg'],
      sizes: [{ size: 'M', stock }]
    }]
  });
}

async function ensureDeliverySettings() {
  let settings = await DeliverySetting.findOne();
  if (!settings) {
    settings = await DeliverySetting.create({
      singletonKey: 'default',
      freeDeliveryThreshold: 0,
      wilayaRates: Array.from({ length: 58 }, (_, i) => ({
        wilayaCode: i + 1,
        wilayaName: `Wilaya ${i + 1}`,
        agencyFee: 300,
        homeFee: 600,
        isAvailable: true
      }))
    });
  }
  // Ensure wilaya 16 is available
  const w16 = settings.wilayaRates?.find(r => r.wilayaCode === 16);
  if (!w16) {
    settings.wilayaRates.push({ wilayaCode: 16, agencyFee: 300, homeFee: 600, isAvailable: true });
    await settings.save();
  }
  return settings;
}

async function placeTestOrder(productA, productB, productC, qty = 1) {
  const items = [
    { productId: productA._id, colorName: 'Red', size: 'M', quantity: qty },
    { productId: productB._id, colorName: 'Red', size: 'M', quantity: qty },
    { productId: productC._id, colorName: 'Red', size: 'M', quantity: qty }
  ];
  const { order } = await placeOrder({
    customer: {
      fullName: 'Test Customer',
      phone: '0551234567',
      wilaya: { code: 16, name: 'Algiers' },
      deliveryMethod: 'agency',
      agencyName: 'Test Agency'
    },
    items,
    idempotencyKey: `test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  });
  return order;
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

async function runTestE() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('Test E — Multi-item restoration failure (forced 3rd fail)');
  console.log('══════════════════════════════════════════════════════════');

  const productA = await createTestProduct('TestE-ProductA', 1);
  const productB = await createTestProduct('TestE-ProductB', 1);
  const productC = await createTestProduct('TestE-ProductC', 1);

  // Place order and advance to At Agency (stock deducted)
  const order = await placeTestOrder(productA, productB, productC);
  await updateOrderStatus(order._id, ORDER_STATUS.CONFIRMED, 'Admin');
  await updateOrderStatus(order._id, ORDER_STATUS.ON_THE_WAY, 'Admin');
  await updateOrderStatus(order._id, ORDER_STATUS.AT_AGENCY, 'Admin');

  // Verify stock is 0 before test
  assert(await getStock(productA._id, 'Red', 'M') === 0, 'Pre-test: Product A stock = 0');
  assert(await getStock(productB._id, 'Red', 'M') === 0, 'Pre-test: Product B stock = 0');
  assert(await getStock(productC._id, 'Red', 'M') === 0, 'Pre-test: Product C stock = 0');

  // ── Force 3rd item restore to fail by sabotaging the product ──
  // Rename size so the 3rd updateOne finds matchedCount=0 → throws inside the transaction
  const originalSizeC = 'M';
  await Product.updateOne(
    { _id: productC._id, 'colors.colorName': 'Red', 'colors.sizes.size': 'M' },
    { $set: { 'colors.$[c].sizes.$[s].size': '__SABOTAGED__' } },
    { arrayFilters: [{ 'c.colorName': 'Red' }, { 's.size': 'M' }] }
  );

  let transactionAborted = false;
  try {
    await updateOrderStatus(order._id, ORDER_STATUS.RETURNED, 'Admin');
  } catch (err) {
    transactionAborted = true;
    console.log(`  → Transaction aborted as expected: ${err.message}`);
  }

  // Restore product C so we can query properly
  await Product.updateOne(
    { _id: productC._id, 'colors.colorName': 'Red', 'colors.sizes.size': '__SABOTAGED__' },
    { $set: { 'colors.$[c].sizes.$[s].size': 'M' } },
    { arrayFilters: [{ 'c.colorName': 'Red' }, { 's.size': '__SABOTAGED__' }] }
  );

  // Assertions
  assert(transactionAborted, 'Transaction aborted on 3rd item failure');

  const orderAfter = await Order.findById(order._id);
  assert(orderAfter.status === ORDER_STATUS.AT_AGENCY, `Order remains At Agency (got: ${orderAfter.status})`);
  assert(orderAfter.stockRestored === false, `stockRestored remains false (got: ${orderAfter.stockRestored})`);

  assert(await getStock(productA._id, 'Red', 'M') === 0, 'Product A stock unchanged (0) — no partial restore');
  assert(await getStock(productB._id, 'Red', 'M') === 0, 'Product B stock unchanged (0) — no partial restore');
  assert(await getStock(productC._id, 'Red', 'M') === 0, 'Product C stock unchanged (0) — no partial restore');

  // Cleanup
  await Product.deleteMany({ _id: { $in: [productA._id, productB._id, productC._id] } });
  await Order.findByIdAndDelete(order._id);
}

async function runTestF() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('Test F — Multi-item reactivation failure (insufficient stock)');
  console.log('══════════════════════════════════════════════════════════');

  const productA = await createTestProduct('TestF-ProductA', 1);
  const productB = await createTestProduct('TestF-ProductB', 1);
  const productCWithStock = await createTestProduct('TestF-ProductC-Source', 1);

  // Place order using C's "good" variant — we'll deplete after Returned
  const { order } = await placeOrder({
    customer: {
      fullName: 'Test Customer F',
      phone: '0551234568',
      wilaya: { code: 16, name: 'Algiers' },
      deliveryMethod: 'agency',
      agencyName: 'Test Agency F'
    },
    items: [
      { productId: productA._id, colorName: 'Red', size: 'M', quantity: 1 },
      { productId: productB._id, colorName: 'Red', size: 'M', quantity: 1 },
      { productId: productCWithStock._id, colorName: 'Red', size: 'M', quantity: 1 }
    ],
    idempotencyKey: `test-f-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  });

  // Advance to Returned (stock restored to A, B, C-source)
  await updateOrderStatus(order._id, ORDER_STATUS.CONFIRMED, 'Admin');
  await updateOrderStatus(order._id, ORDER_STATUS.ON_THE_WAY, 'Admin');
  await updateOrderStatus(order._id, ORDER_STATUS.AT_AGENCY, 'Admin');
  await updateOrderStatus(order._id, ORDER_STATUS.RETURNED, 'Admin');

  // Now externally deplete productCWithStock to 0 to force deductStockAtomic to fail
  await Product.updateOne(
    { _id: productCWithStock._id, 'colors.colorName': 'Red', 'colors.sizes.size': 'M' },
    { $set: { 'colors.$[c].sizes.$[s].stock': 0 } },
    { arrayFilters: [{ 'c.colorName': 'Red' }, { 's.size': 'M' }] }
  );

  const stockABefore = await getStock(productA._id, 'Red', 'M');
  const stockBBefore = await getStock(productB._id, 'Red', 'M');

  assert(stockABefore === 1, `Pre-test: Product A stock = 1 (got: ${stockABefore})`);
  assert(stockBBefore === 1, `Pre-test: Product B stock = 1 (got: ${stockBBefore})`);
  assert(await getStock(productCWithStock._id, 'Red', 'M') === 0, 'Pre-test: Product C stock = 0 (insufficient)');

  let transactionAborted = false;
  try {
    await updateOrderStatus(order._id, ORDER_STATUS.CONFIRMED, 'Admin');
  } catch (err) {
    transactionAborted = true;
    console.log(`  → Transaction aborted as expected: ${err.message}`);
  }

  // Assertions
  assert(transactionAborted, 'Transaction aborted on insufficient stock for 3rd item');

  const orderAfter = await Order.findById(order._id);
  assert(orderAfter.status === ORDER_STATUS.RETURNED, `Order remains Returned (got: ${orderAfter.status})`);
  assert(orderAfter.stockRestored === true, `stockRestored remains true (got: ${orderAfter.stockRestored})`);

  assert(await getStock(productA._id, 'Red', 'M') === 1, 'Product A stock unchanged (1) — no partial deduction');
  assert(await getStock(productB._id, 'Red', 'M') === 1, 'Product B stock unchanged (1) — no partial deduction');
  assert(await getStock(productCWithStock._id, 'Red', 'M') === 0, 'Product C stock unchanged (0)');

  // Cleanup
  await Product.deleteMany({ _id: { $in: [productA._id, productB._id, productCWithStock._id] } });
  await Order.findByIdAndDelete(order._id);
}

async function runTestG() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('Test G — 3-item full lifecycle with stock verification');
  console.log('══════════════════════════════════════════════════════════');

  const productA = await createTestProduct('TestG-ProductA', 1);
  const productB = await createTestProduct('TestG-ProductB', 1);
  const productC = await createTestProduct('TestG-ProductC', 1);

  // Initial state: A=1, B=1, C=1
  assert(await getStock(productA._id, 'Red', 'M') === 1, 'Initial: A=1');
  assert(await getStock(productB._id, 'Red', 'M') === 1, 'Initial: B=1');
  assert(await getStock(productC._id, 'Red', 'M') === 1, 'Initial: C=1');

  // Place order → Pending: A=0, B=0, C=0
  const order = await placeTestOrder(productA, productB, productC);
  assert(order.status === ORDER_STATUS.PENDING, 'Order is Pending');
  assert(await getStock(productA._id, 'Red', 'M') === 0, 'After order: A=0');
  assert(await getStock(productB._id, 'Red', 'M') === 0, 'After order: B=0');
  assert(await getStock(productC._id, 'Red', 'M') === 0, 'After order: C=0');

  // Pending → Confirmed: stock unchanged
  let o = await updateOrderStatus(order._id, ORDER_STATUS.CONFIRMED, 'Admin');
  assert(o.status === ORDER_STATUS.CONFIRMED, 'Status: Confirmed');
  assert(await getStock(productA._id, 'Red', 'M') === 0, 'Confirmed: A=0');
  assert(await getStock(productB._id, 'Red', 'M') === 0, 'Confirmed: B=0');
  assert(await getStock(productC._id, 'Red', 'M') === 0, 'Confirmed: C=0');

  // Confirmed → On the way: stock unchanged
  o = await updateOrderStatus(order._id, ORDER_STATUS.ON_THE_WAY, 'Admin');
  assert(o.status === ORDER_STATUS.ON_THE_WAY, 'Status: On the way');
  assert(await getStock(productA._id, 'Red', 'M') === 0, 'On the way: A=0');
  assert(await getStock(productB._id, 'Red', 'M') === 0, 'On the way: B=0');
  assert(await getStock(productC._id, 'Red', 'M') === 0, 'On the way: C=0');

  // On the way → At Agency: stock unchanged
  o = await updateOrderStatus(order._id, ORDER_STATUS.AT_AGENCY, 'Admin');
  assert(o.status === ORDER_STATUS.AT_AGENCY, 'Status: At Agency');
  assert(await getStock(productA._id, 'Red', 'M') === 0, 'At Agency: A=0');
  assert(await getStock(productB._id, 'Red', 'M') === 0, 'At Agency: B=0');
  assert(await getStock(productC._id, 'Red', 'M') === 0, 'At Agency: C=0');
  assert(o.stockRestored === false, 'At Agency: stockRestored=false');

  // At Agency → Returned: stock RESTORED → A=1, B=1, C=1
  o = await updateOrderStatus(order._id, ORDER_STATUS.RETURNED, 'Admin');
  assert(o.status === ORDER_STATUS.RETURNED, 'Status: Returned');
  assert(o.stockRestored === true, 'Returned: stockRestored=true');
  assert(await getStock(productA._id, 'Red', 'M') === 1, 'Returned: A=1 (restored)');
  assert(await getStock(productB._id, 'Red', 'M') === 1, 'Returned: B=1 (restored)');
  assert(await getStock(productC._id, 'Red', 'M') === 1, 'Returned: C=1 (restored)');

  // Returned → Confirmed: stock DEDUCTED → A=0, B=0, C=0
  o = await updateOrderStatus(order._id, ORDER_STATUS.CONFIRMED, 'Admin');
  assert(o.status === ORDER_STATUS.CONFIRMED, 'Status: Confirmed (reactivated)');
  assert(o.stockRestored === false, 'Reactivated: stockRestored=false');
  assert(await getStock(productA._id, 'Red', 'M') === 0, 'Reactivated: A=0');
  assert(await getStock(productB._id, 'Red', 'M') === 0, 'Reactivated: B=0');
  assert(await getStock(productC._id, 'Red', 'M') === 0, 'Reactivated: C=0');

  // Confirmed → On the way → At Agency → Delivered
  o = await updateOrderStatus(order._id, ORDER_STATUS.ON_THE_WAY, 'Admin');
  o = await updateOrderStatus(order._id, ORDER_STATUS.AT_AGENCY, 'Admin');
  o = await updateOrderStatus(order._id, ORDER_STATUS.DELIVERED, 'Admin');
  assert(o.status === ORDER_STATUS.DELIVERED, 'Status: Delivered');
  assert(o.stockRestored === false, 'Delivered: stockRestored=false');
  assert(await getStock(productA._id, 'Red', 'M') === 0, 'Delivered: A=0 (sold)');
  assert(await getStock(productB._id, 'Red', 'M') === 0, 'Delivered: B=0 (sold)');
  assert(await getStock(productC._id, 'Red', 'M') === 0, 'Delivered: C=0 (sold)');

  // Delivered is terminal — override attempt must fail
  let terminalViolation = false;
  try {
    await updateOrderStatus(order._id, ORDER_STATUS.CONFIRMED, 'Admin', '', true, 'trying to reopen');
  } catch (e) {
    terminalViolation = true;
  }
  assert(terminalViolation, 'Delivered → Confirmed is blocked (terminal)');

  // Cleanup
  await Product.deleteMany({ _id: { $in: [productA._id, productB._id, productC._id] } });
  await Order.findByIdAndDelete(order._id);
}

async function runOverrideSemanticTest() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('Test H — Override semantics');
  console.log('══════════════════════════════════════════════════════════');

  const productA = await createTestProduct('TestH-ProductA', 2);
  const productB = await createTestProduct('TestH-ProductB', 2);
  const productC = await createTestProduct('TestH-ProductC', 2);

  const order = await placeTestOrder(productA, productB, productC);

  // Normal transition without override flag — must succeed
  let transitionOk = false;
  try {
    await updateOrderStatus(order._id, ORDER_STATUS.CONFIRMED, 'Admin');
    transitionOk = true;
  } catch (e) {
    console.log(`  Unexpected: ${e.message}`);
  }
  assert(transitionOk, 'Normal Pending→Confirmed without override flag succeeds');

  // Override without reason → must fail
  let overrideWithoutReasonFailed = false;
  try {
    await updateOrderStatus(order._id, ORDER_STATUS.RETURNED, 'Admin', '', true, '');
  } catch (e) {
    overrideWithoutReasonFailed = e.message.includes('OVERRIDE_REQUIRES_REASON') || e.message.includes('overrideReason');
  }
  assert(overrideWithoutReasonFailed, 'Override without reason is rejected');

  // Delivered is terminal even with override and reason
  await updateOrderStatus(order._id, ORDER_STATUS.ON_THE_WAY, 'Admin');
  await updateOrderStatus(order._id, ORDER_STATUS.AT_AGENCY, 'Admin');
  await updateOrderStatus(order._id, ORDER_STATUS.DELIVERED, 'Admin');

  let deliveredTerminal = false;
  try {
    await updateOrderStatus(order._id, ORDER_STATUS.CONFIRMED, 'Admin', '', true, 'force reopen');
  } catch (e) {
    deliveredTerminal = e.message.includes('Terminal state violation');
  }
  assert(deliveredTerminal, 'Delivered is terminal even with override=true and overrideReason');

  // Cleanup
  await Product.deleteMany({ _id: { $in: [productA._id, productB._id, productC._id] } });
  await Order.findByIdAndDelete(order._id);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('ERROR: Neither MONGO_URI nor MONGODB_URI environment variable is set.');
    process.exit(1);
  }

  console.log(`\nConnecting to MongoDB: ${uri.replace(/\/\/[^:]+:[^@]+@/, '//<credentials>@')}`);
  await mongoose.connect(uri);
  console.log('Connected.\n');

  // Check replica set capability
  const adminDb = mongoose.connection.db.admin();
  let isReplicaSet = false;
  try {
    const status = await adminDb.command({ isMaster: 1 });
    isReplicaSet = !!(status.setName || status.hosts);
    if (!isReplicaSet) {
      console.warn('⚠  WARNING: This MongoDB instance does not appear to be a replica set.');
      console.warn('   MongoDB transactions require a replica set. Tests E and F will likely fail.');
      console.warn('   Production deployments on Atlas or Render (with replica set) will work correctly.\n');
    } else {
      console.log(`✓ Replica set detected: "${status.setName}". Transactions are supported.\n`);
    }
  } catch (e) {
    console.warn(`  Could not determine replica set status: ${e.message}`);
  }

  await ensureDeliverySettings();

  try {
    await runTestE();
  } catch (e) {
    console.error(`Test E crashed: ${e.message}`);
    if (!isReplicaSet && e.message?.includes('transaction')) {
      console.warn('  (This failure is expected on a standalone MongoDB — transactions need a replica set)');
    }
    failed++;
  }

  try {
    await runTestF();
  } catch (e) {
    console.error(`Test F crashed: ${e.message}`);
    if (!isReplicaSet && e.message?.includes('transaction')) {
      console.warn('  (This failure is expected on a standalone MongoDB — transactions need a replica set)');
    }
    failed++;
  }

  try {
    await runTestG();
  } catch (e) {
    console.error(`Test G crashed: ${e.message}`);
    failed++;
  }

  try {
    await runOverrideSemanticTest();
  } catch (e) {
    console.error(`Test H crashed: ${e.message}`);
    failed++;
  }

  await mongoose.disconnect();

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
