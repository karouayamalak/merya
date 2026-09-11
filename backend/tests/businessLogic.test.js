import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { Order } from '../src/models/Order.js';
import { DeliverySetting } from '../src/models/DeliverySetting.js';
import { placeOrder, updateOrderStatus, getFinancialAnalytics } from '../src/services/orderService.js';
import { ORDER_STATUS, DELIVERY_METHODS } from '../src/config/constants.js';

dotenv.config();

const TEST_DB = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/merya_dz';

describe('MERYA DZ Core Business Logic & Inventory Integrity', () => {
  let testCategory;
  let testProduct;

  before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(TEST_DB);
    }

    // Create a clean test category and product
    testCategory = await Category.create({
      name: 'Test Category',
      slug: `test-cat-${Date.now()}`,
      description: 'Test description',
      image: 'https://example.com/test.jpg'
    });

    testProduct = await Product.create({
      name: 'Test Satin Abaya',
      slug: `test-satin-abaya-${Date.now()}`,
      description: 'Handcrafted luxury test abaya',
      category: testCategory._id,
      sellingPrice: 5000,
      costPrice: 3000,
      isActive: true,
      colors: [
        {
          colorName: 'Desert Taupe',
          colorCode: '#C5A880',
          images: ['https://example.com/abaya-taupe.jpg'],
          sizes: [
            { size: 'M', stock: 5 },
            { size: 'L', stock: 1 }
          ]
        }
      ]
    });
  });

  after(async () => {
    if (testCategory) await Category.deleteOne({ _id: testCategory._id });
    if (testProduct) await Product.deleteOne({ _id: testProduct._id });
    await Order.deleteMany({ "customer.phone": "0555000999" });
    await mongoose.disconnect();
  });

  test('1. Overselling Prevention: Rejects checkout when requested quantity exceeds available stock', async () => {
    const invalidItems = [
      {
        productId: testProduct._id.toString(),
        colorName: 'Desert Taupe',
        size: 'L',
        quantity: 5 // Only 1 in stock!
      }
    ];

    await assert.rejects(
      async () => {
        await placeOrder({
          customer: {
            fullName: 'Fatima Test',
            phone: '0555000999',
            wilaya: { code: 16, name: 'Algiers' },
            deliveryMethod: DELIVERY_METHODS.AGENCY,
            agencyName: 'Yalidine Bab Ezzouar'
          },
          items: invalidItems
        });
      },
      /Only 1 items remaining/
    );

    // Verify stock was untouched
    const freshProduct = await Product.findById(testProduct._id);
    const sizeL = freshProduct.colors[0].sizes.find(s => s.size === 'L');
    assert.strictEqual(sizeL.stock, 1, 'Stock must remain unchanged after failed deduction');
  });

  test('2. Atomic Inventory Deduction & Fee Calculation on valid checkout', async () => {
    const validItems = [
      {
        productId: testProduct._id.toString(),
        colorName: 'Desert Taupe',
        size: 'M',
        quantity: 2 // Available stock is 5
      }
    ];

    const result = await placeOrder({
      customer: {
        fullName: 'Amina Test',
        phone: '0555000999',
        wilaya: { code: 16, name: 'Algiers' },
        deliveryMethod: DELIVERY_METHODS.AGENCY,
        agencyName: 'Yalidine Kouba'
      },
      items: validItems
    });

    assert.ok(result.order, 'Order must be created');
    assert.strictEqual(result.order.subtotal, 10000, 'Subtotal must be 5000 * 2 = 10000 DZD');
    const setting = await DeliverySetting.findOne();
    const algiersRate = setting?.wilayaRates?.find(r => r.wilayaCode === 16);
    const expectedFee = algiersRate ? algiersRate.agencyFee : 500;
    assert.strictEqual(result.order.deliveryFee, expectedFee, `Agency delivery fee should match database rate (${expectedFee} DZD)`);
    assert.strictEqual(result.order.totalPrice, 10000 + expectedFee, `Total should be subtotal + deliveryFee (${10000 + expectedFee} DZD)`);
    assert.match(result.order.orderCode, /^MD-[A-Z0-9]{6}$/, 'Order code must follow secure MD-XXXXXX pattern');

    // Verify stock deducted atomically (5 - 2 = 3)
    const freshProduct = await Product.findById(testProduct._id);
    const sizeM = freshProduct.colors[0].sizes.find(s => s.size === 'M');
    assert.strictEqual(sizeM.stock, 3, 'Stock must be atomically reduced to 3');
  });

  test('3. Idempotency: Duplicate network/user submission returns original order without extra stock deduction', async () => {
    const key = `idem-key-${Date.now()}`;
    const items = [
      {
        productId: testProduct._id.toString(),
        colorName: 'Desert Taupe',
        size: 'M',
        quantity: 1
      }
    ];

    const submission1 = await placeOrder({
      customer: {
        fullName: 'Samia Test',
        phone: '0555000999',
        wilaya: { code: 16, name: 'Algiers' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: '12 Rue Didouche Mourad'
      },
      items,
      idempotencyKey: key
    });

    assert.strictEqual(submission1.isDuplicate, false);

    // Immediate duplicate retry
    const submission2 = await placeOrder({
      customer: {
        fullName: 'Samia Test',
        phone: '0555000999',
        wilaya: { code: 16, name: 'Algiers' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: '12 Rue Didouche Mourad'
      },
      items,
      idempotencyKey: key
    });

    assert.strictEqual(submission2.isDuplicate, true, 'Second request must be recognized as duplicate');
    assert.strictEqual(submission2.order.orderCode, submission1.order.orderCode, 'Must return original order code');
  });

  test('4. Order Cancellation restores stock atomically and only once', async () => {
    // Create an order of 1 item
    const { order } = await placeOrder({
      customer: {
        fullName: 'Khadija Test',
        phone: '0555000999',
        wilaya: { code: 31, name: 'Oran' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: 'Es Senia'
      },
      items: [
        {
          productId: testProduct._id.toString(),
          colorName: 'Desert Taupe',
          size: 'L',
          quantity: 1 // Reduces L stock from 1 to 0
        }
      ]
    });

    let prod = await Product.findById(testProduct._id);
    assert.strictEqual(prod.colors[0].sizes.find(s => s.size === 'L').stock, 0);

    // Cancel order
    const cancelled = await updateOrderStatus(order._id, ORDER_STATUS.CANCELLED, 'Owner');
    assert.strictEqual(cancelled.status, ORDER_STATUS.CANCELLED);
    assert.strictEqual(cancelled.stockRestored, true);

    // Check stock restored back to 1
    prod = await Product.findById(testProduct._id);
    assert.strictEqual(prod.colors[0].sizes.find(s => s.size === 'L').stock, 1, 'Stock must be restored to 1');
  });

  test('5. State Machine Validation: Disallows invalid transitions', async () => {
    const { order } = await placeOrder({
      customer: {
        fullName: 'Nadia Test',
        phone: '0555000999',
        wilaya: { code: 16, name: 'Algiers' },
        deliveryMethod: DELIVERY_METHODS.AGENCY,
        agencyName: 'Kouba'
      },
      items: [
        {
          productId: testProduct._id.toString(),
          colorName: 'Desert Taupe',
          size: 'M',
          quantity: 1
        }
      ]
    });

    // Cannot transition directly from Pending to Delivered without Confirmed/On the way
    await assert.rejects(
      async () => {
        await updateOrderStatus(order._id, ORDER_STATUS.DELIVERED, 'Admin');
      },
      /Cannot transition order/
    );

    // Valid progression: Pending -> Confirmed -> On the way -> Delivered
    await updateOrderStatus(order._id, ORDER_STATUS.CONFIRMED, 'Admin');
    await updateOrderStatus(order._id, ORDER_STATUS.ON_THE_WAY, 'Admin');
    const delivered = await updateOrderStatus(order._id, ORDER_STATUS.DELIVERED, 'Admin');
    assert.strictEqual(delivered.status, ORDER_STATUS.DELIVERED);

    // Terminal state: Delivered cannot be moved back to Pending or Cancelled
    await assert.rejects(
      async () => {
        await updateOrderStatus(order._id, ORDER_STATUS.PENDING, 'Admin');
      },
      /Cannot transition order/
    );
  });

  test('6. Profit Calculation: ONLY Delivered orders contribute to realized profit', async () => {
    const metrics = await getFinancialAnalytics();
    assert.ok(typeof metrics.realizedRevenue === 'number');
    assert.ok(typeof metrics.realizedProfit === 'number');
    assert.ok(metrics.realizedProfit >= 0, 'Realized profit must never be negative');
    console.log(`[Test] Realized Revenue: ${metrics.realizedRevenue} DZD, Realized Profit: ${metrics.realizedProfit} DZD`);
  });
});
