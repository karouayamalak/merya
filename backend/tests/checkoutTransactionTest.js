/**
 * checkoutTransactionTest.js
 *
 * Comprehensive adversarial verification for:
 * 1. Transactional Checkout Atomicity (all-or-nothing stock deduction & order creation)
 * 2. Concurrent same-key checkout (exactly 1 order created, 9 return duplicate)
 * 3. Concurrent different-key checkout (exactly 1 order created, 9 rejected, stock = 0)
 * 4. Multi-item transaction failure (3-item order, 3rd fails -> 0 stock deducted for all 3)
 * 5. Duplicate-key transaction handling & fingerprint mismatch (409 conflict)
 * 6. Clean retry after aborted transaction
 * 7. HTTP status override schema & API validation (Tests 1, 2, 3, 4)
 * 8. Variant protection against destructive edits/deletions on active orders
 */

import assert from 'node:assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { Order } from '../src/models/Order.js';
import { DeliverySetting } from '../src/models/DeliverySetting.js';
import { placeOrder, updateOrderStatus } from '../src/services/orderService.js';
import { changeOrderStatus } from '../src/controllers/orderController.js';
import { updateProduct, archiveProduct } from '../src/controllers/productController.js';
import { statusChangeSchema } from '../src/middleware/validation.js';
import { ORDER_STATUS, ALGERIA_WILAYAS, DELIVERY_METHODS } from '../src/config/constants.js';

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

async function getStock(productId, colorName, size) {
  const p = await Product.findById(productId).lean();
  return p.colors.find(c => c.colorName === colorName)?.sizes.find(s => s.size === size)?.stock ?? -1;
}

let testCat = null;

async function getTestCategory() {
  if (testCat) return testCat;
  testCat = await Category.findOne({ slug: 'checkout-tx-test-cat' });
  if (!testCat) {
    testCat = await Category.create({
      name: 'Checkout Tx Category',
      slug: 'checkout-tx-test-cat',
      description: 'Category for checkout transaction testing',
      image: '/test.jpg'
    });
  }
  return testCat;
}

async function createProduct(name, stock, price = 3000) {
  const cat = await getTestCategory();
  return await Product.create({
    name,
    slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description: `Description for ${name}`,
    category: cat._id,
    sellingPrice: price,
    costPrice: 1500,
    isActive: true,
    colors: [
      {
        colorName: 'Noir',
        colorCode: '#000000',
        images: ['/test.jpg'],
        sizes: [{ size: 'M', stock }]
      }
    ]
  });
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

async function runCheckoutTransactionTests() {
  console.log('================================================================');
  console.log('  MERYA DZ — CHECKOUT TRANSACTION & API AUDIT TEST SUITE');
  console.log('================================================================\n');

  await mongoose.connect(DB_URI);
  console.log(`Connected to MongoDB: ${mongoose.connection.host}\n`);

  // Ensure default delivery settings exist
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

  // ── 1. CHECKOUT TEST A: 10 CONCURRENT SAME-KEY REQUESTS (1 UNIT AVAILABLE) ──
  console.log('── 1. Checkout Test A: 10 concurrent requests, same idempotency key, 1 unit ──');
  {
    const prod = await createProduct('Same Key Tx Product', 1);
    const key = `same-key-tx-${Date.now()}`;
    const payload = {
      customer: {
        fullName: 'Same Key Customer',
        phone: '0555111111',
        wilaya: { code: 16, name: 'Algiers' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: '10 Rue Didouche'
      },
      items: [{ productId: prod._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }],
      idempotencyKey: key
    };

    const promises = Array.from({ length: 10 }, () => placeOrder(payload).catch(err => ({ error: err.message })));
    const results = await Promise.all(promises);

    const successful = results.filter(r => r.order && !r.error);
    const orderCodes = new Set(successful.map(r => r.order.orderCode));
    const finalStock = await getStock(prod._id, 'Noir', 'M');
    const orderCountInDB = await Order.countDocuments({ idempotencyKey: key });

    try {
      assert.strictEqual(orderCountInDB, 1, 'Exactly 1 Order document must exist in database');
      assert.strictEqual(orderCodes.size, 1, 'All successful responses must refer to the exact same orderCode');
      assert.strictEqual(finalStock, 0, 'Stock must decrease exactly once from 1 to 0');
      assert.strictEqual(successful.length, 10, 'All 10 requests must receive the order (1 created + 9 duplicates)');
      pass('Checkout Test A: 1 Order created, stock decreased exactly once, 9 duplicate returns');
    } catch (e) {
      fail('Checkout Test A', e);
    }
  }

  // ── 2. CHECKOUT TEST B: 10 CONCURRENT DIFFERENT-KEY REQUESTS (1 UNIT AVAILABLE) ──
  console.log('\n── 2. Checkout Test B: 10 concurrent requests, different idempotency keys, 1 unit ──');
  {
    const prod = await createProduct('Diff Key Tx Product', 1);
    const promises = Array.from({ length: 10 }, (_, i) => {
      return placeOrder({
        customer: {
          fullName: `Diff Customer ${i}`,
          phone: `055500000${i}`,
          wilaya: { code: 16, name: 'Algiers' },
          deliveryMethod: DELIVERY_METHODS.HOME,
          address: `Rue ${i}`
        },
        items: [{ productId: prod._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }],
        idempotencyKey: `diff-key-tx-${Date.now()}-${i}`
      }).catch(err => ({ error: err.message }));
    });

    const results = await Promise.all(promises);
    const successful = results.filter(r => r.order && !r.error);
    const rejected = results.filter(r => r.error);
    const finalStock = await getStock(prod._id, 'Noir', 'M');

    try {
      assert.strictEqual(successful.length, 1, 'Exactly 1 checkout must succeed');
      assert.strictEqual(rejected.length, 9, 'Exactly 9 checkouts must be rejected');
      assert.strictEqual(finalStock, 0, 'Final stock in DB must be exactly 0');
      pass('Checkout Test B: Exactly 1 order placed, 9 rejected, stock = 0');
    } catch (e) {
      fail('Checkout Test B', e);
    }
  }

  // ── 3. CHECKOUT TEST C: 3-ITEM ORDER WHERE 3RD ITEM FAILS (ALL-OR-NOTHING) ──
  console.log('\n── 3. Checkout Test C: 3-item order where third item fails ──');
  {
    const prodA = await createProduct('Tx Prod A', 5);
    const prodB = await createProduct('Tx Prod B', 5);
    const prodC = await createProduct('Tx Prod C', 0); // Out of stock!

    let orderCreated = false;
    let thrownError = null;

    try {
      await placeOrder({
        customer: {
          fullName: 'Multi Item User',
          phone: '0555222333',
          wilaya: { code: 16, name: 'Algiers' },
          deliveryMethod: DELIVERY_METHODS.HOME,
          address: 'Rue Multi'
        },
        items: [
          { productId: prodA._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 },
          { productId: prodB._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 },
          { productId: prodC._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }
        ],
        idempotencyKey: `multi-fail-tx-${Date.now()}`
      });
      orderCreated = true;
    } catch (err) {
      thrownError = err;
    }

    const stockA = await getStock(prodA._id, 'Noir', 'M');
    const stockB = await getStock(prodB._id, 'Noir', 'M');
    const stockC = await getStock(prodC._id, 'Noir', 'M');

    try {
      assert.strictEqual(orderCreated, false, 'Order must NOT be created');
      assert(thrownError !== null, 'Exception must be thrown');
      assert.strictEqual(stockA, 5, 'Item A stock must remain unchanged (5)');
      assert.strictEqual(stockB, 5, 'Item B stock must remain unchanged (5)');
      assert.strictEqual(stockC, 0, 'Item C stock must remain unchanged (0)');
      pass('Checkout Test C: Transaction aborted cleanly; Item A, B, C stock completely unchanged');
    } catch (e) {
      fail('Checkout Test C', e);
    }
  }

  // ── 4. ORDER + INVENTORY ATOMICITY (SIMULATED DB DISK FULL / SAVE FAILURE) ──
  console.log('\n── 4. Order + Inventory Atomicity: Database failure during Order.save() inside transaction ──');
  {
    const prod = await createProduct('Disk Full Tx Prod', 3);
    const originalSave = Order.prototype.save;

    Order.prototype.save = async function() {
      throw new Error('SIMULATED_DISK_WRITE_FAILURE');
    };

    let caughtErr = null;
    try {
      await placeOrder({
        customer: {
          fullName: 'Disk Full User',
          phone: '0555333444',
          wilaya: { code: 16, name: 'Algiers' },
          deliveryMethod: DELIVERY_METHODS.HOME,
          address: 'Rue Disk'
        },
        items: [{ productId: prod._id.toString(), colorName: 'Noir', size: 'M', quantity: 2 }],
        idempotencyKey: `disk-fail-tx-${Date.now()}`
      });
    } catch (err) {
      caughtErr = err;
    } finally {
      Order.prototype.save = originalSave;
    }

    const stockAfter = await getStock(prod._id, 'Noir', 'M');
    const ordersCount = await Order.countDocuments({ "customer.phone": '0555333444' });

    try {
      assert(caughtErr && caughtErr.message.includes('SIMULATED_DISK_WRITE_FAILURE'));
      assert.strictEqual(stockAfter, 3, 'Stock must remain 3 after transaction abort');
      assert.strictEqual(ordersCount, 0, 'Zero orders must exist in DB');
      pass('Atomicity: Transaction abort guarantees stock deduction is completely rolled back without order creation');
    } catch (e) {
      fail('Atomicity', e);
    }
  }

  // ── 5. DUPLICATE-KEY CONFLICT WITH DIFFERENT PAYLOAD (409 CONFLICT) ──
  console.log('\n── 5. Duplicate Idempotency Key with different payload (409 Conflict) ──');
  {
    const prod = await createProduct('Idem Conflict Prod', 5);
    const key = `conflict-key-tx-${Date.now()}`;

    const { order: o1 } = await placeOrder({
      customer: { fullName: 'Original Customer', phone: '0555999001', wilaya: { code: 16, name: 'Algiers' }, deliveryMethod: DELIVERY_METHODS.HOME, address: 'Rue 1' },
      items: [{ productId: prod._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }],
      idempotencyKey: key
    });

    let conflictCaught = false;
    try {
      await placeOrder({
        customer: { fullName: 'Altered Customer', phone: '0555999002', wilaya: { code: 16, name: 'Algiers' }, deliveryMethod: DELIVERY_METHODS.HOME, address: 'Rue 2' },
        items: [{ productId: prod._id.toString(), colorName: 'Noir', size: 'M', quantity: 2 }],
        idempotencyKey: key
      });
    } catch (err) {
      conflictCaught = err.message.includes('IDEMPOTENCY_CONFLICT');
    }

    const reloadedO1 = await Order.findById(o1._id);
    const finalStock = await getStock(prod._id, 'Noir', 'M');

    try {
      assert.strictEqual(conflictCaught, true, 'IDEMPOTENCY_CONFLICT must be thrown');
      assert.strictEqual(reloadedO1.customer.fullName, 'Original Customer', 'Original order must remain intact');
      assert.strictEqual(finalStock, 4, 'Stock must only reflect the original order deduction (-1)');
      pass('Idempotency Conflict: Reusing same key with different payload rejected with 409 and original order preserved');
    } catch (e) {
      fail('Idempotency Conflict', e);
    }
  }

  // ── 6. CLEAN RETRY AFTER ABORTED TRANSACTION ──
  console.log('\n── 6. Retry after aborted transaction ──');
  {
    const prod = await createProduct('Retry Tx Prod', 1);

    // First attempt: quantity 2 (fails on stock check)
    let firstFailed = false;
    try {
      await placeOrder({
        customer: { fullName: 'Retry Customer', phone: '0555888777', wilaya: { code: 16, name: 'Algiers' }, deliveryMethod: DELIVERY_METHODS.HOME, address: 'Rue Retry' },
        items: [{ productId: prod._id.toString(), colorName: 'Noir', size: 'M', quantity: 2 }],
        idempotencyKey: `retry-tx-1-${Date.now()}`
      });
    } catch {
      firstFailed = true;
    }

    assert.strictEqual(firstFailed, true);
    assert.strictEqual(await getStock(prod._id, 'Noir', 'M'), 1);

    // Second attempt: quantity 1 (succeeds)
    const { order: oSuccess } = await placeOrder({
      customer: { fullName: 'Retry Customer', phone: '0555888777', wilaya: { code: 16, name: 'Algiers' }, deliveryMethod: DELIVERY_METHODS.HOME, address: 'Rue Retry' },
      items: [{ productId: prod._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }],
      idempotencyKey: `retry-tx-2-${Date.now()}`
    });

    try {
      assert(oSuccess && oSuccess.orderCode);
      assert.strictEqual(await getStock(prod._id, 'Noir', 'M'), 0);
      pass('Retry: Clean retry after aborted transaction succeeded without leftover state');
    } catch (e) {
      fail('Retry', e);
    }
  }

  // ── 7. HTTP STATUS OVERRIDE TESTS ──
  console.log('\n── 7. HTTP Status Override Validation & Execution ──');
  {
    const prod = await createProduct('Override HTTP Prod', 2);
    const { order } = await placeOrder({
      customer: { fullName: 'Override Customer', phone: '0555666555', wilaya: { code: 16, name: 'Algiers' }, deliveryMethod: DELIVERY_METHODS.HOME, address: 'Rue Override' },
      items: [{ productId: prod._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }],
      idempotencyKey: `override-order-${Date.now()}`
    });

    // Override Test 1: { status: "Returned", override: true } without overrideReason -> Schema rejects with 400
    let t1Rejected = false;
    try {
      statusChangeSchema.parse({ status: 'Returned', override: true });
    } catch (e) {
      t1Rejected = true;
      assert(e.issues.some(i => i.path.includes('overrideReason')));
    }
    try {
      assert.strictEqual(t1Rejected, true, 'Override Test 1: override=true without overrideReason rejected by schema');
      pass('Override Test 1: Schema rejected override=true when overrideReason was omitted');
    } catch (e) {
      fail('Override Test 1', e);
    }

    // Override Test 2: { status: "Returned", override: true, overrideReason: "" } -> Schema rejects with 400
    let t2Rejected = false;
    try {
      statusChangeSchema.parse({ status: 'Returned', override: true, overrideReason: '   ' });
    } catch (e) {
      t2Rejected = true;
      assert(e.issues.some(i => i.path.includes('overrideReason')));
    }
    try {
      assert.strictEqual(t2Rejected, true, 'Override Test 2: override=true with empty overrideReason rejected by schema');
      pass('Override Test 2: Schema rejected override=true when overrideReason was empty string');
    } catch (e) {
      fail('Override Test 2', e);
    }

    // Override Test 3: { status: "Returned", override: true, overrideReason: "Courier returned package directly" }
    // Call through controller: changeOrderStatus
    const res3 = mockRes();
    await changeOrderStatus(
      {
        params: { id: order._id.toString() },
        body: {
          status: 'Returned',
          override: true,
          overrideReason: 'Courier returned package directly to warehouse'
        },
        admin: { username: 'SuperAdmin' }
      },
      res3,
      (err) => { if (err) throw err; }
    );

    try {
      assert.strictEqual(res3.statusCode, 200);
      assert.strictEqual(res3.body.order.status, 'Returned');
      assert.strictEqual(res3.body.order.stockRestored, true);
      const lastAudit = res3.body.order.auditHistory[res3.body.order.auditHistory.length - 1];
      assert.strictEqual(lastAudit.action, 'STATUS_OVERRIDE');
      assert.strictEqual(lastAudit.details.overrideReason, 'Courier returned package directly to warehouse');
      assert.strictEqual(lastAudit.performedBy, 'SuperAdmin');
      pass('Override Test 3: Controller executed override and auditHistory recorded overrideReason and admin');
    } catch (e) {
      fail('Override Test 3', e);
    }

    // Override Test 4: Delivered remains permanently terminal even with override=true
    // First advance an order to Delivered
    const prodDeliv = await createProduct('Delivered Terminal Prod', 2);
    const { order: orderDeliv } = await placeOrder({
      customer: { fullName: 'Delivered Cust', phone: '0555444333', wilaya: { code: 16, name: 'Algiers' }, deliveryMethod: DELIVERY_METHODS.HOME, address: 'Rue Deliv' },
      items: [{ productId: prodDeliv._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }],
      idempotencyKey: `deliv-order-${Date.now()}`
    });
    await updateOrderStatus(orderDeliv._id.toString(), ORDER_STATUS.CONFIRMED);
    await updateOrderStatus(orderDeliv._id.toString(), ORDER_STATUS.ON_THE_WAY);
    await updateOrderStatus(orderDeliv._id.toString(), ORDER_STATUS.DELIVERED);

    // Now attempt transition from Delivered with override=true
    const res4 = mockRes();
    await changeOrderStatus(
      {
        params: { id: orderDeliv._id.toString() },
        body: {
          status: 'Returned',
          override: true,
          overrideReason: 'Attempt to force reopen delivered order'
        },
        admin: { username: 'SuperAdmin' }
      },
      res4,
      () => {}
    );

    const reloadedDeliv = await Order.findById(orderDeliv._id);

    try {
      assert.strictEqual(res4.statusCode, 400, 'Controller must return 400 on terminal violation');
      assert(res4.body?.message?.includes('Terminal state violation'), 'Error message must specify terminal violation');
      assert.strictEqual(reloadedDeliv.status, ORDER_STATUS.DELIVERED, 'Order must remain Delivered');
      pass('Override Test 4: Delivered order remains permanently terminal even with override=true (HTTP 400)');
    } catch (e) {
      fail('Override Test 4', e);
    }
  }

  // ── 8. VARIANT PROTECTION & INVENTORY BOUNDARY ──
  console.log('\n── 8. Variant Protection Against Destructive Updates & Inventory Boundary ──');
  {
    const prod = await createProduct('Protected Variant Prod', 5);
    const { order: activeOrder } = await placeOrder({
      customer: { fullName: 'Active Order User', phone: '0555777111', wilaya: { code: 16, name: 'Algiers' }, deliveryMethod: DELIVERY_METHODS.HOME, address: 'Rue Active' },
      items: [{ productId: prod._id.toString(), colorName: 'Noir', size: 'M', quantity: 1 }],
      idempotencyKey: `active-variant-${Date.now()}`
    });

    // Attempt to update product by removing variant 'Noir / M' (passing empty sizes)
    const resRemove = mockRes();
    await updateProduct(
      {
        params: { id: prod._id.toString() },
        body: {
          colors: [
            {
              colorName: 'Noir',
              colorCode: '#000000',
              images: ['/test.jpg'],
              sizes: [{ size: 'L', stock: 10 }] // 'M' removed!
            }
          ]
        }
      },
      resRemove,
      () => {}
    );

    try {
      assert.strictEqual(resRemove.statusCode, 409, 'Removing variant with active orders must return 409 Conflict');
      assert(resRemove.body.message.includes('Cannot remove variant'));
      pass('Variant Protection: Destructive variant removal rejected with 409 when active orders exist');
    } catch (e) {
      fail('Variant Protection', e);
    }

    // Attempt to delete product with active order
    const resDelete = mockRes();
    await archiveProduct(
      { params: { id: prod._id.toString() } },
      resDelete,
      () => {}
    );

    try {
      assert.strictEqual(resDelete.statusCode, 409, 'Deleting product with active orders must return 409 Conflict');
      assert(resDelete.body.message.includes('Cannot delete product'));
      pass('Product Protection: Deleting product rejected with 409 when active orders exist');
    } catch (e) {
      fail('Product Protection', e);
    }

    // Verify stock CANNOT be modified via updateProduct
    const initialStock = await getStock(prod._id, 'Noir', 'M');
    const resStockAttempt = mockRes();
    await updateProduct(
      {
        params: { id: prod._id.toString() },
        body: {
          name: 'Protected Variant Prod Renamed',
          colors: [
            {
              colorName: 'Noir',
              colorCode: '#000000',
              images: ['/test.jpg'],
              sizes: [{ size: 'M', stock: 9999 }] // Attempt to force 9999 stock!
            }
          ]
        }
      },
      resStockAttempt,
      () => {}
    );

    const stockAfterUpdate = await getStock(prod._id, 'Noir', 'M');

    try {
      assert.strictEqual(resStockAttempt.statusCode, 200);
      assert.strictEqual(stockAfterUpdate, initialStock, `Stock must remain ${initialStock}, was not overwritten by 9999`);
      pass('Inventory Boundary: Product edit endpoint preserved authoritative database stock and ignored client stock overwrite');
    } catch (e) {
      fail('Inventory Boundary', e);
    }
  }

  await mongoose.disconnect();

  console.log('\n================================================================');
  console.log(`CHECKOUT TRANSACTION RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runCheckoutTransactionTests().catch(err => {
  console.error('Fatal test suite error:', err);
  process.exit(1);
});
