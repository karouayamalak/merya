import assert from 'node:assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { Order } from '../src/models/Order.js';
import { placeOrder } from '../src/services/orderService.js';
import { deductStockAtomic } from '../src/services/inventoryService.js';

dotenv.config();

const DB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/merya_dz';

async function runConcurrencyTests() {
  console.log('================================================================');
  console.log('     MERYA DZ — ADVERSARIAL HIGH-CONCURRENCY STRESS TEST        ');
  console.log('================================================================\n');

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(DB_URI);
  }

  // Create temporary category & product with exactly 1 unit of stock
  const cat = await Category.create({
    name: 'Flash Sale Category',
    slug: `flash-sale-${Date.now()}`,
    image: 'https://example.com/flash.jpg'
  });

  const product = await Product.create({
    name: 'Flash Drop Abaya (1 in stock)',
    slug: `flash-drop-${Date.now()}`,
    description: 'High concurrency flash drop test product',
    category: cat._id,
    sellingPrice: 7500,
    costPrice: 4000,
    isActive: true,
    isArchived: false,
    colors: [
      {
        colorName: 'Midnight Noir',
        colorCode: '#111111',
        sizes: [
          { size: 'M', stock: 1 } // EXACTLY ONE UNIT IN STOCK
        ]
      }
    ]
  });

  const productId = product._id.toString();
  const colorName = 'Midnight Noir';
  const size = 'M';

  console.log(`[Setup] Product created: "${product.name}"`);
  console.log(`[Setup] Starting Stock: 1 unit`);
  console.log(`[Setup] Launching 10 SIMULTANEOUS checkout requests for this single unit...\n`);

  const orderPromises = [];
  for (let i = 1; i <= 10; i++) {
    const p = placeOrder({
      idempotencyKey: `concurrent-stress-${i}-${Date.now()}`,
      customer: {
        fullName: `Shopper ${i}`,
        phone: `055500000${i}`,
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: 'home',
        address: `Street ${i}, Alger`
      },
      items: [
        {
          productId,
          colorName,
          size,
          quantity: 1
        }
      ]
    }).then(res => ({ success: true, orderCode: res.order.orderCode, index: i }))
      .catch(err => ({ success: false, error: err.message, index: i }));

    orderPromises.push(p);
  }

  const results = await Promise.all(orderPromises);

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`--- [RESULTS: 10 CONCURRENT CHECKOUTS AGAINST 1 UNIT] ---`);
  console.log(`  Successful checkouts: ${successful.length}`);
  console.log(`  Failed (rejected) checkouts: ${failed.length}`);

  // Assert exactly 1 success and 9 failures
  assert.strictEqual(successful.length, 1, `CRITICAL CONCURRENCY FAILURE: Expected exactly 1 successful order, but got ${successful.length}`);
  assert.strictEqual(failed.length, 9, `Expected 9 failed orders, got ${failed.length}`);
  console.log(`  ✓ Winning Order Code: ${successful[0].orderCode}`);

  // Check database stock directly
  const freshProduct = await Product.findById(productId);
  const remainingStock = freshProduct.colors[0].sizes[0].stock;
  console.log(`  ✓ Authoritative Stock in MongoDB: ${remainingStock}`);
  assert.strictEqual(remainingStock, 0, `CRITICAL INVENTORY FAILURE: Expected stock 0, but got ${remainingStock}`);

  // -------------------------------------------------------------
  // TEST 2: MULTI-ITEM PARTIAL FAILURE & ROLLBACK PROTECTION
  // -------------------------------------------------------------
  console.log('\n--- [TEST 2: MULTI-ITEM BATCH ROLLBACK TEST] ---');
  // Add a second variant: Size S (stock: 5), Size L (stock: 0)
  await Product.updateOne(
    { _id: productId },
    {
      $push: {
        "colors.0.sizes": [
          { size: 'S', stock: 5 },
          { size: 'L', stock: 0 } // OUT OF STOCK
        ]
      }
    }
  );

  console.log('Testing cart with Item 1 (Size S, in stock) + Item 2 (Size L, out of stock)...');
  try {
    await deductStockAtomic([
      { productId, colorName, size: 'S', quantity: 2 },
      { productId, colorName, size: 'L', quantity: 1 } // MUST FAIL
    ]);
    assert.fail('Multi-item checkout should have failed due to Size L stock out');
  } catch (err) {
    console.log(`  ✓ Multi-item transaction aborted cleanly: "${err.message}"`);
  }

  // Verify Size S was rolled back to 5 and not left at 3
  const rollbackProduct = await Product.findById(productId);
  const sizeSStock = rollbackProduct.colors[0].sizes.find(s => s.size === 'S').stock;
  console.log(`  ✓ Size S Stock after rollback: ${sizeSStock} (expected: 5)`);
  assert.strictEqual(sizeSStock, 5, `ROLLBACK FAILURE: Stock was not rolled back, current: ${sizeSStock}`);

  // Cleanup test documents
  await Category.deleteOne({ _id: cat._id });
  await Product.deleteOne({ _id: productId });
  await Order.deleteMany({ "customer.fullName": { $regex: /^Shopper/ } });

  console.log('\n================================================================');
  console.log('  ALL CONCURRENCY & TRANSACTION ROLLBACK TESTS PASSED 100%!     ');
  console.log('================================================================\n');

  await mongoose.disconnect();
  process.exit(0);
}

runConcurrencyTests().catch(err => {
  console.error('\n[CONCURRENCY TEST ERROR]:', err);
  process.exit(1);
});
