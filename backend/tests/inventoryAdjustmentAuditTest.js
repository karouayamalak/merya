import assert from 'node:assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { InventoryAdjustment } from '../src/models/InventoryAdjustment.js';
import { setStockAtomic } from '../src/services/inventoryService.js';

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

async function runAuditTests() {
  console.log('================================================================');
  console.log('  MERYA DZ — INVENTORY ADJUSTMENT PERSISTENT AUDIT TEST SUITE');
  console.log('================================================================\n');

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(DB_URI);
  }

  let cat = await Category.findOne({ slug: 'adj-audit-cat' });
  if (!cat) {
    cat = await Category.create({
      name: 'Adj Audit Category',
      slug: 'adj-audit-cat',
      description: 'Audit Category',
      image: 'https://example.com/cat.jpg'
    });
  }

  const product = await Product.create({
    name: 'Audit Test Product',
    slug: `audit-test-prod-${Date.now()}`,
    description: 'Audit Product Description',
    category: cat._id,
    sellingPrice: 3500,
    costPrice: 1800,
    isActive: true,
    colors: [
      {
        colorName: 'Rouge',
        colorCode: '#FF0000',
        images: ['https://example.com/rouge.jpg'],
        sizes: [
          { size: 'S', stock: 10 },
          { size: 'M', stock: 20 }
        ]
      }
    ]
  });

  const productId = product._id.toString();

  // ── TEST 1: Successful adjustment creates exactly one persistent audit record with correct fields ──
  console.log('── Test 1: Successful adjustment creates exactly one audit record ──');
  try {
    const initialRecords = await InventoryAdjustment.countDocuments({ productId });
    assert.strictEqual(initialRecords, 0, 'Should start with 0 audit records');

    const updated = await setStockAtomic(productId, 'Rouge', 'S', 25, 'SuperAdmin', 'Stock arrival shipment #42');

    assert.ok(updated._adjustment, 'Returned document must include _adjustment for backwards compatibility');
    assert.strictEqual(updated._adjustment.previousStock, 10);
    assert.strictEqual(updated._adjustment.newStock, 25);
    assert.strictEqual(updated._adjustment.reason, 'Stock arrival shipment #42');
    assert.strictEqual(updated._adjustment.admin, 'SuperAdmin');

    const records = await InventoryAdjustment.find({ productId, colorName: 'Rouge', size: 'S' });
    assert.strictEqual(records.length, 1, 'Exactly one persistent InventoryAdjustment document must exist');

    const record = records[0];
    assert.strictEqual(record.previousStock, 10, 'previousStock must be 10');
    assert.strictEqual(record.newStock, 25, 'newStock must be 25');
    assert.strictEqual(record.admin, 'SuperAdmin', 'admin identity must match');
    assert.strictEqual(record.reason, 'Stock arrival shipment #42', 'reason must match');
    assert.ok(record.timestamp instanceof Date, 'timestamp must be a valid Date');

    // Verify DB stock matches newStock
    const dbProd = await Product.findById(productId);
    const sz = dbProd.colors[0].sizes.find(s => s.size === 'S');
    assert.strictEqual(sz.stock, 25, 'DB stock must be 25');

    pass('Successful adjustment created exactly one durable InventoryAdjustment record with correct previousStock/newStock');
  } catch (err) {
    fail('Successful adjustment audit persistence', err);
  }

  // ── TEST 2: Failed adjustment creates no audit record ──
  console.log('\n── Test 2: Failed adjustments create no audit record ──');
  try {
    const recordsBefore = await InventoryAdjustment.countDocuments({ productId, colorName: 'Rouge', size: 'S' });

    // Failure 1: Negative stock
    await assert.rejects(
      async () => {
        await setStockAtomic(productId, 'Rouge', 'S', -5, 'Admin', 'Invalid negative');
      },
      /Stock cannot be negative/
    );

    // Failure 2: Non-existent color
    await assert.rejects(
      async () => {
        await setStockAtomic(productId, 'VertInexistant', 'S', 15, 'Admin', 'Invalid color');
      },
      /Color "VertInexistant" not found/
    );

    // Failure 3: Non-existent size
    await assert.rejects(
      async () => {
        await setStockAtomic(productId, 'Rouge', 'XXL', 15, 'Admin', 'Invalid size');
      },
      /Size "XXL" not found/
    );

    const recordsAfter = await InventoryAdjustment.countDocuments({ productId, colorName: 'Rouge', size: 'S' });
    assert.strictEqual(recordsAfter, recordsBefore, 'Failed adjustments must not create any audit records');

    pass('Failed adjustments created zero audit records');
  } catch (err) {
    fail('Failed adjustments audit creation', err);
  }

  // ── TEST 3: Concurrent adjustment conflict creates no false audit record ──
  console.log('\n── Test 3: Concurrent conflict creates no false audit record ──');
  try {
    // Current stock of 'M' is 20
    const recordsMBefore = await InventoryAdjustment.countDocuments({ productId, colorName: 'Rouge', size: 'M' });
    assert.strictEqual(recordsMBefore, 0);

    // Admin A and Admin B adjust simultaneously
    const results = await Promise.allSettled([
      setStockAtomic(productId, 'Rouge', 'M', 35, 'AdminA', 'Adjustment A'),
      setStockAtomic(productId, 'Rouge', 'M', 45, 'AdminB', 'Adjustment B')
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    assert.strictEqual(fulfilled.length, 1, 'Exactly one concurrent adjustment must succeed');
    assert.strictEqual(rejected.length, 1, 'Exactly one concurrent adjustment must be rejected');
    assert.ok(rejected[0].reason?.message?.includes('CONCURRENT_CONFLICT'), 'Rejection must be CONCURRENT_CONFLICT');

    // Crucial check: Exactly ONE audit record must exist for 'M' (the winner's record)
    // The losing request must have produced NO audit record
    const recordsMAfter = await InventoryAdjustment.find({ productId, colorName: 'Rouge', size: 'M' });
    assert.strictEqual(recordsMAfter.length, 1, 'Exactly one audit record must exist in DB (no false audit record for loser)');

    const winnerRecord = recordsMAfter[0];
    assert.strictEqual(winnerRecord.previousStock, 20);
    assert.ok([35, 45].includes(winnerRecord.newStock));
    assert.ok(['AdminA', 'AdminB'].includes(winnerRecord.admin));

    pass('Concurrent conflict produced exactly one audit record for winner and zero false records for loser');
  } catch (err) {
    fail('Concurrent conflict audit record creation', err);
  }

  // Clean up
  await InventoryAdjustment.deleteMany({ productId });
  await Product.deleteOne({ _id: productId });
  await Category.deleteOne({ _id: cat._id });

  await mongoose.disconnect();

  console.log('\n================================================================');
  console.log(`INVENTORY ADJUSTMENT AUDIT TEST SUITE: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runAuditTests().catch(err => {
  console.error('Fatal in inventoryAdjustmentAuditTest:', err);
  process.exit(1);
});
