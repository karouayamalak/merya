import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { connectDB } from '../src/config/db.js';
import { resetTransactionSupportCache } from '../src/utils/transactionRetry.js';
import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { Order } from '../src/models/Order.js';
import { DeliverySetting } from '../src/models/DeliverySetting.js';
import { placeOrder, updateOrderItemsService } from '../src/services/orderService.js';
import { updateProduct } from '../src/controllers/productController.js';
import { DELIVERY_METHODS } from '../src/config/constants.js';

dotenv.config();

describe('MERYA DZ Production 10/10 Hardening Regression Suite', () => {
  let testCat;
  let testProd;

  before(async () => {
    await connectDB();
    resetTransactionSupportCache();

    testCat = await Category.create({
      name: { fr: 'Ten Cat FR', ar: 'قسم تجريبي', en: 'Ten Cat EN' },
      slug: `ten-cat-${Date.now()}`,
      image: '/categories/test-cat.jpg',
      isActive: true
    });

    await DeliverySetting.getSingleton();
  });

  after(async () => {
    if (testCat) await Category.findByIdAndDelete(testCat._id);
    if (testProd) await Product.findByIdAndDelete(testProd._id);
    await mongoose.disconnect();
  });

  // 1. Stale Product Document Update Race Protection
  test('1. Stock=5; Customer buys 1 (Stock=4); Admin saves old product document; Stock MUST remain 4', async () => {
    // Create product with stock = 5
    const prod = await Product.create({
      name: { fr: 'Robe Concurrency', ar: 'فستان تزامن', en: 'Concurrency Dress' },
      slug: `robe-concurrency-${Date.now()}`,
      description: { fr: 'Description FR', ar: 'وصف عربي', en: 'Description EN' },
      category: testCat._id,
      sellingPrice: 5000,
      costPrice: 2500,
      isActive: true,
      colors: [
        {
          colorName: 'Bleu Ciel',
          colorCode: '#87CEEB',
          images: ['/products/merya_dress_blue_1.jpg'],
          sizes: [
            { size: 'M', stock: 5 }
          ]
        }
      ]
    });
    testProd = prod;

    // Verify initial stock = 5
    assert.strictEqual(prod.colors[0].sizes[0].stock, 5);

    // Customer buys 1 via placeOrder
    const { order } = await placeOrder({
      customer: {
        fullName: 'Customer Race Tester',
        phone: '0555112233',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: '123 Test Street'
      },
      items: [
        { productId: prod._id.toString(), colorName: 'Bleu Ciel', size: 'M', quantity: 1 }
      ],
      idempotencyKey: `race-check-${Date.now()}`
    });
    assert.ok(order);

    // Stock in DB is now 4
    const prodAfterBuy = await Product.findById(prod._id);
    assert.strictEqual(prodAfterBuy.colors[0].sizes[0].stock, 4, 'Stock must be 4 after customer purchase');

    // Admin saves product with old in-memory document (which had stock = 5)
    // and sends updated description or price
    const mockReq = {
      params: { id: prod._id.toString() },
      body: {
        description: { fr: 'Updated Description FR', ar: 'وصف محدث', en: 'Updated Description EN' },
        colors: [
          {
            colorName: 'Bleu Ciel',
            colorCode: '#87CEEB',
            images: ['/products/merya_dress_blue_1.jpg'],
            sizes: [
              { size: 'M', stock: 5 } // Admin form had stale stock = 5
            ]
          }
        ]
      }
    };

    let responseData = null;
    const mockRes = {
      status(code) { this.statusCode = code; return this; },
      json(data) { responseData = data; return this; }
    };

    await updateProduct(mockReq, mockRes, (err) => { if (err) throw err; });

    assert.strictEqual(responseData?.success, true);

    // CRITICAL INVARIANT: The stock in DB must NEVER be restored to 5; it MUST REMAIN 4!
    const finalProd = await Product.findById(prod._id);
    assert.strictEqual(
      finalProd.colors[0].sizes[0].stock,
      4,
      'Admin stale save must NEVER overwrite customer deduction: Stock MUST remain 4!'
    );

    // Cleanup order
    await Order.findByIdAndDelete(order._id);
  });

  // 2. Multilingual: Single-request translation + activation
  test('2. Single request with complete name, description, and isActive=true activates draft product successfully', async () => {
    // Create draft product without full translations
    const draftProd = await Product.create({
      name: { fr: 'Draft Produit', ar: '', en: '' },
      slug: `draft-prod-${Date.now()}`,
      description: { fr: 'Draft Description', ar: '', en: '' },
      category: testCat._id,
      sellingPrice: 4000,
      costPrice: 2000,
      isActive: false,
      colors: [
        {
          colorName: 'Rose',
          colorCode: '#FFC0CB',
          images: ['/products/merya_dress_rose.jpg'],
          sizes: [{ size: 'S', stock: 2 }]
        }
      ]
    });

    // Admin provides complete translations AND isActive: true in one single request
    const mockReq = {
      params: { id: draftProd._id.toString() },
      body: {
        name: { fr: 'Robe Soie Rose', ar: 'فستان حرير وردي', en: 'Pink Silk Dress' },
        description: { fr: 'Robe élégante en soie rose', ar: 'فستان أنيق من الحرير الوردي', en: 'Elegant pink silk dress' },
        isActive: true
      }
    };

    let responseData = null;
    const mockRes = {
      status(code) { this.statusCode = code; return this; },
      json(data) { responseData = data; return this; }
    };

    await updateProduct(mockReq, mockRes, (err) => { if (err) throw err; });

    assert.strictEqual(responseData?.success, true);
    assert.strictEqual(responseData?.product.isActive, true);

    const activatedInDb = await Product.findById(draftProd._id);
    assert.strictEqual(activatedInDb.isActive, true);
    assert.strictEqual(activatedInDb.name.ar, 'فستان حرير وردي');
    assert.strictEqual(activatedInDb.description.en, 'Elegant pink silk dress');

    await Product.findByIdAndDelete(draftProd._id);
  });

  // 3. Financial Integrity: Admin adding a new item with price override requires explicit authorization
  test('3. Admin adding a new item with non-standard price requires priceOverride=true and records in auditHistory', async () => {
    // Initial order with 1 item
    const { order } = await placeOrder({
      customer: {
        fullName: 'Price Override Customer',
        phone: '0555998877',
        wilaya: { code: 16, name: 'Alger' },
        deliveryMethod: DELIVERY_METHODS.HOME,
        address: 'Rue Didouche Mourad'
      },
      items: [
        { productId: testProd._id.toString(), colorName: 'Bleu Ciel', size: 'M', quantity: 1 }
      ],
      idempotencyKey: `price-ovr-${Date.now()}`
    });

    // Second product with sellingPrice = 6000
    const prodTwo = await Product.create({
      name: { fr: 'Abaya Perles', ar: 'عباية لؤلؤ', en: 'Pearl Abaya' },
      slug: `abaya-pearl-${Date.now()}`,
      description: { fr: 'Abaya FR', ar: 'عباية AR', en: 'Abaya EN' },
      category: testCat._id,
      sellingPrice: 6000,
      costPrice: 3000,
      isActive: true,
      colors: [
        {
          colorName: 'Noir',
          colorCode: '#000000',
          images: ['/products/merya_dress_black.jpg'],
          sizes: [{ size: 'Standard', stock: 10 }]
        }
      ]
    });

    // Attempt to silently insert new item with unitPrice = 1 DZD without priceOverride
    await assert.rejects(
      async () => {
        await updateOrderItemsService({
          orderId: order._id.toString(),
          newItems: [
            { productId: testProd._id.toString(), colorName: 'Bleu Ciel', size: 'M', quantity: 1 },
            { productId: prodTwo._id.toString(), colorName: 'Noir', size: 'Standard', quantity: 1, unitPrice: 1 }
          ],
          reason: 'Attempting silent 1 DZD price insertion',
          priceOverride: false
        });
      },
      (err) => {
        assert.strictEqual(err.code, 'PRICE_OVERRIDE_REQUIRED');
        return true;
      },
      'Must reject silent 1 DZD price insertion with PRICE_OVERRIDE_REQUIRED'
    );

    // Attempt with priceOverride: true but missing reason
    await assert.rejects(
      async () => {
        await updateOrderItemsService({
          orderId: order._id.toString(),
          newItems: [
            { productId: testProd._id.toString(), colorName: 'Bleu Ciel', size: 'M', quantity: 1 },
            { productId: prodTwo._id.toString(), colorName: 'Noir', size: 'Standard', quantity: 1, unitPrice: 1 }
          ],
          reason: 'Valid item modification reason',
          priceOverride: true,
          priceOverrideReason: ''
        });
      },
      (err) => {
        assert.strictEqual(err.code, 'PRICE_OVERRIDE_REASON_REQUIRED');
        return true;
      },
      'Must reject missing priceOverrideReason with PRICE_OVERRIDE_REASON_REQUIRED'
    );

    // Succeed when priceOverride: true and valid priceOverrideReason are provided
    const updated = await updateOrderItemsService({
      orderId: order._id.toString(),
      newItems: [
        { productId: testProd._id.toString(), colorName: 'Bleu Ciel', size: 'M', quantity: 1 },
        { productId: prodTwo._id.toString(), colorName: 'Noir', size: 'Standard', quantity: 1, unitPrice: 1 }
      ],
      reason: 'Owner VIP promotional gift',
      priceOverride: true,
      priceOverrideReason: 'Authorized VIP discount override approved by Owner'
    });

    assert.strictEqual(updated.items.length, 2);
    const addedItem = updated.items.find(it => it.productId.toString() === prodTwo._id.toString());
    assert.strictEqual(addedItem.unitPrice, 1, 'Price override applied to 1 DZD');

    // Verify auditHistory records the price override
    const lastAudit = updated.auditHistory[updated.auditHistory.length - 1];
    assert.ok(lastAudit.details.priceChanges?.length > 0, 'Audit history must contain priceChanges');
    assert.strictEqual(
      lastAudit.details.priceChanges[0].priceOverrideReason,
      'Authorized VIP discount override approved by Owner'
    );

    // Cleanup
    await Order.findByIdAndDelete(order._id);
    await Product.findByIdAndDelete(prodTwo._id);
  });
});
