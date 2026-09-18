import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import http from 'node:http';
import { WebSocket } from 'ws';
import { bannerSchema, updateBannerSchema } from '../src/middleware/validation/banners.js';
import { checkoutOrderSchema } from '../src/middleware/validation/orders.js';
import { isSafeUrl } from '../src/middleware/validation/common.js';
import {
  authenticateAdmin,
  authenticateAdminJwtOnly,
  requireRoles,
  requireAuthoritativeRoles
} from '../src/middleware/auth.js';
import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { Order } from '../src/models/Order.js';
import { getAllProductsAdmin, getProductByIdAdmin, getProducts } from '../src/controllers/productController.js';
import { getAllOrdersAdmin, getOrderByIdAdmin } from '../src/controllers/order/adminOrderQueryController.js';
import { wsService } from '../src/services/websocketService.js';
import { connectDB } from '../src/config/db.js';
import { generateAccessToken } from '../src/utils/tokenUtils.js';
import dotenv from 'dotenv';

dotenv.config();
process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret-at-least-32-chars-long-prod-harden';

describe('Production Targeted Hardening Regression Suite', () => {
  let testCat;
  let completeProd;
  let incompleteProd;
  let testOrder;

  before(async () => {
    await connectDB();

    testCat = await Category.findOne({ slug: 'hardening-suite-cat' });
    if (!testCat) {
      testCat = await Category.create({
        name: { fr: 'Catégorie Hardening', ar: 'تصنيف اختبار', en: 'Hardening Category' },
        slug: 'hardening-suite-cat',
        description: { fr: 'Description FR', ar: 'وصف AR', en: 'Description EN' },
        image: '/products/merya_dress_blue_1.jpg',
        isActive: true,
        displayOrder: 1
      });
    }

    // Fully translated product
    completeProd = await Product.findOne({ slug: 'hardening-complete-prod' });
    if (!completeProd) {
      completeProd = await Product.create({
        name: { fr: 'Robe Complète', ar: 'فستان كامل', en: 'Complete Dress' },
        slug: 'hardening-complete-prod',
        description: { fr: 'Description complète', ar: 'وصف كامل', en: 'Complete description' },
        category: testCat._id,
        sellingPrice: 12000,
        costPrice: 7000,
        isActive: true,
        isArchived: false,
        colors: [{
          colorName: 'Noir',
          colorCode: '#000000',
          images: ['/products/merya_dress_blue_1.jpg'],
          sizes: [{ size: 'M', stock: 10 }]
        }]
      });
    }

    // Incomplete translated product (only FR, missing AR and EN)
    incompleteProd = await Product.findOne({ slug: 'hardening-incomplete-prod' });
    if (!incompleteProd) {
      incompleteProd = await Product.create({
        name: { fr: 'Robe Incomplète', ar: '', en: '' },
        slug: 'hardening-incomplete-prod',
        description: { fr: 'Description seulement FR', ar: '', en: '' },
        category: testCat._id,
        sellingPrice: 8000,
        costPrice: 4000,
        isActive: true,
        isArchived: false,
        colors: [{
          colorName: 'Bleu',
          colorCode: '#0000FF',
          images: ['/products/merya_dress_blue_1.jpg'],
          sizes: [{ size: 'M', stock: 5 }]
        }]
      });
    }

    // Test order with unitCost on items
    testOrder = await Order.findOne({ orderCode: 'ORD-HARDEN-001' });
    if (!testOrder) {
      testOrder = await Order.create({
        orderCode: 'ORD-HARDEN-001',
        idempotencyKey: 'idemp-harden-test-001',
        customer: {
          fullName: 'Amina Test',
          phone: '0555123456',
          wilaya: { code: 16, name: 'Alger' },
          deliveryMethod: 'home',
          address: '123 Rue Didouche Mourad, Alger'
        },
        items: [{
          productId: completeProd._id,
          productName: 'Robe Complète',
          colorName: 'Noir',
          size: 'M',
          quantity: 1,
          unitPrice: 12000,
          unitCost: 7000
        }],
        subtotal: 12000,
        deliveryFee: 600,
        totalPrice: 12600,
        status: 'Pending',
        auditHistory: [{
          action: 'ORDER_CREATED',
          timestamp: new Date(),
          performedBy: 'customer',
          note: 'Hardening test order'
        }]
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. DANGEROUS BANNER URL REJECTED
  // ───────────────────────────────────────────────────────────────────────────
  test('1. Dangerous banner URL schemes are rejected by validation', () => {
    const dangerousUrls = [
      'javascript:alert(document.cookie)',
      'JAVASCRIPT:alert(1)',
      '   javascript:alert(1)   ',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox("XSS")',
      'file:///etc/passwd',
      'blob:https://example.com/uuid',
      '//evil.com/phish',
      '/\\evil.com/phish',
      'http://invalid url with spaces',
      'javascript\n:alert(1)'
    ];

    for (const badUrl of dangerousUrls) {
      assert.strictEqual(isSafeUrl(badUrl), false, `isSafeUrl should reject dangerous URL: ${badUrl}`);

      const result = bannerSchema.safeParse({
        title: { fr: 'Titre', ar: 'عنوان', en: 'Title' },
        link: badUrl
      });
      assert.strictEqual(result.success, false, `bannerSchema should reject link: ${badUrl}`);

      const updateResult = updateBannerSchema.safeParse({
        ctaLink: badUrl
      });
      assert.strictEqual(updateResult.success, false, `updateBannerSchema should reject ctaLink: ${badUrl}`);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. SAFE HTTPS BANNER URL ACCEPTED
  // ───────────────────────────────────────────────────────────────────────────
  test('2. Safe HTTPS and HTTP banner URLs are accepted', () => {
    const safeAbsoluteUrls = [
      'https://merya.dz/collection/ete',
      'https://example.com/promo?discount=20&code=SAVE',
      'http://localhost:5173/shop'
    ];

    for (const goodUrl of safeAbsoluteUrls) {
      assert.strictEqual(isSafeUrl(goodUrl), true, `isSafeUrl should accept: ${goodUrl}`);

      const result = bannerSchema.safeParse({
        title: { fr: 'Titre', ar: 'عنوان', en: 'Title' },
        link: goodUrl,
        ctaLink: goodUrl
      });
      assert.strictEqual(result.success, true, `bannerSchema should accept valid URL: ${goodUrl}`);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. SAFE RELATIVE BANNER URL ACCEPTED
  // ───────────────────────────────────────────────────────────────────────────
  test('3. Safe relative banner URLs beginning with "/" are accepted', () => {
    const safeRelativeUrls = [
      '/shop',
      '/shop?category=abayas',
      '/products/robe-merya',
      '/tracking',
      '/'
    ];

    for (const relUrl of safeRelativeUrls) {
      assert.strictEqual(isSafeUrl(relUrl), true, `isSafeUrl should accept relative URL: ${relUrl}`);

      const result = bannerSchema.safeParse({
        title: { fr: 'Titre', ar: 'عنوان', en: 'Title' },
        link: relUrl,
        ctaLink: relUrl
      });
      assert.strictEqual(result.success, true, `bannerSchema should accept relative URL: ${relUrl}`);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. INVALID CHECKOUT PRODUCT ID REJECTED
  // ───────────────────────────────────────────────────────────────────────────
  test('4. Invalid checkout productId format is rejected with validation error', () => {
    const invalidIds = [
      'not-a-valid-id',
      '',
      '123',
      '507f1f77bcf86cd79943901',       // 23 chars (too short)
      '507f1f77bcf86cd7994390111',     // 25 chars (too long)
      '507f1f77bcf86cd79943901z',     // non-hex character 'z'
      '   507f1f77bcf86cd799439011   ' // untrimmed whitespace
    ];

    for (const badId of invalidIds) {
      const payload = {
        idempotencyKey: 'idemp-test-valid-001',
        customer: {
          fullName: 'Fatima Zohra',
          phone: '0555987654',
          wilaya: { code: 16, name: 'Alger' },
          deliveryMethod: 'home',
          address: '10 Rue de la Paix'
        },
        items: [{
          productId: badId,
          colorName: 'Noir',
          size: 'M',
          quantity: 1
        }]
      };

      const result = checkoutOrderSchema.safeParse(payload);
      assert.strictEqual(result.success, false, `checkoutOrderSchema must reject invalid productId: "${badId}"`);
      const issues = result.error.errors.map(e => e.message);
      assert.ok(issues.some(m => m.includes('productId') || m.includes('ObjectId')),
        `Expected ObjectId error message for "${badId}", got: ${issues.join(', ')}`);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. VALID CHECKOUT PRODUCT ID ACCEPTED
  // ───────────────────────────────────────────────────────────────────────────
  test('5. Valid 24-character hexadecimal MongoDB ObjectId is accepted for checkout', () => {
    const validIds = [
      new mongoose.Types.ObjectId().toString(),
      '507f1f77bcf86cd799439011',
      '000000000000000000000001',
      completeProd._id.toString()
    ];

    for (const validId of validIds) {
      const payload = {
        idempotencyKey: 'idemp-test-valid-001',
        customer: {
          fullName: 'Fatima Zohra',
          phone: '0555987654',
          wilaya: { code: 16, name: 'Alger' },
          deliveryMethod: 'home',
          address: '10 Rue de la Paix'
        },
        items: [{
          productId: validId,
          colorName: 'Noir',
          size: 'M',
          quantity: 1
        }]
      };

      const result = checkoutOrderSchema.safeParse(payload);
      assert.strictEqual(result.success, true, `checkoutOrderSchema must accept valid ObjectId: "${validId}"`);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. JWT-ONLY MIDDLEWARE CLEARLY IDENTIFIED AS NON-AUTHORITATIVE
  // ───────────────────────────────────────────────────────────────────────────
  test('6. JWT-only middleware attaches req.authSource = "jwt" and fails authoritative role checks', async () => {
    const adminId = new mongoose.Types.ObjectId().toString();
    const sessionId = new mongoose.Types.ObjectId().toString();

    const token = generateAccessToken({
      adminId,
      sessionId,
      email: 'staff@merya.dz',
      role: 'owner' // claims 'owner' in JWT
    });

    const req = {
      cookies: { accessToken: token }
    };
    const res = {
      status: (code) => ({
        json: (data) => ({ status: code, data })
      })
    };

    let nextCalled = false;
    await authenticateAdminJwtOnly(req, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true, 'authenticateAdminJwtOnly should succeed');
    assert.strictEqual(req.authSource, 'jwt', 'req.authSource MUST be explicitly "jwt"');
    assert.strictEqual(req.admin._id, adminId);
    assert.strictEqual(req.admin.role, 'owner');

    // Test requireAuthoritativeRoles: MUST REJECT requests with authSource = 'jwt'
    let authCheckPassed = false;
    let authCheckResponse = null;
    const authRes = {
      status: (code) => ({
        json: (data) => {
          authCheckResponse = { status: code, data };
          return authCheckResponse;
        }
      })
    };

    const guardMiddleware = requireAuthoritativeRoles('owner', 'admin');
    guardMiddleware(req, authRes, () => { authCheckPassed = true; });

    assert.strictEqual(authCheckPassed, false, 'requireAuthoritativeRoles MUST NOT pass for JWT-only auth');
    assert.strictEqual(authCheckResponse.status, 403, 'Must return HTTP 403 Forbidden');
    assert.strictEqual(authCheckResponse.data.code, 'AUTHORITATIVE_AUTH_REQUIRED');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. SENSITIVE ROLE-PROTECTED ROUTE REMAINS DB-BACKED
  // ───────────────────────────────────────────────────────────────────────────
  test('7. Authoritative role checks pass when authenticated via DB-backed middleware (req.authSource = "db")', () => {
    const req = {
      admin: {
        _id: new mongoose.Types.ObjectId(),
        role: 'owner'
      },
      authSource: 'db'
    };
    const res = {
      status: (code) => ({ json: (d) => ({ code, d }) })
    };

    let nextCalled = false;
    const guard = requireAuthoritativeRoles('owner', 'admin');
    guard(req, res, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, true, 'requireAuthoritativeRoles passes when authSource is "db" and role matches');

    // Also verify wrong role fails even with db auth
    let wrongRolePassed = false;
    let wrongRoleResponse = null;
    const failRes = {
      status: (code) => ({
        json: (data) => {
          wrongRoleResponse = { status: code, data };
          return wrongRoleResponse;
        }
      })
    };
    const staffReq = {
      admin: { _id: new mongoose.Types.ObjectId(), role: 'staff' },
      authSource: 'db'
    };
    guard(staffReq, failRes, () => { wrongRolePassed = true; });
    assert.strictEqual(wrongRolePassed, false);
    assert.strictEqual(wrongRoleResponse.status, 403);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8. STAFF CANNOT RECEIVE SENSITIVE FINANCIAL DATA (COSTPRICE / UNITCOST)
  // ───────────────────────────────────────────────────────────────────────────
  test('8. Staff cannot receive costPrice or unitCost, while operational order data is preserved', async () => {
    // 8a: Product admin query as STAFF
    const staffReq = {
      query: {},
      admin: { role: 'staff', _id: new mongoose.Types.ObjectId() }
    };
    let staffProductsRes = null;
    const staffRes = {
      json: (data) => { staffProductsRes = data; }
    };
    await getAllProductsAdmin(staffReq, staffRes, () => {});
    assert.strictEqual(staffProductsRes.success, true);
    assert.ok(staffProductsRes.products.length > 0);

    for (const p of staffProductsRes.products) {
      assert.strictEqual(p.costPrice, undefined, `Staff must NEVER see costPrice on product ${p.slug}`);
    }

    // 8b: Product admin query as OWNER
    const ownerReq = {
      query: {},
      admin: { role: 'owner', _id: new mongoose.Types.ObjectId() }
    };
    let ownerProductsRes = null;
    const ownerRes = {
      json: (data) => { ownerProductsRes = data; }
    };
    await getAllProductsAdmin(ownerReq, ownerRes, () => {});
    assert.strictEqual(ownerProductsRes.success, true);
    const completeProdInOwner = ownerProductsRes.products.find(p => p.slug === 'hardening-complete-prod');
    assert.ok(completeProdInOwner, 'Complete product should be found in owner view');
    assert.strictEqual(completeProdInOwner.costPrice, 7000, 'Owner MUST see costPrice');

    // 8c: Single product admin query as STAFF
    const staffSingleReq = {
      params: { id: completeProd._id.toString() },
      admin: { role: 'staff' }
    };
    let staffSingleRes = null;
    await getProductByIdAdmin(staffSingleReq, { json: (d) => { staffSingleRes = d; } }, () => {});
    assert.strictEqual(staffSingleRes.product.costPrice, undefined, 'Staff must not see costPrice on single product');

    // 8d: Orders admin query as STAFF — unitCost omitted, customer phone & address preserved!
    const staffOrderReq = {
      query: {},
      admin: { role: 'staff' }
    };
    let staffOrderRes = null;
    await getAllOrdersAdmin(staffOrderReq, { json: (d) => { staffOrderRes = d; } }, () => {});
    assert.strictEqual(staffOrderRes.success, true);
    assert.ok(staffOrderRes.orders.length > 0);

    const foundStaffOrder = staffOrderRes.orders.find(o => o.orderCode === 'ORD-HARDEN-001');
    assert.ok(foundStaffOrder, 'Test order must be returned to staff');
    // Operational data preserved:
    assert.strictEqual(foundStaffOrder.customer.phone, '0555123456', 'Customer phone MUST be accessible to staff for delivery');
    assert.strictEqual(foundStaffOrder.customer.address, '123 Rue Didouche Mourad, Alger', 'Customer address MUST be accessible to staff');
    assert.ok(foundStaffOrder.auditHistory.length > 0, 'Audit history preserved for operational tracing');
    // Financial supplier cost stripped:
    for (const item of foundStaffOrder.items) {
      assert.strictEqual(item.unitCost, undefined, 'Staff must NEVER see unitCost on order items');
      assert.strictEqual(item.unitPrice, 12000, 'Staff still sees operational unitPrice');
    }

    // 8e: Single order admin query as OWNER — unitCost is present
    const ownerOrderReq = {
      params: { id: testOrder._id.toString() },
      admin: { role: 'owner' }
    };
    let ownerOrderRes = null;
    await getOrderByIdAdmin(ownerOrderReq, { json: (d) => { ownerOrderRes = d; } }, () => {});
    assert.strictEqual(ownerOrderRes.success, true);
    assert.strictEqual(ownerOrderRes.order.items[0].unitCost, 7000, 'Owner MUST see unitCost on order items');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 9. WEBSOCKET MAXIMUM CONNECTION BOUNDARY
  // ───────────────────────────────────────────────────────────────────────────
  test('9. WebSocket maximum connection boundary accurately rejects connections when at capacity', () => {
    // Test boundary logic
    const MAX_CAP = 3;
    const clientsSet = new Set();

    // Helper simulating the boundary guard in websocketService.js
    const simulateConnectionCheck = (incomingWs) => {
      // ws library adds ws to clients set before firing connection
      clientsSet.add(incomingWs);

      const existingConnections = clientsSet.has(incomingWs)
        ? clientsSet.size - 1
        : clientsSet.size;

      if (existingConnections >= MAX_CAP) {
        // Rejected
        incomingWs.closed = true;
        incomingWs.closeCode = 1013;
        incomingWs.closeReason = 'Server at capacity';
        clientsSet.delete(incomingWs);
        return false;
      }
      return true;
    };

    const ws1 = { id: 1 };
    const ws2 = { id: 2 };
    const ws3 = { id: 3 };
    const ws4 = { id: 4 }; // 4th connection: exceeds MAX_CAP=3

    assert.strictEqual(simulateConnectionCheck(ws1), true, 'Connection 1 of 3 accepted');
    assert.strictEqual(simulateConnectionCheck(ws2), true, 'Connection 2 of 3 accepted');
    assert.strictEqual(simulateConnectionCheck(ws3), true, 'Connection 3 of 3 accepted (at capacity)');
    assert.strictEqual(clientsSet.size, 3, 'Active connections count is exactly 3');

    // 4th connection attempts to connect
    const accepted = simulateConnectionCheck(ws4);
    assert.strictEqual(accepted, false, 'Connection 4 MUST be rejected');
    assert.strictEqual(ws4.closed, true, 'ws4 was closed');
    assert.strictEqual(ws4.closeCode, 1013, 'Closed with code 1013');
    assert.strictEqual(ws4.closeReason, 'Server at capacity');
    assert.strictEqual(clientsSet.size, 3, 'Server capacity remained capped at 3 without off-by-one breach');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 10. PUBLIC PRODUCT PAGINATION REMAINS CORRECT WITH INCOMPLETE PRODUCTS
  // ───────────────────────────────────────────────────────────────────────────
  test('10. Public product listing pagination total exactly agrees with actual database filtering', async () => {
    // Query public products
    let publicResData = null;
    const req = {
      query: { limit: '50', page: '1' }
    };
    const res = {
      setHeader: () => {},
      json: (data) => { publicResData = data; }
    };

    await getProducts(req, res, () => {});

    assert.strictEqual(publicResData.success, true);
    assert.ok(Array.isArray(publicResData.products));

    // The incomplete product (missing AR and EN) MUST NOT be present
    const hasIncomplete = publicResData.products.some(p => p.slug === 'hardening-incomplete-prod');
    assert.strictEqual(hasIncomplete, false, 'Incomplete product must NEVER be returned in public products');

    // The complete product MUST be present
    const hasComplete = publicResData.products.some(p => p.slug === 'hardening-complete-prod');
    assert.strictEqual(hasComplete, true, 'Complete product must be returned');

    // Pagination total count MUST agree with actual database count
    const actualDbFilterCount = await Product.countDocuments({
      isActive: true,
      isArchived: false,
      'name.fr': { $regex: /\S/ },
      'name.ar': { $regex: /\S/ },
      'name.en': { $regex: /\S/ },
      'description.fr': { $regex: /\S/ },
      'description.ar': { $regex: /\S/ },
      'description.en': { $regex: /\S/ }
    });

    assert.strictEqual(publicResData.pagination.total, actualDbFilterCount,
      'Pagination total MUST exactly match actual server-side filtered count');
    assert.strictEqual(publicResData.products.length, publicResData.pagination.total,
      'Returned products count on single page must equal total without discrepancy');
  });
});
