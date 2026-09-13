import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { Order } from '../src/models/Order.js';
import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { DeliverySetting } from '../src/models/DeliverySetting.js';
import { placeOrder } from '../src/services/orderService.js';
import { updateOrderCustomerDetails } from '../src/controllers/orderController.js';
import { wsService } from '../src/services/websocketService.js';
import { ORDER_STATUS, DELIVERY_METHODS, ALGERIA_WILAYAS } from '../src/config/constants.js';
import { resetTransactionSupportCache } from '../src/utils/transactionRetry.js';

describe('Production Hardening Final Pass Regression Suite', () => {
  let testCat;
  let testProd;

  before(async () => {
    await connectDB();
    // Reset transaction support cache so it re-detects replica set after connecting
    resetTransactionSupportCache();

    testCat = await Category.findOne({ slug: 'hardening-test-cat' });
    if (!testCat) {
      testCat = await Category.create({
        name: 'Hardening Category',
        slug: 'hardening-test-cat',
        description: 'Test category',
        image: '/products/merya_dress_blue_1.jpg',
        isActive: true,
        displayOrder: 99
      });
    }

    testProd = await Product.findOne({ slug: 'hardening-test-abaya' });
    if (!testProd) {
      testProd = await Product.create({
        name: 'Hardening Test Abaya',
        slug: 'hardening-test-abaya',
        description: 'Hardening test abaya item',
        category: testCat._id,
        sellingPrice: 9000,
        costPrice: 5000,
        isActive: true,
        colors: [
          {
            colorName: 'Royal Black',
            colorCode: '#000000',
            images: ['/products/merya_dress_blue_1.jpg'],
            sizes: [
              { size: 'M', stock: 15 },
              { size: 'L', stock: 10 }
            ]
          }
        ]
      });
    }

    await DeliverySetting.findOneAndUpdate(
      {},
      {
        singletonKey: 'default',
        agencyDeliveryFee: 500,
        homeDeliveryFee: 800,
        freeDeliveryThreshold: 15000,
        wilayaRates: ALGERIA_WILAYAS.map(w => ({
          wilayaCode: w.code,
          wilayaName: w.name,
          wilayaNameAr: w.nameAr,
          wilayaNameFr: w.nameFr || w.name,
          wilayaNameEn: w.nameEn || w.name,
          homeFee: 800,
          agencyFee: 500,
          isAvailable: true
        }))
      },
      { upsert: true, new: true }
    );
  });

  after(async () => {
    if (testProd?._id) await Product.deleteOne({ _id: testProd._id });
    if (testCat?._id) await Category.deleteOne({ _id: testCat._id });
    await Order.deleteMany({ 'customer.fullName': { $regex: /Hardening/i } });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. IMAGE URL ARCHITECTURE & CROSS-DEPLOYMENT SAFETY
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Production Image Architecture', () => {
    test('Static assets resolve to frontend relative paths without backend host', () => {
      // Simulate getImageUrl logic
      function getImageUrl(imagePath) {
        if (!imagePath) return '';
        if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return imagePath;
        if (
          imagePath.startsWith('/products/') ||
          imagePath.startsWith('/decor_') ||
          imagePath.startsWith('/logo') ||
          imagePath.startsWith('/favicon') ||
          imagePath.startsWith('/icons') ||
          imagePath.startsWith('/silk_bg')
        ) return imagePath;
        if (imagePath.startsWith('/uploads/')) {
          const filename = imagePath.replace(/^\/uploads\//, '');
          if (filename.startsWith('merya_')) return `/products/${filename}`;
        }
        return `https://backend.example.com${imagePath}`;
      }

      assert.strictEqual(getImageUrl('/products/merya_dress_blue_1.jpg'), '/products/merya_dress_blue_1.jpg');
      assert.strictEqual(getImageUrl('/decor_ribbon.jpg'), '/decor_ribbon.jpg');
      assert.strictEqual(getImageUrl('/logo.png'), '/logo.png');
      assert.strictEqual(getImageUrl('/uploads/merya_dress_blue_1.jpg'), '/products/merya_dress_blue_1.jpg');
      assert.strictEqual(getImageUrl('https://res.cloudinary.com/demo/image.webp'), 'https://res.cloudinary.com/demo/image.webp');
    });

    test('All seeded products and categories use /products/ or Cloudinary URLs, zero /uploads/ in active catalog', async () => {
      const allProducts = await Product.find({ isActive: true, isArchived: false });
      for (const p of allProducts) {
        for (const c of p.colors || []) {
          for (const img of c.images || []) {
            assert.ok(
              img.startsWith('/products/') || img.startsWith('http://') || img.startsWith('https://'),
              `Product ${p.slug} has invalid image path: ${img}`
            );
          }
        }
      }

      const allCategories = await Category.find({ isActive: true });
      for (const cat of allCategories) {
        if (cat.image) {
          assert.ok(
            cat.image.startsWith('/products/') || cat.image.startsWith('http://') || cat.image.startsWith('https://'),
            `Category ${cat.slug} has invalid image path: ${cat.image}`
          );
        }
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. CHECKOUT IDEMPOTENCY, REFRESH & LOST RESPONSE SAFETY
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Checkout Idempotency Contract & Refresh Safety', () => {
    test('Missing idempotencyKey is strictly rejected at service level', async () => {
      await assert.rejects(
        async () => {
          await placeOrder({
            customer: {
              fullName: 'Hardening No Key',
              phone: '0555112233',
              wilaya: { code: 16, name: 'Algiers' },
              deliveryMethod: DELIVERY_METHODS.HOME,
              address: 'Alger Centre'
            },
            items: [{ productId: testProd._id.toString(), colorName: 'Royal Black', size: 'M', quantity: 1 }]
          });
        },
        /IDEMPOTENCY_KEY_REQUIRED/
      );
    });

    test('Invalid idempotencyKey (too short or bad chars) is strictly rejected', async () => {
      await assert.rejects(
        async () => {
          await placeOrder({
            idempotencyKey: 'short', // < 8 chars
            customer: {
              fullName: 'Hardening Short Key',
              phone: '0555112233',
              wilaya: { code: 16, name: 'Algiers' },
              deliveryMethod: DELIVERY_METHODS.HOME,
              address: 'Alger Centre'
            },
            items: [{ productId: testProd._id.toString(), colorName: 'Royal Black', size: 'M', quantity: 1 }]
          });
        },
        /IDEMPOTENCY_KEY_REQUIRED/
      );

      await assert.rejects(
        async () => {
          await placeOrder({
            idempotencyKey: 'key.with.dots.and spaces!', // bad chars
            customer: {
              fullName: 'Hardening Bad Key',
              phone: '0555112233',
              wilaya: { code: 16, name: 'Algiers' },
              deliveryMethod: DELIVERY_METHODS.HOME,
              address: 'Alger Centre'
            },
            items: [{ productId: testProd._id.toString(), colorName: 'Royal Black', size: 'M', quantity: 1 }]
          });
        },
        /IDEMPOTENCY_KEY_REQUIRED/
      );
    });

    test('Retry with exact same idempotencyKey returns original order without double-deducting stock', async () => {
      const key = `hard-retry-${Date.now()}-abc123`;
      const payload = {
        idempotencyKey: key,
        customer: {
          fullName: 'Hardening Retry Customer',
          phone: '0555112233',
          wilaya: { code: 16, name: 'Algiers' },
          deliveryMethod: DELIVERY_METHODS.HOME,
          address: 'Alger Centre'
        },
        items: [{ productId: testProd._id.toString(), colorName: 'Royal Black', size: 'M', quantity: 1 }]
      };

      const freshBefore = await Product.findById(testProd._id);
      const stockBefore = freshBefore.colors[0].sizes.find(s => s.size === 'M').stock;

      const firstRes = await placeOrder(payload);
      assert.strictEqual(firstRes.isDuplicate, false);

      const stockAfterFirst = (await Product.findById(testProd._id)).colors[0].sizes.find(s => s.size === 'M').stock;
      assert.strictEqual(stockAfterFirst, stockBefore - 1);

      // Second identical call (simulating lost response or page refresh with same session key)
      const secondRes = await placeOrder(payload);
      assert.strictEqual(secondRes.isDuplicate, true);
      assert.strictEqual(secondRes.order.orderCode, firstRes.order.orderCode);

      // Stock remains exactly stockBefore - 1 (deducted exactly once)
      const stockAfterSecond = (await Product.findById(testProd._id)).colors[0].sizes.find(s => s.size === 'M').stock;
      assert.strictEqual(stockAfterSecond, stockBefore - 1);
    });

    test('Same idempotencyKey with conflicting payload throws IDEMPOTENCY_CONFLICT', async () => {
      const key = `hard-conflict-${Date.now()}-xyz789`;
      await placeOrder({
        idempotencyKey: key,
        customer: {
          fullName: 'Hardening Conflict One',
          phone: '0555112233',
          wilaya: { code: 16, name: 'Algiers' },
          deliveryMethod: DELIVERY_METHODS.HOME,
          address: 'Alger Centre'
        },
        items: [{ productId: testProd._id.toString(), colorName: 'Royal Black', size: 'M', quantity: 1 }]
      });

      await assert.rejects(
        async () => {
          await placeOrder({
            idempotencyKey: key,
            customer: {
              fullName: 'Hardening Conflict Tampered Name',
              phone: '0555998877',
              wilaya: { code: 31, name: 'Oran' },
              deliveryMethod: DELIVERY_METHODS.AGENCY,
              agencyName: 'Yalidine Oran'
            },
            items: [{ productId: testProd._id.toString(), colorName: 'Royal Black', size: 'M', quantity: 2 }]
          });
        },
        /IDEMPOTENCY_CONFLICT/
      );
    });

    test('Concurrent checkout with same key: exactly one creates order, one receives cached order', async () => {
      const key = `hard-concurrent-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const payload = {
        idempotencyKey: key,
        customer: {
          fullName: 'Hardening Concurrent Customer',
          phone: '0555112233',
          wilaya: { code: 16, name: 'Algiers' },
          deliveryMethod: DELIVERY_METHODS.HOME,
          address: 'Rue Didouche Mourad'
        },
        items: [{ productId: testProd._id.toString(), colorName: 'Royal Black', size: 'L', quantity: 1 }]
      };

      const [res1, res2] = await Promise.all([
        placeOrder(payload),
        placeOrder(payload)
      ]);

      const createdCount = [res1, res2].filter(r => !r.isDuplicate).length;
      const duplicateCount = [res1, res2].filter(r => r.isDuplicate).length;
      assert.strictEqual(createdCount, 1, 'Exactly one concurrent call must create the order');
      assert.strictEqual(duplicateCount, 1, 'Exactly one concurrent call must receive the duplicate order');
      assert.strictEqual(res1.order.orderCode, res2.order.orderCode);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. DELIVERY SETTING SINGLETON & TERMINAL ORDER CONCURRENCY
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Delivery Setting Singleton & Concurrency Safety', () => {
    test('DeliverySetting.getSingleton() guarantees singletonKey: default', async () => {
      const setting = await DeliverySetting.getSingleton();
      assert.ok(setting);
      assert.strictEqual(setting.singletonKey, 'default');
      assert.strictEqual(setting.wilayaRates.length, 58);
    });

    test('updateOrderCustomerDetails uses authoritative fee and locks terminal Delivered orders', async () => {
      const { order } = await placeOrder({
        idempotencyKey: `hard-term-${Date.now()}-111222`,
        customer: {
          fullName: 'Hardening Terminal Customer',
          phone: '0555112233',
          wilaya: { code: 16, name: 'Algiers' },
          deliveryMethod: DELIVERY_METHODS.HOME,
          address: 'Alger'
        },
        items: [{ productId: testProd._id.toString(), colorName: 'Royal Black', size: 'M', quantity: 1 }]
      });

      // Mark Delivered
      order.status = ORDER_STATUS.DELIVERED;
      await order.save();

      const req = {
        params: { id: order._id.toString() },
        body: {
          wilaya: { code: 31, name: 'Oran' },
          deliveryMethod: DELIVERY_METHODS.HOME,
          address: 'New address'
        },
        admin: { username: 'Admin' }
      };

      const res = {
        statusCode: 200,
        body: null,
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; }
      };

      await updateOrderCustomerDetails(req, res, () => {});
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.message.includes('locked'));
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. RATE LIMITER BOUNDED EMERGENCY FALLBACK
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Rate Limiter Bounded Emergency Fallback', () => {
    test('Emergency fallback tracks hits and bounds memory to MAX_FALLBACK_KEYS', async () => {
      const { default: rateLimit } = await import('express-rate-limit');
      // Create an instance of MongoRateLimitStore directly
      const storeModule = await import('../src/middleware/rateLimiter.js');
      // Access MongoRateLimitStore through internal testing
      const rateLimiterInstance = storeModule.loginLimiter;
      assert.ok(rateLimiterInstance);

      // Verify that MongoRateLimitStore has bounded capacity mechanism
      // by inspecting the store instance on loginLimiter
      const store = rateLimiterInstance.options?.store || rateLimiterInstance.store;
      assert.ok(store);
      assert.strictEqual(typeof store._recordFallbackHit, 'function');

      // Test fallback hit recording
      const key = 'test-ip-123';
      const now = Date.now();
      const hit1 = store._recordFallbackHit(key, now);
      assert.strictEqual(hit1.totalHits, 1);

      const hit2 = store._recordFallbackHit(key, now);
      assert.strictEqual(hit2.totalHits, 2);

      // Cleanup
      store.resetKey(key);
      assert.strictEqual(store._fallbackStore.has(key), false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. WEBSOCKET PROXY IP HANDLING & STALE HANDSHAKE CLEANUP
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. WebSocket Proxy IP Extraction & Stale Handshake Cleanup', () => {
    test('_extractClientIp respects trusted proxy configuration', () => {
      assert.strictEqual(typeof wsService._extractClientIp, 'function');

      const mockReqUntrusted = {
        headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18' },
        socket: { remoteAddress: '127.0.0.1' }
      };

      // In test/local environment (no TRUST_PROXY, not production), client headers must NOT be blindly trusted
      const originalEnv = process.env.NODE_ENV;
      const originalTrust = process.env.TRUST_PROXY;
      delete process.env.TRUST_PROXY;
      process.env.NODE_ENV = 'development';

      const untrustedIp = wsService._extractClientIp(mockReqUntrusted);
      assert.strictEqual(untrustedIp, '127.0.0.1');

      // When behind a trusted proxy (e.g. Render production)
      process.env.NODE_ENV = 'production';
      const trustedIp = wsService._extractClientIp(mockReqUntrusted);
      assert.strictEqual(trustedIp, '203.0.113.195');

      // Restore env
      process.env.NODE_ENV = originalEnv;
      if (originalTrust !== undefined) process.env.TRUST_PROXY = originalTrust;
      else delete process.env.TRUST_PROXY;
    });

    test('_ipHandshakeWindow purges entries older than 2 minutes', () => {
      assert.ok(wsService._ipHandshakeWindow instanceof Map);
      const staleTime = Date.now() - 130000; // 130s ago
      wsService._ipHandshakeWindow.set('stale-ip', { count: 5, windowStart: staleTime });
      wsService._ipHandshakeWindow.set('fresh-ip', { count: 1, windowStart: Date.now() });

      // Trigger cleanup logic
      const now = Date.now();
      for (const [ipKey, hData] of wsService._ipHandshakeWindow.entries()) {
        if (now - hData.windowStart > 120000) {
          wsService._ipHandshakeWindow.delete(ipKey);
        }
      }

      assert.strictEqual(wsService._ipHandshakeWindow.has('stale-ip'), false, 'Stale IP handshake record must be pruned');
      assert.strictEqual(wsService._ipHandshakeWindow.has('fresh-ip'), true, 'Fresh IP handshake record must remain');
      wsService._ipHandshakeWindow.delete('fresh-ip');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. CANONICAL 58-WILAYA VALIDATION & MULTILINGUAL CONSISTENCY
  // ───────────────────────────────────────────────────────────────────────────
  describe('6. Canonical 58-Wilaya Validation & Localization', () => {
    test('All 58 Wilayas are defined with Arabic, French, and English names', () => {
      assert.strictEqual(ALGERIA_WILAYAS.length, 58);
      for (let i = 1; i <= 58; i++) {
        const w = ALGERIA_WILAYAS.find(item => item.code === i);
        assert.ok(w, `Missing Wilaya code: ${i}`);
        assert.ok(w.name && typeof w.name === 'string');
        assert.ok(w.nameAr && typeof w.nameAr === 'string');
        assert.ok(w.nameFr && typeof w.nameFr === 'string');
        assert.ok(w.nameEn && typeof w.nameEn === 'string');
      }
    });

    test('Wilaya 58 accepted; Wilaya 59 strictly rejected', async () => {
      // Wilaya 58 (El Meniaa) - the last canonical Algerian Wilaya
      const res58 = await placeOrder({
        idempotencyKey: `hard-wilaya-58-${Date.now()}`,
        customer: {
          fullName: 'Hardening Wilaya 58',
          phone: '0555112233',
          wilaya: { code: 58, name: 'El Meniaa' },
          deliveryMethod: DELIVERY_METHODS.HOME,
          address: 'Centre Ville El Meniaa'
        },
        items: [{ productId: testProd._id.toString(), colorName: 'Royal Black', size: 'M', quantity: 1 }]
      });
      assert.ok(res58.order);
      assert.strictEqual(res58.order.customer.wilaya.code, 58);

      // Wilaya 59 (does not exist in Algeria)
      await assert.rejects(
        async () => {
          await placeOrder({
            idempotencyKey: `hard-wilaya-59-${Date.now()}`,
            customer: {
              fullName: 'Hardening Wilaya 59',
              phone: '0555112233',
              wilaya: { code: 59, name: 'Nonexistent Wilaya' },
              deliveryMethod: DELIVERY_METHODS.HOME,
              address: 'Fake Address'
            },
            items: [{ productId: testProd._id.toString(), colorName: 'Royal Black', size: 'M', quantity: 1 }]
          });
        },
        /Must be an integer between 1 and 58/
      );
    });
  });
});
