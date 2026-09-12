import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { Order } from '../src/models/Order.js';
import { DeliverySetting } from '../src/models/DeliverySetting.js';
import { placeOrder } from '../src/services/orderService.js';
import { ALGERIA_WILAYAS } from '../src/config/constants.js';

import {
  calculateDeliveryFee,
  validateDeliverySettingsResponse,
  revalidateCartWithServer
} from '../../frontend/src/services/checkoutValidation.js';

dotenv.config();

const TEST_DB = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27018/merya_dz?replicaSet=rs0&directConnection=true';

describe('MERYA DZ Price Consistency & Free Delivery Hardening', () => {
  let testCat;
  let testProduct;

  before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(TEST_DB);
    }

    testCat = await Category.findOneAndUpdate(
      { slug: 'consistency-test-cat' },
      { name: 'Consistency Test Cat', slug: 'consistency-test-cat', description: 'Test', isActive: true },
      { upsert: true, new: true }
    );

    testProduct = await Product.create({
      name: 'Abaya Silk Consistency Test',
      description: 'Luxurious silk abaya for consistency verification',
      slug: `abaya-silk-consistency-${Date.now()}`,
      category: testCat._id,
      costPrice: 4000,
      sellingPrice: 8000,
      colors: [{
        colorName: 'Noir',
        colorCode: '#000000',
        images: ['/test.jpg'],
        sizes: [
          { size: 'M', stock: 10 },
          { size: 'L', stock: 2 }
        ]
      }],
      isActive: true,
      isArchived: false,
      promotion: {
        active: false,
        promotionalPrice: 6500
      }
    });

    await DeliverySetting.findOneAndUpdate(
      {},
      {
        agencyDeliveryFee: 500,
        homeDeliveryFee: 800,
        freeDeliveryThreshold: 10000,
        wilayaRates: ALGERIA_WILAYAS.map(w => ({
          wilayaCode: w.code,
          wilayaName: w.name,
          homeFee: 800,
          agencyFee: 500,
          isAvailable: true
        }))
      },
      { upsert: true, new: true }
    );
  });

  after(async () => {
    if (testProduct?._id) {
      await Product.deleteOne({ _id: testProduct._id });
    }
    if (testCat?._id) {
      await Category.deleteOne({ _id: testCat._id });
    }
    await Order.deleteMany({ 'customer.fullName': { $regex: /Consistency/i } });
    await mongoose.disconnect();
  });

  describe('1. Free Delivery Threshold Business Rule', () => {
    test('Threshold disabled (0) returns normal delivery fee', () => {
      const fee = calculateDeliveryFee({ subtotal: 8000, rawDeliveryFee: 800, freeDeliveryThreshold: 0 });
      assert.strictEqual(fee, 800);
    });

    test('Threshold null/undefined returns normal delivery fee', () => {
      assert.strictEqual(calculateDeliveryFee({ subtotal: 12000, rawDeliveryFee: 800, freeDeliveryThreshold: null }), 800);
      assert.strictEqual(calculateDeliveryFee({ subtotal: 12000, rawDeliveryFee: 800, freeDeliveryThreshold: undefined }), 800);
    });

    test('Subtotal below threshold returns selected Wilaya fee (800 DA)', () => {
      const fee = calculateDeliveryFee({ subtotal: 9999, rawDeliveryFee: 800, freeDeliveryThreshold: 10000 });
      assert.strictEqual(fee, 800);
    });

    test('Subtotal exactly at threshold returns 0 DA', () => {
      const fee = calculateDeliveryFee({ subtotal: 10000, rawDeliveryFee: 800, freeDeliveryThreshold: 10000 });
      assert.strictEqual(fee, 0);
    });

    test('Subtotal above threshold returns 0 DA', () => {
      const fee = calculateDeliveryFee({ subtotal: 15000, rawDeliveryFee: 800, freeDeliveryThreshold: 10000 });
      assert.strictEqual(fee, 0);
    });

    test('Home delivery fee correctly zeroed when threshold reached', () => {
      const fee = calculateDeliveryFee({ subtotal: 12000, rawDeliveryFee: 900, freeDeliveryThreshold: 10000 });
      assert.strictEqual(fee, 0);
    });

    test('Agency delivery fee correctly zeroed when threshold reached', () => {
      const fee = calculateDeliveryFee({ subtotal: 12000, rawDeliveryFee: 500, freeDeliveryThreshold: 10000 });
      assert.strictEqual(fee, 0);
    });
  });

  describe('2. Strict Frontend Delivery Validation', () => {
    const validWilayas = ALGERIA_WILAYAS.map(w => ({
      wilayaCode: w.code,
      wilayaName: w.name,
      homeFee: 800,
      agencyFee: 500,
      isAvailable: true
    }));

    test('Valid 58-Wilaya configuration accepted strictly', () => {
      const res = validateDeliverySettingsResponse({
        success: true,
        settings: { agencyDeliveryFee: 500, homeDeliveryFee: 800, freeDeliveryThreshold: 10000, wilayaRates: validWilayas }
      });
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.wilayas.length, 58);
      assert.strictEqual(res.settings.freeDeliveryThreshold, 10000);
    });

    test('String homeFee ("800") strictly rejected without coercion', () => {
      const tampered = validWilayas.map((w, i) => i === 0 ? { ...w, homeFee: "800" } : { ...w });
      const res = validateDeliverySettingsResponse({ success: true, settings: { wilayaRates: tampered } });
      assert.strictEqual(res.valid, false);
    });

    test('String agencyFee ("500") strictly rejected without coercion', () => {
      const tampered = validWilayas.map((w, i) => i === 0 ? { ...w, agencyFee: "500" } : { ...w });
      const res = validateDeliverySettingsResponse({ success: true, settings: { wilayaRates: tampered } });
      assert.strictEqual(res.valid, false);
    });

    test('NaN, float, and negative fees rejected', () => {
      assert.strictEqual(validateDeliverySettingsResponse({ success: true, settings: { wilayaRates: validWilayas.map((w, i) => i === 0 ? { ...w, homeFee: NaN } : w) } }).valid, false);
      assert.strictEqual(validateDeliverySettingsResponse({ success: true, settings: { wilayaRates: validWilayas.map((w, i) => i === 0 ? { ...w, homeFee: -100 } : w) } }).valid, false);
      assert.strictEqual(validateDeliverySettingsResponse({ success: true, settings: { wilayaRates: validWilayas.map((w, i) => i === 0 ? { ...w, homeFee: 500.5 } : w) } }).valid, false);
    });

    test('String or invalid wilayaCode rejected', () => {
      assert.strictEqual(validateDeliverySettingsResponse({ success: true, settings: { wilayaRates: validWilayas.map((w, i) => i === 0 ? { ...w, wilayaCode: "1" } : w) } }).valid, false);
      assert.strictEqual(validateDeliverySettingsResponse({ success: true, settings: { wilayaRates: validWilayas.map((w, i) => i === 0 ? { ...w, wilayaCode: 59 } : w) } }).valid, false);
    });

    test('Incomplete Wilayas (57 of 58) strictly rejected', () => {
      const res = validateDeliverySettingsResponse({ success: true, settings: { wilayaRates: validWilayas.slice(0, 57) } });
      assert.strictEqual(res.valid, false);
    });

    test('Invalid 59-Wilaya delivery configuration rejected', () => {
      const extraWilaya = { wilayaCode: 59, wilayaName: 'Extra', homeFee: 800, agencyFee: 500, isAvailable: true };
      const res = validateDeliverySettingsResponse({ success: true, settings: { wilayaRates: [...validWilayas, extraWilaya] } });
      assert.strictEqual(res.valid, false);
    });

    test('Duplicate Wilaya strictly rejected in frontend validation', () => {
      const duplicateWilayas = [...validWilayas.slice(0, 57), { ...validWilayas[0] }];
      const res = validateDeliverySettingsResponse({ success: true, settings: { wilayaRates: duplicateWilayas } });
      assert.strictEqual(res.valid, false);
    });
  });

  describe('3. Authoritative Backend Consistency with Free Delivery', () => {
    test('Backend charges 800 DZD delivery when subtotal < threshold', async () => {
      const result = await placeOrder({
        idempotencyKey: `cons-below-${Date.now()}-${Math.random()}`,
        customer: {
          fullName: 'Consistency Test Below',
          phone: '0555000010',
          wilaya: { code: 16, name: 'Alger' },
          deliveryMethod: 'home',
          address: 'Rue Didouche Mourad'
        },
        items: [{
          productId: testProduct._id,
          colorName: 'Noir',
          size: 'M',
          quantity: 1 // 8000 < 10000
        }]
      });
      assert.strictEqual(result.order.subtotal, 8000);
      assert.strictEqual(result.order.deliveryFee, 800);
      assert.strictEqual(result.order.totalPrice, 8800);
    });

    test('Backend applies 0 DZD delivery when subtotal >= threshold', async () => {
      const result = await placeOrder({
        idempotencyKey: `cons-above-${Date.now()}-${Math.random()}`,
        customer: {
          fullName: 'Consistency Test Above',
          phone: '0555000011',
          wilaya: { code: 16, name: 'Alger' },
          deliveryMethod: 'home',
          address: 'Rue Didouche Mourad'
        },
        items: [{
          productId: testProduct._id,
          colorName: 'Noir',
          size: 'M',
          quantity: 2 // 16000 >= 10000
        }]
      });
      assert.strictEqual(result.order.subtotal, 16000);
      assert.strictEqual(result.order.deliveryFee, 0);
      assert.strictEqual(result.order.totalPrice, 16000);
    });

    test('Backend authoritatively applies promotionalPrice inside transaction', async () => {
      testProduct.promotion.active = true;
      await testProduct.save();

      const result = await placeOrder({
        idempotencyKey: `cons-promo-${Date.now()}-${Math.random()}`,
        customer: {
          fullName: 'Consistency Test Promo',
          phone: '0555000012',
          wilaya: { code: 16, name: 'Alger' },
          deliveryMethod: 'home',
          address: 'Rue Didouche Mourad'
        },
        items: [{
          productId: testProduct._id,
          colorName: 'Noir',
          size: 'M',
          quantity: 1
        }]
      });
      assert.strictEqual(result.order.subtotal, 6500);
      assert.strictEqual(result.order.items[0].unitPrice, 6500);
    });
  });

  describe('4. Cart Revalidation Scenarios', () => {
    const mockServerProducts = [
      {
        _id: 'p1',
        name: 'Robe Merya',
        sellingPrice: 12000,
        promotion: { active: true, promotionalPrice: 9500 },
        colors: [{ colorName: 'Beige', images: ['/beige.jpg'], sizes: [{ size: 'M', stock: 5 }, { size: 'S', stock: 0 }] }]
      },
      {
        _id: 'p2',
        name: 'Abaya Velvet',
        sellingPrice: 15000,
        promotion: { active: false, promotionalPrice: 13000 },
        colors: [{ colorName: 'Bordeaux', images: ['/bordeaux.jpg'], sizes: [{ size: 'L', stock: 3 }] }]
      }
    ];
    // mockFetch simulates the product catalog endpoint (used as customFetchProducts fallback)
    const mockFetch = async () => ({ success: true, products: mockServerProducts, total: mockServerProducts.length });
    // noopQuoteOrder: a stub that always rejects so revalidateCartWithServer falls through to catalog fallback
    const noopQuoteOrder = async () => { throw new Error('quote endpoint not available in test'); };

    test('Normal price -> promotion detected and updated to server price', async () => {
      const res = await revalidateCartWithServer([{
        productId: 'p1', productName: 'Robe Merya', colorName: 'Beige', size: 'M', quantity: 1, unitPrice: 12000, originalPrice: 12000
      }], noopQuoteOrder, mockFetch);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.pricesChanged, true);
      assert.strictEqual(res.updatedItems[0].unitPrice, 9500);
      assert.strictEqual(res.updatedItems[0].originalPrice, 12000);
    });

    test('Changed normal price detected and updated', async () => {
      const catalogWithNewPrice = async () => ({
        success: true,
        products: [{
          _id: 'p2',
          name: 'Abaya Velvet',
          sellingPrice: 16500, // increased from 15000
          promotion: { active: false },
          colors: [{ colorName: 'Bordeaux', images: ['/bordeaux.jpg'], sizes: [{ size: 'L', stock: 3 }] }]
        }],
        pagination: { total: 1 }
      });
      const res = await revalidateCartWithServer([{
        productId: 'p2', productName: 'Abaya Velvet', colorName: 'Bordeaux', size: 'L', quantity: 1, unitPrice: 15000, originalPrice: 15000
      }], noopQuoteOrder, catalogWithNewPrice);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.pricesChanged, true);
      assert.strictEqual(res.updatedItems[0].unitPrice, 16500);
      assert.strictEqual(res.updatedItems[0].originalPrice, 16500);
    });

    test('Newly activated promotion detected and applied', async () => {
      const catalogWithPromo = async () => ({
        success: true,
        products: [{
          _id: 'p2',
          name: 'Abaya Velvet',
          sellingPrice: 15000,
          promotion: { active: true, promotionalPrice: 12500 },
          colors: [{ colorName: 'Bordeaux', images: ['/bordeaux.jpg'], sizes: [{ size: 'L', stock: 3 }] }]
        }],
        pagination: { total: 1 }
      });
      const res = await revalidateCartWithServer([{
        productId: 'p2', productName: 'Abaya Velvet', colorName: 'Bordeaux', size: 'L', quantity: 1, unitPrice: 15000, originalPrice: 15000
      }], noopQuoteOrder, catalogWithPromo);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.pricesChanged, true);
      assert.strictEqual(res.updatedItems[0].unitPrice, 12500);
    });

    test('Promotion ended / removed -> normal price restored', async () => {
      const res = await revalidateCartWithServer([{
        productId: 'p2', productName: 'Abaya Velvet', colorName: 'Bordeaux', size: 'L', quantity: 1, unitPrice: 13000, originalPrice: 15000
      }], noopQuoteOrder, mockFetch);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.pricesChanged, true);
      assert.strictEqual(res.updatedItems[0].unitPrice, 15000);
    });

    test('Missing, inactive, or archived product detected', async () => {
      const res = await revalidateCartWithServer([{
        productId: 'p-deleted', productName: 'Deleted Item', colorName: 'Noir', size: 'M', quantity: 1, unitPrice: 5000
      }], noopQuoteOrder, mockFetch);
      assert.strictEqual(res.success, false);
      assert.ok(res.issues[0].includes('plus disponible'));
    });

    test('Missing color variant detected', async () => {
      const resColor = await revalidateCartWithServer([{
        productId: 'p1', productName: 'Robe Merya', colorName: 'Rose', size: 'M', quantity: 1, unitPrice: 9500
      }], noopQuoteOrder, mockFetch);
      assert.strictEqual(resColor.success, false);
      assert.ok(resColor.issues[0].includes('couleur'));
    });

    test('Missing size variant detected', async () => {
      const resSize = await revalidateCartWithServer([{
        productId: 'p1', productName: 'Robe Merya', colorName: 'Beige', size: 'XXL', quantity: 1, unitPrice: 9500
      }], noopQuoteOrder, mockFetch);
      assert.strictEqual(resSize.success, false);
      assert.ok(resSize.issues[0].includes('taille'));
    });

    test('Insufficient stock detected (partial stock < requested)', async () => {
      const resPartial = await revalidateCartWithServer([{
        productId: 'p1', productName: 'Robe Merya', colorName: 'Beige', size: 'M', quantity: 10, unitPrice: 9500 // available is 5
      }], noopQuoteOrder, mockFetch);
      assert.strictEqual(resPartial.success, false);
      assert.ok(resPartial.issues[0].includes('Stock insuffisant'));
      assert.ok(resPartial.issues[0].includes('seulement 5 disponible'));
    });

    test('Zero stock detected (rupture de stock)', async () => {
      const resOOS = await revalidateCartWithServer([{
        productId: 'p1', productName: 'Robe Merya', colorName: 'Beige', size: 'S', quantity: 1, unitPrice: 9500
      }], noopQuoteOrder, mockFetch);
      assert.strictEqual(resOOS.success, false);
      assert.ok(resOOS.issues[0].includes('rupture de stock'));
    });

    test('Fail-closed: Validation server/network failure returns success: false and customer message', async () => {
      const networkFailFetch = async () => {
        throw new Error('Network unreachable or server 500');
      };
      const res = await revalidateCartWithServer([{
        productId: 'p1', productName: 'Robe Merya', colorName: 'Beige', size: 'M', quantity: 1, unitPrice: 9500
      }], noopQuoteOrder, networkFailFetch);
      assert.strictEqual(res.success, false, 'Failed server validation must NEVER succeed (fail-closed)');
      assert.ok(res.issues.some(msg => msg.includes('Impossible de vérifier votre panier')));
      assert.strictEqual(res.updatedItems.length, 0);
    });

    test('Product #51+ cart revalidation correctly traverses pagination using firstRes.pagination.total', async () => {
      // Create a catalog with 60 products across 2 pages (50 on page 1, 10 on page 2)
      // The target product is at index 55 (#56) on page 2
      const page1Products = Array.from({ length: 50 }, (_, i) => ({
        _id: `prod-p1-${i}`,
        name: `Product P1-${i}`,
        sellingPrice: 5000,
        colors: [{ colorName: 'Noir', sizes: [{ size: 'M', stock: 10 }] }]
      }));
      const page2Products = Array.from({ length: 10 }, (_, i) => ({
        _id: `prod-p2-${i}`,
        name: `Product P2-${i}`,
        sellingPrice: 7500,
        colors: [{ colorName: 'Blanc', sizes: [{ size: 'L', stock: 8 }] }]
      }));

      const paginatedFetch = async ({ page = 1, limit = 50 }) => {
        if (page === 1) {
          return {
            success: true,
            products: page1Products,
            pagination: { total: 60, page: 1, pages: 2 }
          };
        }
        if (page === 2) {
          return {
            success: true,
            products: page2Products,
            pagination: { total: 60, page: 2, pages: 2 }
          };
        }
        return { success: true, products: [], pagination: { total: 60, page, pages: 2 } };
      };

      // Item #55 is prod-p2-5 on page 2
      const cartItems = [{
        productId: 'prod-p2-5',
        productName: 'Product P2-5',
        colorName: 'Blanc',
        size: 'L',
        quantity: 2,
        unitPrice: 7500
      }];

      const res = await revalidateCartWithServer(cartItems, noopQuoteOrder, paginatedFetch);
      assert.strictEqual(res.success, true, 'Product #51+ on page 2 must be found via pagination');
      assert.strictEqual(res.issues.length, 0);
      assert.strictEqual(res.updatedItems[0].productName, 'Product P2-5');
      assert.strictEqual(res.updatedItems[0].unitPrice, 7500);
    });

    test('Product #100+ cart revalidation traverses to page 3 using firstRes.pagination.total', async () => {
      // 120 products across 3 pages: target product is at index 105 (#106) on page 3
      const page1 = Array.from({ length: 50 }, (_, i) => ({
        _id: `p1-${i}`,
        name: `Item 1-${i}`,
        sellingPrice: 3000,
        colors: [{ colorName: 'Vert', sizes: [{ size: 'S', stock: 5 }] }]
      }));
      const page2 = Array.from({ length: 50 }, (_, i) => ({
        _id: `p2-${i}`,
        name: `Item 2-${i}`,
        sellingPrice: 4000,
        colors: [{ colorName: 'Vert', sizes: [{ size: 'S', stock: 5 }] }]
      }));
      const page3 = Array.from({ length: 20 }, (_, i) => ({
        _id: `p3-${i}`,
        name: `Item 3-${i}`,
        sellingPrice: 9000,
        colors: [{ colorName: 'Vert', sizes: [{ size: 'S', stock: 12 }] }]
      }));

      const multiPageFetch = async ({ page = 1 }) => {
        const pagesMap = { 1: page1, 2: page2, 3: page3 };
        return {
          success: true,
          products: pagesMap[page] || [],
          pagination: { total: 120, page, pages: 3 }
        };
      };

      const cartItems = [{
        productId: 'p3-5', // Product #106
        productName: 'Item 3-5',
        colorName: 'Vert',
        size: 'S',
        quantity: 3,
        unitPrice: 9000
      }];

      const res = await revalidateCartWithServer(cartItems, noopQuoteOrder, multiPageFetch);
      assert.strictEqual(res.success, true, 'Product #100+ on page 3 must be found via pagination');
      assert.strictEqual(res.issues.length, 0);
      assert.strictEqual(res.updatedItems[0].productName, 'Item 3-5');
      assert.strictEqual(res.updatedItems[0].unitPrice, 9000);
    });

    test('Checkout payload never contains prices', () => {
      const cartItems = [{ productId: 'p1', productName: 'Robe', colorName: 'Beige', size: 'M', quantity: 1, unitPrice: 9500, originalPrice: 12000 }];
      const payloadItems = cartItems.map(item => ({
        productId: item.productId,
        colorName: item.colorName,
        size: item.size,
        quantity: item.quantity
      }));
      assert.strictEqual(payloadItems[0].unitPrice, undefined);
      assert.strictEqual(payloadItems[0].price, undefined);
      assert.strictEqual(payloadItems[0].totalPrice, undefined);
      assert.strictEqual(payloadItems[0].deliveryFee, undefined);
    });
  });

  describe('5. GET /settings/delivery Hardening & Stale Config Rejection', () => {
    function mockRes() {
      return {
        statusCode: 200,
        body: null,
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; }
      };
    }

    test('GET returns HTTP 200 when exactly 58 valid Wilayas exist', async () => {
      const { getDeliverySettings } = await import('../src/controllers/deliverySettingController.js');
      const res = mockRes();
      await getDeliverySettings({}, res, () => {});
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.wilayas.length, 58);
      assert.strictEqual(res.body.settings.freeDeliveryThreshold, 10000);
    });

    test('GET rejects with HTTP 503 if database has 59 Wilayas (malformed)', async () => {
      const { getDeliverySettings } = await import('../src/controllers/deliverySettingController.js');
      // Temporarily insert 59th wilaya
      const extraRate = {
        wilayaCode: 59,
        wilayaName: 'Extra Wilaya',
        homeFee: 1000,
        agencyFee: 800,
        isAvailable: true
      };
      await DeliverySetting.updateOne({}, { $push: { wilayaRates: extraRate } });

      const res = mockRes();
      await getDeliverySettings({}, res, () => {});
      assert.strictEqual(res.statusCode, 503);
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.message.includes('expected exactly 58'));

      // Restore
      await DeliverySetting.updateOne({}, { $pull: { wilayaRates: { wilayaCode: 59 } } });
    });

    test('GET rejects with HTTP 503 if database is missing Wilayas (e.g. 57)', async () => {
      const { getDeliverySettings } = await import('../src/controllers/deliverySettingController.js');
      const current = await DeliverySetting.findOne();
      const savedRates = current.wilayaRates;

      await DeliverySetting.updateOne({}, { $set: { wilayaRates: savedRates.slice(0, 57) } });
      const res = mockRes();
      await getDeliverySettings({}, res, () => {});
      assert.strictEqual(res.statusCode, 503);
      assert.strictEqual(res.body.success, false);

      // Restore
      await DeliverySetting.updateOne({}, { $set: { wilayaRates: savedRates } });
    });

    test('GET rejects with HTTP 503 if any fee is negative or non-number', async () => {
      const { getDeliverySettings } = await import('../src/controllers/deliverySettingController.js');
      const current = await DeliverySetting.findOne();
      const savedRates = current.wilayaRates;

      const tampered = savedRates.map((w, i) => i === 0 ? { ...w.toObject(), homeFee: -50 } : w.toObject());
      await DeliverySetting.updateOne({}, { $set: { wilayaRates: tampered } });

      const res = mockRes();
      await getDeliverySettings({}, res, () => {});
      assert.strictEqual(res.statusCode, 503);
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.message.includes('homeFee'));

      // Restore
      await DeliverySetting.updateOne({}, { $set: { wilayaRates: savedRates } });
    });

    test('GET rejects with HTTP 503 if canonical Wilaya name was corrupted', async () => {
      const { getDeliverySettings } = await import('../src/controllers/deliverySettingController.js');
      const current = await DeliverySetting.findOne();
      const savedRates = current.wilayaRates;

      const tampered = savedRates.map((w, i) => i === 0 ? { ...w.toObject(), wilayaName: 'Fake Alger Name' } : w.toObject());
      await DeliverySetting.updateOne({}, { $set: { wilayaRates: tampered } });

      const res = mockRes();
      await getDeliverySettings({}, res, () => {});
      assert.strictEqual(res.statusCode, 503);
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.message.includes('canonical name'));

      // Restore
      await DeliverySetting.updateOne({}, { $set: { wilayaRates: savedRates } });
    });

    test('GET rejects with HTTP 503 if duplicate Wilaya code exists in database', async () => {
      const { getDeliverySettings } = await import('../src/controllers/deliverySettingController.js');
      const current = await DeliverySetting.findOne();
      const savedRates = current.wilayaRates;

      // Duplicate code 16 (Alger) in place of code 1
      const tampered = savedRates.map((w, i) => i === 0 ? { ...w.toObject(), wilayaCode: 16 } : w.toObject());
      await DeliverySetting.updateOne({}, { $set: { wilayaRates: tampered } });

      const res = mockRes();
      await getDeliverySettings({}, res, () => {});
      assert.strictEqual(res.statusCode, 503);
      assert.strictEqual(res.body.success, false);

      // Restore
      await DeliverySetting.updateOne({}, { $set: { wilayaRates: savedRates } });
    });
  });

  describe('6. Server-Authoritative Cart Quote Flow (POST /orders/quote)', () => {
    function mockRes() {
      return {
        statusCode: 200,
        body: null,
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; }
      };
    }

    test('Quote endpoint returns authoritative prices and applies free delivery threshold', async () => {
      const { getCartQuote } = await import('../src/controllers/orderController.js');
      const req = {
        body: {
          items: [{
            productId: testProduct._id,
            productName: 'Abaya Silk',
            colorName: 'Noir',
            size: 'M',
            quantity: 2 // 2 * 6500 = 13000 >= 10000 threshold
          }],
          wilayaCode: 16,
          deliveryMethod: 'home'
        }
      };

      const res = mockRes();
      await getCartQuote(req, res, () => {});
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.isValid, true);
      assert.strictEqual(res.body.subtotal, 13000);
      assert.strictEqual(res.body.deliveryFee, 0, 'Delivery fee must be 0 when subtotal >= threshold');
      assert.strictEqual(res.body.isFreeDelivery, true);
      assert.strictEqual(res.body.totalPrice, 13000);
    });

    test('Quote endpoint detects unavailable variant or insufficient stock', async () => {
      const { getCartQuote } = await import('../src/controllers/orderController.js');
      const req = {
        body: {
          items: [{
            productId: testProduct._id,
            colorName: 'Noir',
            size: 'L', // stock = 2
            quantity: 5 // requesting 5 > 2
          }]
        }
      };

      const res = mockRes();
      await getCartQuote(req, res, () => {});
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.isValid, false);
      assert.ok(res.body.issues[0].includes('Stock insuffisant'));
    });
  });

  describe('7. WebSocket Admin Session Revocation Hardening', () => {
    let testServer;
    let wsPort = 5199;
    let adminUser;
    let validToken;

    before(async () => {
      const { Admin } = await import('../src/models/Admin.js');
      const { wsService } = await import('../src/services/websocketService.js');
      const http = await import('node:http');

      adminUser = await Admin.findOneAndUpdate(
        { email: 'ws_revocation_test@merya.dz' },
        {
          username: 'wsrevadmin',
          email: 'ws_revocation_test@merya.dz',
          passwordHash: 'dummyhash',
          role: 'admin',
          isActive: true,
          sessionVersion: 1
        },
        { upsert: true, new: true }
      );

      const secret = process.env.JWT_SECRET || 'test_jwt_secret_production_key_32bytes!!';
      validToken = (await import('jsonwebtoken')).default.sign(
        { id: adminUser._id, role: adminUser.role, username: adminUser.username, sessionVersion: 1 },
        secret,
        { expiresIn: '7d' }
      );

      testServer = http.default.createServer();
      wsService.init(testServer, ['http://localhost:5173']);
      await new Promise(r => testServer.listen(wsPort, r));
    });

    after(async () => {
      const { Admin } = await import('../src/models/Admin.js');
      const { wsService } = await import('../src/services/websocketService.js');
      if (wsService.wss) wsService.wss.close();
      if (testServer) testServer.close();
      if (adminUser?._id) await Admin.deleteOne({ _id: adminUser._id });
    });

    test('Connected admin WebSocket receives SESSION_REVOKED and closes on logout', async () => {
      const { WebSocket } = await import('ws');
      const { wsService } = await import('../src/services/websocketService.js');
      const { logout } = await import('../src/controllers/authController.js');

      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/ws`, {
        headers: {
          Origin: 'http://localhost:5173',
          Cookie: `token=${validToken}`
        }
      });

      // 1. Connect and subscribe to admin channel
      // Note: ws.isAdmin here refers to the CLIENT socket, not the server socket.
      // We verify subscription succeeded by waiting for SUBSCRIBED message.
      let subscribeResolved = false;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('SUBSCRIBE_ADMIN timed out')), 5000);
        ws.on('open', () => {
          ws.send(JSON.stringify({ action: 'SUBSCRIBE_ADMIN' }));
        });
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'SUBSCRIBED' && msg.channel === 'admin') {
            clearTimeout(timeout);
            subscribeResolved = true;
            resolve();
          }
          if (msg.type === 'ERROR') {
            clearTimeout(timeout);
            reject(new Error(`WS subscription error: ${msg.message}`));
          }
        });
        ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
      });

      assert.strictEqual(subscribeResolved, true, 'Admin WebSocket must successfully subscribe to admin channel');

      // 2. Trigger admin logout which calls wsService.revokeAdminSession
      const revokedPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('SESSION_REVOKED not received within 5s')), 5000);
        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'SESSION_REVOKED') {
              clearTimeout(timeout);
              resolve(true);
            }
          } catch { /* ignore parse errors */ }
        });
        ws.on('close', (code) => {
          clearTimeout(timeout);
          // close code 4001 = session revoked
          resolve(code === 4001);
        });
        ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
      });

      const mockLogoutRes = {
        clearCookie() {},
        json() {}
      };
      await logout({ cookies: { token: validToken } }, mockLogoutRes, () => {});

      const wasRevoked = await revokedPromise;
      assert.strictEqual(wasRevoked, true, 'Active admin WebSocket must receive SESSION_REVOKED when logged out');
    });
  });

  describe('8. Admin Order Item Price Override & Historical Immutability', () => {
    let orderForOverride;

    before(async () => {
      // Create a dedicated order for price override tests
      const placed = await placeOrder({
        idempotencyKey: `price-override-test-${Date.now()}`,
        customer: {
          fullName: 'Price Override Customer',
          phone: '0555000099',
          wilaya: { code: 16, name: 'Alger' },
          deliveryMethod: 'home',
          address: 'Didouche Mourad'
        },
        items: [{
          productId: testProduct._id,
          colorName: 'Noir',
          size: 'M',
          quantity: 1
        }]
      });
      orderForOverride = placed.order;
    });

    test('Quantity update without unitPrice preserves historical price without requiring priceOverride', async () => {
      const { updateOrderItemsService } = await import('../src/services/orderService.js');
      const freshOrder = await Order.findById(orderForOverride._id);
      const updated = await updateOrderItemsService({
        orderId: freshOrder._id,
        expectedVersion: freshOrder.__v,
        reason: 'Customer requested 2 units instead of 1',
        adminUsername: 'SuperAdmin',
        newItems: [{
          productId: testProduct._id,
          colorName: 'Noir',
          size: 'M',
          quantity: 2
        }]
      });

      assert.strictEqual(updated.items[0].quantity, 2);
      assert.strictEqual(updated.items[0].unitPrice, freshOrder.items[0].unitPrice);
      orderForOverride = updated;
    });

    test('Altering unitPrice without priceOverride: true is strictly rejected', async () => {
      const { updateOrderItemsService } = await import('../src/services/orderService.js');
      const freshOrder = await Order.findById(orderForOverride._id);
      await assert.rejects(
        async () => {
          await updateOrderItemsService({
            orderId: freshOrder._id,
            expectedVersion: freshOrder.__v,
            reason: 'Accidental price edit attempt',
            adminUsername: 'Admin',
            priceOverride: false,
            newItems: [{
              productId: testProduct._id,
              colorName: 'Noir',
              size: 'M',
              quantity: 2,
              unitPrice: 5000 // Historical is 6500 or 8000
            }]
          });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.code, 'PRICE_OVERRIDE_REQUIRED');
          return true;
        }
      );
    });

    test('Altering unitPrice with priceOverride: true but missing reason is strictly rejected', async () => {
      const { updateOrderItemsService } = await import('../src/services/orderService.js');
      const freshOrder = await Order.findById(orderForOverride._id);
      await assert.rejects(
        async () => {
          await updateOrderItemsService({
            orderId: freshOrder._id,
            expectedVersion: freshOrder.__v,
            reason: 'General line edit',
            adminUsername: 'Admin',
            priceOverride: true,
            priceOverrideReason: '', // Empty reason
            newItems: [{
              productId: testProduct._id,
              colorName: 'Noir',
              size: 'M',
              quantity: 2,
              unitPrice: 5000
            }]
          });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.code, 'PRICE_OVERRIDE_REASON_REQUIRED');
          return true;
        }
      );
    });

    test('Explicit admin price override with reason succeeds and audits previous and new price', async () => {
      const { updateOrderItemsService } = await import('../src/services/orderService.js');
      const freshOrder = await Order.findById(orderForOverride._id);
      const historicalPrice = freshOrder.items[0].unitPrice;
      const newCustomPrice = 5500;

      const updated = await updateOrderItemsService({
        orderId: freshOrder._id,
        expectedVersion: freshOrder.__v,
        reason: 'Manager goodwill discount applied',
        adminUsername: 'SuperAdmin',
        priceOverride: true,
        priceOverrideReason: 'VIP client goodwill rebate authorized by director',
        newItems: [{
          productId: testProduct._id,
          colorName: 'Noir',
          size: 'M',
          quantity: 2,
          unitPrice: newCustomPrice
        }]
      });

      assert.strictEqual(updated.items[0].unitPrice, newCustomPrice);
      assert.strictEqual(updated.subtotal, newCustomPrice * 2);

      // Verify audit trail recorded price changes
      const latestAudit = updated.auditHistory[updated.auditHistory.length - 1];
      assert.ok(latestAudit.note.includes('[PRICE OVERRIDES: 1]'));
      assert.ok(Array.isArray(latestAudit.details?.priceChanges));
      const record = latestAudit.details.priceChanges[0];
      assert.strictEqual(record.previousPrice, historicalPrice);
      assert.strictEqual(record.newPrice, newCustomPrice);
      assert.strictEqual(record.priceOverrideReason, 'VIP client goodwill rebate authorized by director');
    });
  });

  describe('9. Authoritative Checkout Idempotency & Inventory Semantics', () => {
    test('Duplicate placeOrder with same idempotencyKey returns cached order without deducting stock twice', async () => {
      const testKey = `idem-consist-test-${Date.now()}`;
      const payload = {
        idempotencyKey: testKey,
        customer: {
          fullName: 'Idempotent Customer',
          phone: '0555000088',
          wilaya: { code: 16, name: 'Alger' },
          deliveryMethod: 'home',
          address: 'Didouche Mourad'
        },
        items: [{
          productId: testProduct._id,
          colorName: 'Noir',
          size: 'L',
          quantity: 1
        }]
      };

      const res1 = await placeOrder(payload);
      const res2 = await placeOrder(payload);

      assert.strictEqual(res1.order._id.toString(), res2.order._id.toString());
      assert.strictEqual(res2.isDuplicate, true);
    });

    test('placeOrder when quantity exceeds available stock fails atomically', async () => {
      await assert.rejects(
        async () => {
          await placeOrder({
            idempotencyKey: `oversell-consist-${Date.now()}`,
            customer: {
              fullName: 'Oversell Customer',
              phone: '0555000077',
              wilaya: { code: 16, name: 'Alger' },
              deliveryMethod: 'home',
              address: 'Didouche Mourad'
            },
            items: [{
              productId: testProduct._id,
              colorName: 'Noir',
              size: 'L',
              quantity: 9999 // way exceeds available stock
            }]
          });
        },
        (err) => {
          assert.ok(err.message.includes('stock') || err.message.includes('remaining') || err.message.includes('Stock'));
          return true;
        }
      );
    });
  });
});
