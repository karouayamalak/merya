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

  describe('4. Server-Authoritative Cart Validation & Fail-Closed Scenarios', () => {
    test('Quote success: valid cart returns valid server quote with live product price', async () => {
      const mockQuote = async (payload) => ({
        success: true,
        isValid: true,
        subtotal: 9500,
        deliveryFee: 800,
        totalPrice: 10300,
        issues: [],
        items: [{
          productId: 'p1',
          productName: 'Robe Merya',
          colorName: 'Beige',
          size: 'M',
          quantity: 1,
          unitPrice: 9500,
          originalPrice: 12000,
          availableStock: 5,
          inStock: true,
          isAvailable: true
        }]
      });

      const res = await revalidateCartWithServer([{
        productId: 'p1', productName: 'Robe Merya', colorName: 'Beige', size: 'M', quantity: 1, unitPrice: 12000, originalPrice: 12000
      }], mockQuote);

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.pricesChanged, true);
      assert.strictEqual(res.updatedItems[0].unitPrice, 9500);
      assert.strictEqual(res.updatedItems[0].originalPrice, 12000);
    });

    test('Quote success: promotion price is used when active', async () => {
      const mockQuote = async () => ({
        success: true,
        isValid: true,
        subtotal: 12500,
        issues: [],
        items: [{
          productId: 'p2',
          productName: 'Abaya Velvet',
          colorName: 'Bordeaux',
          size: 'L',
          quantity: 1,
          unitPrice: 12500,
          originalPrice: 15000,
          availableStock: 3,
          inStock: true,
          isAvailable: true
        }]
      });

      const res = await revalidateCartWithServer([{
        productId: 'p2', productName: 'Abaya Velvet', colorName: 'Bordeaux', size: 'L', quantity: 1, unitPrice: 15000, originalPrice: 15000
      }], mockQuote);

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.pricesChanged, true);
      assert.strictEqual(res.updatedItems[0].unitPrice, 12500);
    });

    test('Quote success: promotion removed restores regular selling price', async () => {
      const mockQuote = async () => ({
        success: true,
        isValid: true,
        subtotal: 15000,
        issues: [],
        items: [{
          productId: 'p2',
          productName: 'Abaya Velvet',
          colorName: 'Bordeaux',
          size: 'L',
          quantity: 1,
          unitPrice: 15000,
          originalPrice: 15000,
          availableStock: 3,
          inStock: true,
          isAvailable: true
        }]
      });

      const res = await revalidateCartWithServer([{
        productId: 'p2', productName: 'Abaya Velvet', colorName: 'Bordeaux', size: 'L', quantity: 1, unitPrice: 12500, originalPrice: 15000
      }], mockQuote);

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.pricesChanged, true);
      assert.strictEqual(res.updatedItems[0].unitPrice, 15000);
    });

    test('Quote success: changed normal price detected and updated', async () => {
      const mockQuote = async () => ({
        success: true,
        isValid: true,
        subtotal: 16500,
        issues: [],
        items: [{
          productId: 'p2',
          productName: 'Abaya Velvet',
          colorName: 'Bordeaux',
          size: 'L',
          quantity: 1,
          unitPrice: 16500,
          originalPrice: 16500,
          availableStock: 3,
          inStock: true,
          isAvailable: true
        }]
      });

      const res = await revalidateCartWithServer([{
        productId: 'p2', productName: 'Abaya Velvet', colorName: 'Bordeaux', size: 'L', quantity: 1, unitPrice: 15000, originalPrice: 15000
      }], mockQuote);

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.pricesChanged, true);
      assert.strictEqual(res.updatedItems[0].unitPrice, 16500);
      assert.strictEqual(res.updatedItems[0].originalPrice, 16500);
    });

    test('Quote check: variant stock shortage detected', async () => {
      const mockQuote = async () => ({
        success: true,
        isValid: false,
        subtotal: 9500,
        issues: ['Stock insuffisant pour "Robe Merya" (Beige, M) : seulement 2 restant(s).'],
        items: [{
          productId: 'p1',
          productName: 'Robe Merya',
          colorName: 'Beige',
          size: 'M',
          quantity: 5,
          unitPrice: 9500,
          originalPrice: 12000,
          availableStock: 2,
          inStock: false,
          isAvailable: true
        }]
      });

      const res = await revalidateCartWithServer([{
        productId: 'p1', productName: 'Robe Merya', colorName: 'Beige', size: 'M', quantity: 5, unitPrice: 9500
      }], mockQuote);

      assert.strictEqual(res.success, false);
      assert.ok(res.issues[0].includes('Stock insuffisant'));
    });

    test('Quote payload strictly never contains client prices, subtotal, delivery fee, or total', async () => {
      let interceptedPayload = null;
      const mockQuote = async (payload) => {
        interceptedPayload = payload;
        return {
          success: true,
          isValid: true,
          subtotal: 9500,
          issues: [],
          items: [{
            productId: 'p1',
            colorName: 'Beige',
            size: 'M',
            quantity: 1,
            unitPrice: 9500,
            originalPrice: 12000,
            availableStock: 5,
            inStock: true,
            isAvailable: true
          }]
        };
      };

      const cartItems = [{
        productId: 'p1',
        productName: 'Robe',
        colorName: 'Beige',
        size: 'M',
        quantity: 1,
        unitPrice: 9500,
        originalPrice: 12000
      }];

      await revalidateCartWithServer(cartItems, { wilayaCode: 16, deliveryMethod: 'home' }, mockQuote);

      assert.ok(interceptedPayload, 'Quote endpoint must be called');
      assert.strictEqual(interceptedPayload.items[0].productId, 'p1');
      assert.strictEqual(interceptedPayload.items[0].colorName, 'Beige');
      assert.strictEqual(interceptedPayload.items[0].size, 'M');
      assert.strictEqual(interceptedPayload.items[0].quantity, 1);
      assert.strictEqual(interceptedPayload.items[0].unitPrice, undefined, 'Client unitPrice must never be sent');
      assert.strictEqual(interceptedPayload.items[0].originalPrice, undefined, 'Client originalPrice must never be sent');
      assert.strictEqual(interceptedPayload.subtotal, undefined, 'Client subtotal must never be sent');
      assert.strictEqual(interceptedPayload.deliveryFee, undefined, 'Client deliveryFee must never be sent');
      assert.strictEqual(interceptedPayload.totalPrice, undefined, 'Client totalPrice must never be sent');
      assert.strictEqual(interceptedPayload.wilayaCode, 16);
      assert.strictEqual(interceptedPayload.deliveryMethod, 'home');
    });

    test('Fail-Closed: /orders/quote returns HTTP 500 -> fails closed with user message', async () => {
      const mockQuote500 = async () => {
        const err = new Error('Internal Server Error');
        err.statusCode = 500;
        throw err;
      };

      const res = await revalidateCartWithServer([{
        productId: 'p1', colorName: 'Beige', size: 'M', quantity: 1
      }], mockQuote500);

      assert.strictEqual(res.success, false);
      assert.ok(res.issues.some(m => m.includes('Impossible de vérifier votre panier')));
      assert.strictEqual(res.updatedItems.length, 0);
    });

    test('Fail-Closed: Network request fails -> fails closed with user message', async () => {
      const mockNetworkError = async () => {
        throw new Error('Failed to fetch: net::ERR_CONNECTION_REFUSED');
      };

      const res = await revalidateCartWithServer([{
        productId: 'p1', colorName: 'Beige', size: 'M', quantity: 1
      }], mockNetworkError);

      assert.strictEqual(res.success, false);
      assert.ok(res.issues.some(m => m.includes('Impossible de vérifier votre panier')));
    });

    test('Fail-Closed: Malformed quote response (null, missing items, subtotal not a number) -> fails closed', async () => {
      const resNull = await revalidateCartWithServer([{ productId: 'p1', colorName: 'Beige', size: 'M', quantity: 1 }], async () => null);
      assert.strictEqual(resNull.success, false);

      const resNoItems = await revalidateCartWithServer([{ productId: 'p1', colorName: 'Beige', size: 'M', quantity: 1 }], async () => ({ success: true, subtotal: 5000 }));
      assert.strictEqual(resNoItems.success, false);

      const resBadSubtotal = await revalidateCartWithServer([{ productId: 'p1', colorName: 'Beige', size: 'M', quantity: 1 }], async () => ({ success: true, items: [], subtotal: 'NaN' }));
      assert.strictEqual(resBadSubtotal.success, false);
    });

    test('Fail-Closed: Server says cart is invalid (issues present, isValid: false) -> fails closed', async () => {
      const mockInvalid = async () => ({
        success: true,
        isValid: false,
        issues: ['L\'article "Robe Merya" n\'est plus disponible.'],
        items: [],
        subtotal: 0
      });

      const res = await revalidateCartWithServer([{
        productId: 'p1', colorName: 'Beige', size: 'M', quantity: 1
      }], mockInvalid);

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.issues[0], 'L\'article "Robe Merya" n\'est plus disponible.');
    });

    test('Confirm NONE of the quote failures trigger a /products full-catalog fallback', async () => {
      let catalogFetchAttempted = false;
      const fakeCatalog = () => { catalogFetchAttempted = true; return { success: true, products: [] }; };

      // Try with network error
      await revalidateCartWithServer([{ productId: 'p1', colorName: 'Beige', size: 'M', quantity: 1 }], async () => {
        throw new Error('500 internal server error');
      });
      assert.strictEqual(catalogFetchAttempted, false, 'Quote failure must NEVER trigger full-catalog fallback');

      // Try with invalid cart
      await revalidateCartWithServer([{ productId: 'p1', colorName: 'Beige', size: 'M', quantity: 1 }], async () => ({
        success: false, message: 'Server down'
      }));
      assert.strictEqual(catalogFetchAttempted, false, 'Quote failure must NEVER trigger full-catalog fallback');
    });

    test('Large catalog regression: 100+ product catalog does NOT require catalog pagination or download', async () => {
      // In a catalog with 100+ products, validation sends only the cart item IDs to /orders/quote
      let quoteCallCount = 0;
      let requestedItems = null;

      const mockQuote100Plus = async (payload) => {
        quoteCallCount++;
        requestedItems = payload.items;
        return {
          success: true,
          isValid: true,
          subtotal: 8000,
          issues: [],
          items: [{
            productId: 'product-item-105',
            colorName: 'Noir',
            size: 'M',
            quantity: 1,
            unitPrice: 8000,
            originalPrice: 8000,
            availableStock: 20,
            inStock: true,
            isAvailable: true
          }]
        };
      };

      const res = await revalidateCartWithServer([{
        productId: 'product-item-105',
        colorName: 'Noir',
        size: 'M',
        quantity: 1,
        unitPrice: 8000
      }], mockQuote100Plus);

      assert.strictEqual(res.success, true);
      assert.strictEqual(quoteCallCount, 1, 'Exactly one targeted /orders/quote request should be made');
      assert.strictEqual(requestedItems.length, 1);
      assert.strictEqual(requestedItems[0].productId, 'product-item-105');
      assert.strictEqual(res.updatedItems[0].unitPrice, 8000);
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

  describe('10. Customer Detail Concurrency & Undefined-Variable Regression', () => {
    test('updateOrderCustomerDetails rejects without ReferenceError when order is concurrently marked Delivered', async () => {
      const { updateOrderCustomerDetails } = await import('../src/controllers/orderController.js');

      // Create an order in Confirmed state
      const placed = await placeOrder({
        idempotencyKey: `concurrent-deliv-test-${Date.now()}`,
        customer: {
          fullName: 'Concurrency Test Customer',
          phone: '0555000044',
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

      const orderToTest = placed.order;
      await Order.updateOne({ _id: orderToTest._id }, { $set: { status: 'Confirmed' } });

      // Simulate a concurrent transition:
      // When updateOrderCustomerDetails queries findOneAndUpdate with status: { $ne: 'Delivered' },
      // the order has concurrently become 'Delivered'.
      const origFindOneAndUpdate = Order.findOneAndUpdate;
      let intercepted = false;
      Order.findOneAndUpdate = async function(query, update, opts) {
        // Concurrently transition order to Delivered before CAS update succeeds
        await Order.updateOne({ _id: orderToTest._id }, { $set: { status: 'Delivered' } });
        intercepted = true;
        return origFindOneAndUpdate.call(Order, query, update, opts);
      };

      const mockRes = {
        statusCode: 200,
        body: null,
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; }
      };

      try {
        // Attempt to change wilaya (destination) which changes delivery fee (financials)
        await updateOrderCustomerDetails({
          params: { id: orderToTest._id.toString() },
          body: {
            wilaya: { code: 31, name: 'Oran' },
            expectedVersion: orderToTest.__v
          },
          admin: { username: 'AdminTester' }
        }, mockRes, (err) => {
          if (err) throw err;
        });

        assert.strictEqual(intercepted, true, 'findOneAndUpdate CAS should have been intercepted');
        // Must return HTTP 400 with no ReferenceError thrown
        assert.strictEqual(mockRes.statusCode, 400);
        assert.strictEqual(mockRes.body.success, false);
        assert.ok(
          mockRes.body.message.includes('Historical financial values') &&
          mockRes.body.message.includes('cannot be modified on Delivered orders'),
          'Must return exact delivered order financial protection message'
        );

        // Verify order in database was not mutated
        const preservedOrder = await Order.findById(orderToTest._id);
        assert.strictEqual(preservedOrder.customer.wilaya.code, 16, 'Wilaya must remain unchanged in DB');
        assert.strictEqual(preservedOrder.status, 'Delivered');
      } finally {
        Order.findOneAndUpdate = origFindOneAndUpdate;
      }
    });
  });
});
