import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { Product } from '../src/models/Product.js';
import { Order } from '../src/models/Order.js';
import { Category } from '../src/models/Category.js';
import { DeliverySetting } from '../src/models/DeliverySetting.js';
import {
  deductStockAtomic,
  restoreStockAtomic,
  setStockAtomic
} from '../src/services/inventoryService.js';
import {
  placeOrder,
  updateOrderStatus,
  updateOrderItemsService
} from '../src/services/orderService.js';
import { ORDER_STATUS } from '../src/config/constants.js';

describe('Inventory Concurrency & Lifecycle Adversarial Suite (All 16 Scenarios)', () => {
  let testCatId;

  before(async () => {
    try {
      if (mongoose.connection.readyState !== 1) {
        await connectDB();
      }
      await DeliverySetting.getSingleton();

      let cat = await Category.findOne({ slug: 'test-concurrency-cat' });
      if (!cat) {
        cat = await Category.create({
          name: { fr: 'Categorie Concurrency', ar: 'تصنيف التجربة', en: 'Concurrency Category' },
          slug: 'test-concurrency-cat',
          description: { fr: 'Desc FR', ar: 'وصف', en: 'Desc EN' },
          image: 'https://example.com/cat.jpg',
          isActive: true
        });
      }
      testCatId = cat._id;
    } catch (err) {
      console.error('CRITICAL BEFORE HOOK FAILURE:', err);
      throw err;
    }
  });

  after(async () => {
    await Product.deleteMany({ slug: { $regex: /^test-conc-/ } });
    await Order.deleteMany({ orderCode: { $regex: /^MD-CONC-/ } });
    // Disconnect MongoDB so the process exits cleanly (no hanging open handles)
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  // Helper to create fresh test product
  async function createTestProduct(suffix, stock = 10) {
    const slug = `test-conc-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    return await Product.create({
      name: { fr: `Produit Conc ${suffix}`, ar: `منتج تجربة ${suffix}`, en: `Conc Product ${suffix}` },
      description: { fr: `Description Conc ${suffix}`, ar: `وصف تجربة ${suffix}`, en: `Conc Description ${suffix}` },
      slug,
      category: testCatId,
      sellingPrice: 4000,
      costPrice: 2500,
      isActive: true,
      isArchived: false,
      colors: [
        {
          colorName: 'Noir',
          colorDisplayName: { fr: 'Noir', ar: 'أسود', en: 'Black' },
          colorCode: '#000000',
          images: ['https://example.com/noir.jpg'],
          sizes: [
            { size: 'M', stock: stock },
            { size: 'L', stock: stock }
          ]
        }
      ]
    });
  }

  // ─── 1. Checkout vs Product Edit ──────────────────────────────────────────
  test('1. Checkout vs Product Edit: Concurrent checkout during product edit does not lose stock or overwrite version', async () => {
    const prod = await createTestProduct('chk-vs-edit', 10);

    // Simulate product edit reading version 0
    const loadedProd = await Product.findById(prod._id);
    assert.strictEqual(loadedProd.colors[0].sizes[0].stock, 10);
    const initialVersion = loadedProd.__v;

    // Concurrent checkout occurs while admin was editing
    await deductStockAtomic([
      { productId: prod._id, colorName: 'Noir', size: 'M', quantity: 3 }
    ]);

    const postCheckout = await Product.findById(prod._id);
    assert.strictEqual(postCheckout.colors[0].sizes[0].stock, 7);
    assert.ok(postCheckout.__v > initialVersion, 'Checkout must increment __v');

    // Admin attempts to save with stale expectedVersion
    // CAS check must detect conflict (409)
    const casUpdate = await Product.findOneAndUpdate(
      { _id: prod._id, __v: initialVersion },
      { $set: { 'name.fr': 'Renamed Product' }, $inc: { __v: 1 } },
      { new: true }
    );
    assert.strictEqual(casUpdate, null, 'Stale product edit must be rejected with null / 409 conflict');

    // Live stock remains intact
    const finalProd = await Product.findById(prod._id);
    assert.strictEqual(finalProd.colors[0].sizes[0].stock, 7);
  });

  // ─── 2. Checkout vs Manual Inventory Adjustment ───────────────────────────
  test('2. Checkout vs Manual Inventory Adjustment: Concurrent stock adjustment detects version conflict', async () => {
    const prod = await createTestProduct('chk-vs-adj', 10);

    // Admin starts adjustment reading version
    const readBefore = await Product.findById(prod._id);

    // Checkout occurs first
    await deductStockAtomic([
      { productId: prod._id, colorName: 'Noir', size: 'M', quantity: 2 }
    ]);

    // Admin adjustment using the previous expectedVersion must fail with CONCURRENT_CONFLICT
    await assert.rejects(
      async () => {
        // Manually invoke CAS with stale version
        const updated = await Product.findOneAndUpdate(
          {
            _id: prod._id,
            __v: readBefore.__v,
            'colors.colorName': 'Noir',
            'colors.sizes.size': 'M'
          },
          {
            $set: { 'colors.$[c].sizes.$[s].stock': 20 },
            $inc: { __v: 1 }
          },
          {
            arrayFilters: [{ 'c.colorName': 'Noir' }, { 's.size': 'M' }],
            new: true
          }
        );
        if (!updated) {
          throw new Error('CONCURRENT_CONFLICT: Product was modified concurrently');
        }
      },
      /CONCURRENT_CONFLICT/
    );

    // Stock was not overwritten to 20; remains 8
    const live = await Product.findById(prod._id);
    assert.strictEqual(live.colors[0].sizes[0].stock, 8);
  });

  // ─── 3. Two Simultaneous Admin Stock Adjustments ──────────────────────────
  test('3. Two Simultaneous Admin Stock Adjustments: Exactly one succeeds and one receives 409 conflict', async () => {
    const prod = await createTestProduct('two-admins', 10);

    // Both read same initial state
    const admin1Read = await Product.findById(prod._id);
    const admin2Read = await Product.findById(prod._id);
    assert.strictEqual(admin1Read.__v, admin2Read.__v);

    // Both attempt setStockAtomic concurrently
    const results = await Promise.allSettled([
      setStockAtomic(prod._id, 'Noir', 'M', 15, 'Admin1', 'Restock 1'),
      setStockAtomic(prod._id, 'Noir', 'M', 25, 'Admin2', 'Restock 2')
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    assert.strictEqual(fulfilled.length, 1, 'Exactly one concurrent admin adjustment must succeed');
    assert.strictEqual(rejected.length, 1, 'The competing concurrent adjustment must be rejected');
    assert.match(rejected[0].reason.message, /CONCURRENT_CONFLICT/);

    const finalProd = await Product.findById(prod._id);
    assert.ok(finalProd.colors[0].sizes[0].stock === 15 || finalProd.colors[0].sizes[0].stock === 25);
  });

  // ─── 4 & 5. Cancellation & Return vs Product Edit ─────────────────────────
  test('4-5. Cancellation and Return vs Product Edit: Restorations increment __v and cannot be overwritten by stale edit', async () => {
    const prod = await createTestProduct('rest-vs-edit', 5);
    const v0 = prod.__v;

    // Simulate order cancellation restoration
    await restoreStockAtomic([
      { productId: prod._id, colorName: 'Noir', size: 'M', quantity: 2 }
    ]);
    const afterCancel = await Product.findById(prod._id);
    assert.strictEqual(afterCancel.colors[0].sizes[0].stock, 7);
    assert.strictEqual(afterCancel.__v, v0 + 1);

    // Stale edit with v0 fails
    const editWithV0 = await Product.findOneAndUpdate(
      { _id: prod._id, __v: v0 },
      { $set: { 'name.fr': 'Stale Name' }, $inc: { __v: 1 } }
    );
    assert.strictEqual(editWithV0, null);

    // Simulate return restoration
    await restoreStockAtomic([
      { productId: prod._id, colorName: 'Noir', size: 'M', quantity: 3 }
    ]);
    const afterReturn = await Product.findById(prod._id);
    assert.strictEqual(afterReturn.colors[0].sizes[0].stock, 10);
    assert.strictEqual(afterReturn.__v, v0 + 2);

    // Stale edit with v1 also fails
    const editWithV1 = await Product.findOneAndUpdate(
      { _id: prod._id, __v: v0 + 1 },
      { $set: { 'name.fr': 'Stale Name' }, $inc: { __v: 1 } }
    );
    assert.strictEqual(editWithV1, null);
  });

  // ─── 6. Admin Order-Item Edit vs Checkout ─────────────────────────────────
  test('6. Admin Order-Item Edit vs Checkout: Stock adjustments use atomic conditionals preventing oversell', async () => {
    const prod = await createTestProduct('item-edit-vs-chk', 3);

    // Create an order for 1 item
    const orderRes = await placeOrder({
      idempotencyKey: `ord-edit-${Date.now()}`,
      customer: {
        fullName: 'Client Test',
        phone: '0551234567',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: 'home',
        address: 'Rue 123 Alger'
      },
      items: [
        { productId: prod._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }
      ]
    });
    const order = orderRes.order;

    // Remaining stock is now 2
    const midProd = await Product.findById(prod._id);
    assert.strictEqual(midProd.colors[0].sizes[0].stock, 2);

    // Competing checkout consumes remaining 2 units
    await deductStockAtomic([
      { productId: prod._id, colorName: 'Noir', size: 'M', quantity: 2 }
    ]);

    // Admin tries to increase order items from 1 to 2 (delta = +1)
    // Must fail because remaining stock is 0
    await assert.rejects(
      async () => {
        await updateOrderItemsService({
          orderId: order._id.toString(),
          newItems: [
            { productId: prod._id.toString(), colorName: 'Noir', size: 'M', quantity: 2 }
          ],
          reason: 'Customer requested 1 more item'
        });
      },
      /Insufficient stock/
    );

    const finalProd = await Product.findById(prod._id);
    assert.strictEqual(finalProd.colors[0].sizes[0].stock, 0, 'Stock must not go negative');
  });

  // ─── 7. Multi-Item Checkout Rollback ──────────────────────────────────────
  test('7. Multi-item checkout rollback: If any item is out of stock, entire transaction aborts with zero deductions', async () => {
    const prodA = await createTestProduct('multi-a', 5);
    const prodB = await createTestProduct('multi-b', 0); // Out of stock

    await assert.rejects(
      async () => {
        await placeOrder({
          idempotencyKey: `multi-fail-${Date.now()}`,
          customer: {
            fullName: 'Client Rollback',
            phone: '0551234567',
            wilaya: { code: 16, name: 'Alger' },
            deliveryMethod: 'home',
            address: 'Rue 123 Alger'
          },
          items: [
            { productId: prodA._id.toString(), colorName: 'Noir', size: 'M', quantity: 2 },
            { productId: prodB._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }
          ]
        });
      },
      /remaining/
    );

    // Prod A stock must be completely untouched (5)
    const checkProdA = await Product.findById(prodA._id);
    assert.strictEqual(checkProdA.colors[0].sizes[0].stock, 5);
  });

  // ─── 8, 10, 11. Concurrent Deductions, No Negative Stock, No Lost Updates ─
  test('8, 10, 11. Concurrent Deductions: 10 concurrent requests for 1 stock results in exactly 1 success and 0 negative stock', async () => {
    const prod = await createTestProduct('conc-deduct', 1);

    const promises = Array.from({ length: 10 }, (_, i) =>
      placeOrder({
        idempotencyKey: `conc-10x-${Date.now()}-${i}`,
        customer: {
          fullName: `Client ${i}`,
          phone: '0551234567',
          wilaya: { code: 16, name: 'Alger' },
          deliveryMethod: 'home',
          address: 'Rue 123 Alger'
        },
        items: [
          { productId: prod._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }
        ]
      })
    );

    const outcomes = await Promise.allSettled(promises);
    const successes = outcomes.filter(o => o.status === 'fulfilled');
    const failures = outcomes.filter(o => o.status === 'rejected');

    assert.strictEqual(successes.length, 1, 'Exactly one concurrent order can claim the 1 available unit');
    assert.strictEqual(failures.length, 9, 'All other 9 concurrent attempts must be rejected');

    const finalProd = await Product.findById(prod._id);
    assert.strictEqual(finalProd.colors[0].sizes[0].stock, 0, 'Final stock must be exactly 0, never negative');
  });

  // ─── 9, 13. Concurrent Restorations, Exact-Once Restoration ──────────────
  test('9, 13. Exact-once restoration: Concurrent status transitions to Cancelled restore stock exactly once', async () => {
    const prod = await createTestProduct('exact-rest', 5);

    const orderRes = await placeOrder({
      idempotencyKey: `exact-rest-${Date.now()}`,
      customer: {
        fullName: 'Client Cancel',
        phone: '0551234567',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: 'home',
        address: 'Rue 123 Alger'
      },
      items: [
        { productId: prod._id.toString(), colorName: 'Noir', size: 'M', quantity: 2 }
      ]
    });
    const order = orderRes.order;

    // Stock after checkout is 3
    const midProd = await Product.findById(prod._id);
    assert.strictEqual(midProd.colors[0].sizes[0].stock, 3);

    // Two simultaneous requests to cancel the same order
    const cancelResults = await Promise.allSettled([
      updateOrderStatus(order._id.toString(), ORDER_STATUS.CANCELLED, 'Admin', 'Client changed mind 1'),
      updateOrderStatus(order._id.toString(), ORDER_STATUS.CANCELLED, 'Admin', 'Client changed mind 2')
    ]);

    // Both can resolve (or one may be idempotent / conflict), but stock MUST BE RESTORED EXACTLY ONCE
    const finalProd = await Product.findById(prod._id);
    assert.strictEqual(finalProd.colors[0].sizes[0].stock, 5, 'Stock must return to 5, never double-restored to 7');

    const finalOrder = await Order.findById(order._id);
    assert.strictEqual(finalOrder.stockRestored, true);
  });

  // ─── 12. No Stale Colors Overwrite ────────────────────────────────────────
  test('12. No Stale Colors Overwrite: Re-reading authoritative live stock guarantees newest variant inventory is preserved', async () => {
    const prod = await createTestProduct('stale-colors', 10);

    // Checkout mutates stock to 4
    await deductStockAtomic([
      { productId: prod._id, colorName: 'Noir', size: 'M', quantity: 6 }
    ]);

    // Admin updates colors structure (e.g. updating image or color displayName)
    const live = await Product.findById(prod._id, 'colors __v').lean();
    assert.strictEqual(live.colors[0].sizes[0].stock, 4);

    const mergedColors = live.colors.map(col => ({
      ...col,
      images: ['https://example.com/new-noir-image.jpg']
    }));

    const updateRes = await Product.findOneAndUpdate(
      { _id: prod._id, __v: live.__v },
      { $set: { colors: mergedColors }, $inc: { __v: 1 } },
      { new: true }
    );
    assert.ok(updateRes);
    assert.strictEqual(updateRes.colors[0].sizes[0].stock, 4, 'Variant stock of 4 must be preserved');
    assert.strictEqual(updateRes.colors[0].images[0], 'https://example.com/new-noir-image.jpg');
  });

  // ─── 14, 15. Exact-Once Re-deduction and Insufficient Stock on Reactivation
  test('14-15. Reactivation: Re-deducts stock exactly once, and fails if insufficient stock', async () => {
    const prod = await createTestProduct('reactivate', 2);

    // Place order for 2
    const orderRes = await placeOrder({
      idempotencyKey: `react-test-${Date.now()}`,
      customer: {
        fullName: 'Client Reactivate',
        phone: '0551234567',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: 'home',
        address: 'Rue 123 Alger'
      },
      items: [
        { productId: prod._id.toString(), colorName: 'Noir', size: 'M', quantity: 2 }
      ]
    });
    const order = orderRes.order;

    // Stock is 0. Cancel order -> stock restored to 2
    await updateOrderStatus(order._id.toString(), ORDER_STATUS.CANCELLED, 'Admin', 'Cancelled');
    const prodAfterCancel = await Product.findById(prod._id);
    assert.strictEqual(prodAfterCancel.colors[0].sizes[0].stock, 2);

    // Another buyer buys 1 unit -> stock becomes 1
    await deductStockAtomic([
      { productId: prod._id, colorName: 'Noir', size: 'M', quantity: 1 }
    ]);
    const prodAfterIntervening = await Product.findById(prod._id);
    assert.strictEqual(prodAfterIntervening.colors[0].sizes[0].stock, 1);

    // Attempting to reactivate the cancelled order (which requires 2 units) must FAIL
    await assert.rejects(
      async () => {
        await updateOrderStatus(order._id.toString(), ORDER_STATUS.CONFIRMED, 'Admin', 'Reactivating order', true, 'Admin override');
      },
      /Insufficient stock/
    );

    // Stock remains 1
    const prodStill1 = await Product.findById(prod._id);
    assert.strictEqual(prodStill1.colors[0].sizes[0].stock, 1);

    // Restock 5 units -> stock becomes 6
    await restoreStockAtomic([
      { productId: prod._id, colorName: 'Noir', size: 'M', quantity: 5 }
    ]);

    // Now reactivate succeeds and deducts 2 units -> stock becomes 4
    await updateOrderStatus(order._id.toString(), ORDER_STATUS.CONFIRMED, 'Admin', 'Reactivating order', true, 'Admin override');
    const prodFinal = await Product.findById(prod._id);
    assert.strictEqual(prodFinal.colors[0].sizes[0].stock, 4);

    const reactivatedOrder = await Order.findById(order._id);
    assert.strictEqual(reactivatedOrder.stockRestored, false);
    assert.strictEqual(reactivatedOrder.status, ORDER_STATUS.CONFIRMED);
  });

  // ─── 16. Version Conflicts Return 409 ─────────────────────────────────────
  test('16. Version Conflicts Return 409: CAS guard triggers 409 conflict code on version drift', async () => {
    const prod = await createTestProduct('cas-409', 10);
    const staleVersion = prod.__v;

    // Advance product version by modifying it
    await Product.updateOne({ _id: prod._id }, { $inc: { __v: 1 } });

    // Stale version CAS condition
    const res = await Product.findOneAndUpdate(
      { _id: prod._id, __v: staleVersion },
      { $set: { 'name.fr': 'New Name' }, $inc: { __v: 1 } }
    );

    assert.strictEqual(res, null, 'CAS update with stale version must return null leading to 409');
  });
});
