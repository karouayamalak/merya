/**
 * lifecycleTest.js
 *
 * Full Lifecycle Inventory Tests for MERYA DZ.
 *
 * Flow 1 (Successful Delivery):
 *   Initial stock = 1
 *   Place order: stock = 0
 *   Pending → Confirmed: stock = 0
 *   Confirmed → On the way: stock = 0
 *   On the way → At Agency: stock = 0
 *   At Agency → Delivered: stock = 0
 *
 * Flow 2 (Return and Reactivation):
 *   Initial stock = 1
 *   Place order: stock = 0
 *   Pending → Confirmed: stock = 0
 *   Confirmed → On the way: stock = 0
 *   On the way → At Agency: stock = 0
 *   At Agency → Returned: stock = 1 (restored once)
 *   Returned → Confirmed: stock = 0 (re-deducted once)
 *
 * Invariant: No transition deducts or restores stock more than once.
 */

import assert from 'node:assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { Order } from '../src/models/Order.js';
import { placeOrder, updateOrderStatus } from '../src/services/orderService.js';
import { DeliverySetting } from '../src/models/DeliverySetting.js';
import { ORDER_STATUS, ALGERIA_WILAYAS, DELIVERY_METHODS } from '../src/config/constants.js';

dotenv.config();

const DB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/merya_dz';

async function getStock(productId, colorName, size) {
  const p = await Product.findById(productId);
  return p.colors.find(c => c.colorName === colorName)?.sizes.find(s => s.size === size)?.stock ?? -1;
}

async function runLifecycleTests() {
  console.log('================================================================');
  console.log('  ORDER LIFECYCLE INVENTORY AUDIT TEST SUITE');
  console.log('================================================================\n');

  await mongoose.connect(DB_URI);
  console.log('Connected to MongoDB.');

  // Ensure DeliverySetting exists with all 58 rates
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
      ds = await DeliverySetting.create({ singletonKey: 'default', freeDeliveryThreshold: 0, wilayaRates: rates });
    } else {
      ds.wilayaRates = rates;
      await ds.save();
    }
  }

  let testCategory = await Category.findOne({ slug: 'test-category-lifecycle' });
  if (!testCategory) {
    testCategory = await Category.create({
      name: 'Test Category Lifecycle',
      slug: 'test-category-lifecycle',
      description: 'Category for lifecycle testing',
      image: '/test.jpg'
    });
  }

  let passCount = 0;
  let failCount = 0;

  // ── FLOW 1: Full Delivery Lifecycle (stock starts at 1, deducted on order, remains 0 through Delivered) ──
  {
    console.log('── FLOW 1: Standard Lifecycle (Place → Confirmed → On the way → At Agency → Delivered) ──');
    const testProduct = await Product.create({
      name: 'Lifecycle Abaya 1',
      slug: `lifecycle-abaya-1-${Date.now()}`,
      description: 'Test product for lifecycle delivery flow',
      category: testCategory._id,
      sellingPrice: 5000,
      costPrice: 2500,
      isActive: true,
      colors: [{
        colorName: 'Royal Black',
        colorCode: '#000000',
        images: ['/test.jpg'],
        sizes: [{ size: 'M', stock: 1 }]
      }]
    });

    const productId = testProduct._id;
    const colorName = 'Royal Black';
    const size = 'M';

    try {
      // Step 0: Initial stock = 1
      let stock = await getStock(productId, colorName, size);
      assert.strictEqual(stock, 1, 'Initial product stock must be 1');
      console.log('   Step 0: Initial product stock = 1 [OK]');

      // Step 1: Place order
      const { order } = await placeOrder({
        customer: {
          fullName: 'Fatima Zohra',
          phone: '0555123456',
          wilaya: { code: 16, name: 'Algiers' },
          deliveryMethod: DELIVERY_METHODS.AGENCY,
          agencyName: 'Yalidine Kouba'
        },
        items: [{
          productId: productId.toString(),
          colorName,
          size,
          quantity: 1
        }],
        idempotencyKey: `lifecycle-flow1-${Date.now()}`
      });

      assert.strictEqual(order.status, 'Pending', 'Initial order status must be Pending');
      assert.strictEqual(order.stockRestored, false, 'stockRestored must be false');
      stock = await getStock(productId, colorName, size);
      assert.strictEqual(stock, 0, 'Stock must be deducted to 0 upon order placement');
      console.log('   Step 1: Place order → status = Pending, stock = 0 [OK]');

      // Step 2: Pending → Confirmed
      const o1 = await updateOrderStatus(order._id.toString(), ORDER_STATUS.CONFIRMED, 'Admin', 'Order confirmed with customer');
      assert.strictEqual(o1.status, ORDER_STATUS.CONFIRMED);
      assert.strictEqual(o1.stockRestored, false);
      stock = await getStock(productId, colorName, size);
      assert.strictEqual(stock, 0, 'Pending → Confirmed must not alter stock (remains 0)');
      console.log('   Step 2: Pending → Confirmed → status = Confirmed, stock = 0 [OK]');

      // Step 3: Confirmed → On the way
      const o2 = await updateOrderStatus(order._id.toString(), ORDER_STATUS.ON_THE_WAY, 'Admin', 'Dispatched with courier');
      assert.strictEqual(o2.status, ORDER_STATUS.ON_THE_WAY);
      assert.strictEqual(o2.stockRestored, false);
      stock = await getStock(productId, colorName, size);
      assert.strictEqual(stock, 0, 'Confirmed → On the way must not alter stock (remains 0)');
      console.log('   Step 3: Confirmed → On the way → status = On the way, stock = 0 [OK]');

      // Step 4: On the way → At agency
      const o3 = await updateOrderStatus(order._id.toString(), ORDER_STATUS.AT_AGENCY, 'Admin', 'Package arrived at Yalidine desk');
      assert.strictEqual(o3.status, ORDER_STATUS.AT_AGENCY);
      assert.strictEqual(o3.stockRestored, false, 'CRITICAL: At agency is NOT Delivered, stockRestored must stay false');
      stock = await getStock(productId, colorName, size);
      assert.strictEqual(stock, 0, 'At agency must NOT restore stock (remains 0)');
      console.log('   Step 4: On the way → At agency → status = At agency, stock = 0 [OK]');

      // Step 5: At agency → Delivered
      const o4 = await updateOrderStatus(order._id.toString(), ORDER_STATUS.DELIVERED, 'Admin', 'Customer collected parcel');
      assert.strictEqual(o4.status, ORDER_STATUS.DELIVERED);
      assert.strictEqual(o4.stockRestored, false);
      stock = await getStock(productId, colorName, size);
      assert.strictEqual(stock, 0, 'Delivered must not restore stock (remains 0)');
      console.log('   Step 5: At agency → Delivered → status = Delivered, stock = 0 [OK]');

      console.log('   ✅ FLOW 1 PASSED: Delivery lifecycle maintained exact stock=0 invariant throughout!\n');
      passCount++;

      await Order.deleteOne({ _id: order._id });
    } catch (e) {
      console.error(`   ❌ FLOW 1 FAILED: ${e.message}\n`);
      failCount++;
    } finally {
      await Product.deleteOne({ _id: productId });
    }
  }

  // ── FLOW 2: Return and Reactivation Lifecycle ─────────────────────────────
  {
    console.log('── FLOW 2: Return Lifecycle (Place → Confirmed → On the way → At Agency → Returned → Confirmed) ──');
    const testProduct = await Product.create({
      name: 'Lifecycle Abaya 2',
      slug: `lifecycle-abaya-2-${Date.now()}`,
      description: 'Test product for lifecycle return and reactivation flow',
      category: testCategory._id,
      sellingPrice: 5000,
      costPrice: 2500,
      isActive: true,
      colors: [{
        colorName: 'Sage Green',
        colorCode: '#008800',
        images: ['/test2.jpg'],
        sizes: [{ size: 'M', stock: 1 }]
      }]
    });

    const productId = testProduct._id;
    const colorName = 'Sage Green';
    const size = 'M';

    try {
      // Step 0: Initial stock = 1
      let stock = await getStock(productId, colorName, size);
      assert.strictEqual(stock, 1, 'Initial product stock must be 1');
      console.log('   Step 0: Initial product stock = 1 [OK]');

      // Step 1: Place order
      const { order } = await placeOrder({
        customer: {
          fullName: 'Amina Benali',
          phone: '0555654321',
          wilaya: { code: 16, name: 'Algiers' },
          deliveryMethod: DELIVERY_METHODS.AGENCY,
          agencyName: 'Yalidine Kouba'
        },
        items: [{
          productId: productId.toString(),
          colorName,
          size,
          quantity: 1
        }],
        idempotencyKey: `lifecycle-flow2-${Date.now()}`
      });

      assert.strictEqual(order.status, 'Pending');
      stock = await getStock(productId, colorName, size);
      assert.strictEqual(stock, 0, 'Stock deducted to 0 upon order placement');
      console.log('   Step 1: Place order → status = Pending, stock = 0 [OK]');

      // Step 2: Pending → Confirmed
      await updateOrderStatus(order._id.toString(), ORDER_STATUS.CONFIRMED, 'Admin');
      stock = await getStock(productId, colorName, size);
      assert.strictEqual(stock, 0);
      console.log('   Step 2: Pending → Confirmed → stock = 0 [OK]');

      // Step 3: Confirmed → On the way
      await updateOrderStatus(order._id.toString(), ORDER_STATUS.ON_THE_WAY, 'Admin');
      stock = await getStock(productId, colorName, size);
      assert.strictEqual(stock, 0);
      console.log('   Step 3: Confirmed → On the way → stock = 0 [OK]');

      // Step 4: On the way → At agency
      await updateOrderStatus(order._id.toString(), ORDER_STATUS.AT_AGENCY, 'Admin');
      stock = await getStock(productId, colorName, size);
      assert.strictEqual(stock, 0, 'At agency must not restore stock');
      console.log('   Step 4: On the way → At agency → stock = 0 [OK]');

      // Step 5: At agency → Returned (Customer failed to pick up, parcel sent back to owner)
      const oReturned = await updateOrderStatus(order._id.toString(), ORDER_STATUS.RETURNED, 'Admin', 'Customer never picked up');
      assert.strictEqual(oReturned.status, ORDER_STATUS.RETURNED);
      assert.strictEqual(oReturned.stockRestored, true, 'stockRestored must be true upon Returned');
      stock = await getStock(productId, colorName, size);
      assert.strictEqual(stock, 1, 'Stock must be restored to 1 upon Returned');
      console.log('   Step 5: At agency → Returned → status = Returned, stock = 1, stockRestored = true [OK]');

      // Step 6: Returned → Confirmed (Customer contacted us, wants order re-shipped!)
      const oReconfirmed = await updateOrderStatus(order._id.toString(), ORDER_STATUS.CONFIRMED, 'Admin', 'Customer requested re-dispatch');
      assert.strictEqual(oReconfirmed.status, ORDER_STATUS.CONFIRMED);
      assert.strictEqual(oReconfirmed.stockRestored, false, 'stockRestored must be flipped to false upon reactivation');
      stock = await getStock(productId, colorName, size);
      assert.strictEqual(stock, 0, 'Stock must be re-deducted to 0 upon Confirmed');
      console.log('   Step 6: Returned → Confirmed → status = Confirmed, stock = 0, stockRestored = false [OK]');

      console.log('   ✅ FLOW 2 PASSED: Return and reactivation correctly handled inventory with zero duplicates!\n');
      passCount++;

      await Order.deleteOne({ _id: order._id });
    } catch (e) {
      console.error(`   ❌ FLOW 2 FAILED: ${e.message}\n`);
      failCount++;
    } finally {
      await Product.deleteOne({ _id: productId });
    }
  }

  // ── FLOW 3: 3-product lifecycle (full round-trip with multi-item order) ──
  {
    console.log('── FLOW 3: 3-Product Full Lifecycle (A=1, B=1, C=1 → order → At Agency → Returned → Confirmed → Delivered) ──');
    const makeProduct = async (suffix, stock) => Product.create({
      name: `Lifecycle Multi ${suffix}`,
      slug: `lifecycle-multi-${suffix}-${Date.now()}`,
      description: 'Multi-item lifecycle test product',
      category: testCategory._id,
      sellingPrice: 3000,
      costPrice: 1500,
      isActive: true,
      colors: [{
        colorName: 'Navy',
        colorCode: '#001f3f',
        images: [],
        sizes: [{ size: 'L', stock }]
      }]
    });

    const pA = await makeProduct('A', 1);
    const pB = await makeProduct('B', 1);
    const pC = await makeProduct('C', 1);

    try {
      // Step 0: A=1, B=1, C=1
      assert.strictEqual(await getStock(pA._id, 'Navy', 'L'), 1, '3-product: Initial A=1');
      assert.strictEqual(await getStock(pB._id, 'Navy', 'L'), 1, '3-product: Initial B=1');
      assert.strictEqual(await getStock(pC._id, 'Navy', 'L'), 1, '3-product: Initial C=1');
      console.log('   Step 0: A=1, B=1, C=1 [OK]');

      // Step 1: Place order → A=0, B=0, C=0
      const { order } = await placeOrder({
        customer: {
          fullName: 'Amina Bouhali',
          phone: '0561234567',
          wilaya: { code: 16, name: 'Algiers' },
          deliveryMethod: DELIVERY_METHODS.AGENCY,
          agencyName: 'Test Agency Multi'
        },
        items: [
          { productId: pA._id, colorName: 'Navy', size: 'L', quantity: 1 },
          { productId: pB._id, colorName: 'Navy', size: 'L', quantity: 1 },
          { productId: pC._id, colorName: 'Navy', size: 'L', quantity: 1 }
        ],
        idempotencyKey: `lifecycle-multi-${Date.now()}`
      });
      assert.strictEqual(await getStock(pA._id, 'Navy', 'L'), 0, '3-product: After order A=0');
      assert.strictEqual(await getStock(pB._id, 'Navy', 'L'), 0, '3-product: After order B=0');
      assert.strictEqual(await getStock(pC._id, 'Navy', 'L'), 0, '3-product: After order C=0');
      console.log('   Step 1: Order placed → A=0, B=0, C=0 [OK]');

      // Step 2: Pending → Confirmed (no stock change)
      let o = await updateOrderStatus(order._id, ORDER_STATUS.CONFIRMED, 'Admin');
      assert.strictEqual(o.status, ORDER_STATUS.CONFIRMED);
      assert.strictEqual(await getStock(pA._id, 'Navy', 'L'), 0, '3-product: Confirmed A=0');
      assert.strictEqual(await getStock(pB._id, 'Navy', 'L'), 0, '3-product: Confirmed B=0');
      assert.strictEqual(await getStock(pC._id, 'Navy', 'L'), 0, '3-product: Confirmed C=0');
      console.log('   Step 2: Confirmed → A=0, B=0, C=0 [OK]');

      // Step 3: Confirmed → On the way
      o = await updateOrderStatus(order._id, ORDER_STATUS.ON_THE_WAY, 'Admin');
      assert.strictEqual(o.status, ORDER_STATUS.ON_THE_WAY);
      console.log('   Step 3: On the way → A=0, B=0, C=0 [OK]');

      // Step 4: On the way → At Agency (NO stock restore — not delivered yet)
      o = await updateOrderStatus(order._id, ORDER_STATUS.AT_AGENCY, 'Admin');
      assert.strictEqual(o.status, ORDER_STATUS.AT_AGENCY);
      assert.strictEqual(o.stockRestored, false, '3-product: At Agency stockRestored=false');
      assert.strictEqual(await getStock(pA._id, 'Navy', 'L'), 0, '3-product: At Agency A=0');
      assert.strictEqual(await getStock(pB._id, 'Navy', 'L'), 0, '3-product: At Agency B=0');
      assert.strictEqual(await getStock(pC._id, 'Navy', 'L'), 0, '3-product: At Agency C=0');
      console.log('   Step 4: At Agency → A=0, B=0, C=0, stockRestored=false [OK]');

      // Step 5: At Agency → Returned (stock RESTORED → A=1, B=1, C=1)
      o = await updateOrderStatus(order._id, ORDER_STATUS.RETURNED, 'Admin');
      assert.strictEqual(o.status, ORDER_STATUS.RETURNED);
      assert.strictEqual(o.stockRestored, true, '3-product: Returned stockRestored=true');
      assert.strictEqual(await getStock(pA._id, 'Navy', 'L'), 1, '3-product: Returned A=1');
      assert.strictEqual(await getStock(pB._id, 'Navy', 'L'), 1, '3-product: Returned B=1');
      assert.strictEqual(await getStock(pC._id, 'Navy', 'L'), 1, '3-product: Returned C=1');
      console.log('   Step 5: Returned → A=1, B=1, C=1, stockRestored=true [OK]');

      // Step 6: Returned → Confirmed (REACTIVATED — stock DEDUCTED → A=0, B=0, C=0)
      o = await updateOrderStatus(order._id, ORDER_STATUS.CONFIRMED, 'Admin');
      assert.strictEqual(o.status, ORDER_STATUS.CONFIRMED);
      assert.strictEqual(o.stockRestored, false, '3-product: Reactivated stockRestored=false');
      assert.strictEqual(await getStock(pA._id, 'Navy', 'L'), 0, '3-product: Reactivated A=0');
      assert.strictEqual(await getStock(pB._id, 'Navy', 'L'), 0, '3-product: Reactivated B=0');
      assert.strictEqual(await getStock(pC._id, 'Navy', 'L'), 0, '3-product: Reactivated C=0');
      console.log('   Step 6: Reactivated → A=0, B=0, C=0, stockRestored=false [OK]');

      // Step 7: Confirmed → On the way → At Agency → Delivered
      o = await updateOrderStatus(order._id, ORDER_STATUS.ON_THE_WAY, 'Admin');
      o = await updateOrderStatus(order._id, ORDER_STATUS.AT_AGENCY, 'Admin');
      o = await updateOrderStatus(order._id, ORDER_STATUS.DELIVERED, 'Admin');
      assert.strictEqual(o.status, ORDER_STATUS.DELIVERED);
      assert.strictEqual(o.stockRestored, false, '3-product: Delivered stockRestored=false');
      assert.strictEqual(await getStock(pA._id, 'Navy', 'L'), 0, '3-product: Delivered A=0 (sold)');
      assert.strictEqual(await getStock(pB._id, 'Navy', 'L'), 0, '3-product: Delivered B=0 (sold)');
      assert.strictEqual(await getStock(pC._id, 'Navy', 'L'), 0, '3-product: Delivered C=0 (sold)');
      console.log('   Step 7: Delivered → A=0, B=0, C=0 [OK]');

      // Step 8: Delivered is terminal — even override must fail
      let blocked = false;
      try {
        await updateOrderStatus(order._id, ORDER_STATUS.CONFIRMED, 'Admin', '', true, 'trying to reopen');
      } catch (e) {
        blocked = true;
      }
      assert.ok(blocked, '3-product: Delivered → anything is blocked');
      console.log('   Step 8: Delivered terminal guard works [OK]');

      console.log('   ✅ FLOW 3 PASSED: 3-product lifecycle correct at every step!\n');
      passCount++;

      await Order.deleteOne({ _id: order._id });
    } catch (e) {
      console.error(`   ❌ FLOW 3 FAILED: ${e.message}\n`);
      failCount++;
    } finally {
      await Product.deleteMany({ _id: { $in: [pA._id, pB._id, pC._id] } });
    }
  }

  await Category.deleteOne({ _id: testCategory._id });
  await mongoose.disconnect();

  console.log('================================================================');
  console.log(`  LIFECYCLE RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runLifecycleTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
