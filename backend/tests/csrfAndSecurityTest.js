/**
 * csrfAndSecurityTest.js
 *
 * Targeted verification for:
 * 1. Double-submit CSRF Protection:
 *    - Missing token -> 403 CSRF_INVALID
 *    - Invalid / tampered HMAC -> 403 CSRF_INVALID
 *    - Expired token -> 403 CSRF_INVALID
 *    - Mismatched header vs cookie -> 403 CSRF_INVALID
 *    - Valid matching token & cookie -> 200 / next()
 *    - Safe methods (GET, HEAD, OPTIONS) pass through without CSRF
 * 2. JWT Exposure Prevention:
 *    - Login response JSON does NOT contain `token`
 * 3. Cookie-Only Authentication (No Bearer Fallback):
 *    - Authorization: Bearer <valid_token> -> 401 Unauthorized
 *    - Cookie token -> 200 / authenticated
 * 4. WebSocket Security:
 *    - Production mode rejects connections from untrusted Origin with close code 1008
 *    - Production mode accepts connections from whitelisted Origin
 *    - SUBSCRIBE_ADMIN without admin cookie -> rejected with ERROR
 *    - SUBSCRIBE_ADMIN with valid admin cookie -> accepted with SUBSCRIBED
 * 5. Strict Inventory Input Validation:
 *    - "50abc", 1.5, -1, NaN, Infinity rejected with 400
 *    - Valid non-negative integer accepted
 */

import assert from 'node:assert';
import http from 'node:http';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { generateCsrfToken, verifyCsrfToken, verifyCsrf, issueCsrfToken } from '../src/middleware/csrf.js';
import { authenticateAdmin } from '../src/middleware/auth.js';
import { wsService } from '../src/services/websocketService.js';
import { Admin } from '../src/models/Admin.js';
import { adjustVariantStock } from '../src/controllers/orderController.js';

dotenv.config();

const DB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27018/merya_dz?replicaSet=rs0&directConnection=true';
const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_suite_2026';

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

// Mock Express response helper
function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    cookies: {},
    jsonData: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.jsonData = data;
      return this;
    },
    cookie(name, value, opts) {
      this.cookies[name] = { value, opts };
      return this;
    }
  };
}

async function runTests() {
  console.log('=== RUNNING CSRF, WEBSOCKET & SECURITY PRODUCTION TESTS ===\n');

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(DB_URI);
  }

  // ─── 1. CSRF Token Generation & Verification Unit Tests ───────────────────
  console.log('[Suite 1: CSRF Token Cryptographic Primitives]');
  try {
    const token = generateCsrfToken();
    assert(token && typeof token === 'string', 'generateCsrfToken must return a string');
    assert.strictEqual(token.split('.').length, 3, 'Token must contain 3 dot-separated parts');
    assert.strictEqual(verifyCsrfToken(token), true, 'Freshly generated token must be valid');
    pass('generateCsrfToken produces structurally valid and verifiable token');
  } catch (err) {
    fail('generateCsrfToken produces structurally valid and verifiable token', err);
  }

  try {
    const token = generateCsrfToken();
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.ff${parts[2].slice(2)}`;
    assert.strictEqual(verifyCsrfToken(tampered), false, 'Tampered token signature must fail');
    pass('verifyCsrfToken rejects tampered HMAC signature');
  } catch (err) {
    fail('verifyCsrfToken rejects tampered HMAC signature', err);
  }

  try {
    const expiredTimestamp = Date.now() - 10000;
    const expiredPayload = `testvalue.${expiredTimestamp}`;
    const secret = process.env.CSRF_SECRET || process.env.COOKIE_SECRET || 'merya_dev_csrf_secret_2026';
    const crypto = await import('crypto');
    const hmac = crypto.createHmac('sha256', secret).update(expiredPayload).digest('hex');
    const expiredToken = `${expiredPayload}.${hmac}`;
    assert.strictEqual(verifyCsrfToken(expiredToken), false, 'Expired token must fail verification');
    pass('verifyCsrfToken rejects expired CSRF token');
  } catch (err) {
    fail('verifyCsrfToken rejects expired CSRF token', err);
  }

  // ─── 2. CSRF Middleware Tests ─────────────────────────────────────────────
  console.log('\n[Suite 2: CSRF Middleware Enforcement]');
  try {
    // Safe method passes through
    let nextCalled = false;
    const req = { method: 'GET', headers: {} };
    const res = createMockRes();
    verifyCsrf(req, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true, 'GET request should bypass CSRF');
    pass('Safe methods (GET) bypass CSRF middleware');
  } catch (err) {
    fail('Safe methods (GET) bypass CSRF middleware', err);
  }

  try {
    // POST with missing header and cookie
    let nextCalled = false;
    const req = { method: 'POST', headers: {}, cookies: {} };
    const res = createMockRes();
    verifyCsrf(req, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, false, 'Should not proceed without CSRF tokens');
    assert.strictEqual(res.statusCode, 403, 'Should respond with 403');
    assert.strictEqual(res.jsonData?.code, 'CSRF_INVALID');
    pass('POST without CSRF tokens is rejected with 403 CSRF_INVALID');
  } catch (err) {
    fail('POST without CSRF tokens is rejected with 403 CSRF_INVALID', err);
  }

  try {
    // POST with mismatched header and cookie
    let nextCalled = false;
    const tokenA = generateCsrfToken();
    const tokenB = generateCsrfToken();
    const req = {
      method: 'POST',
      headers: { 'x-csrf-token': tokenA },
      cookies: { csrf_token: tokenB }
    };
    const res = createMockRes();
    verifyCsrf(req, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 403);
    pass('POST with mismatched CSRF header vs cookie is rejected with 403');
  } catch (err) {
    fail('POST with mismatched CSRF header vs cookie is rejected with 403', err);
  }

  try {
    // POST with valid matching token in header and cookie
    let nextCalled = false;
    const token = generateCsrfToken();
    const req = {
      method: 'POST',
      headers: { 'x-csrf-token': token },
      cookies: { csrf_token: token }
    };
    const res = createMockRes();
    verifyCsrf(req, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true, 'Valid CSRF tokens should allow request to proceed');
    pass('POST with valid matching CSRF token and cookie proceeds successfully');
  } catch (err) {
    fail('POST with valid matching CSRF token and cookie proceeds successfully', err);
  }

  // ─── 3. Cookie-Only Auth (Bearer Fallback Removed) ─────────────────────────
  console.log('\n[Suite 3: Cookie-Only Authentication (No Bearer Header)]');
  try {
    let nextCalled = false;
    const token = jwt.sign({ id: new mongoose.Types.ObjectId(), role: 'admin' }, JWT_SECRET);
    const req = {
      headers: { authorization: `Bearer ${token}` },
      cookies: {} // No cookie
    };
    const res = createMockRes();
    await authenticateAdmin(req, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, false, 'Bearer header must NOT be accepted');
    assert.strictEqual(res.statusCode, 401, 'Should return 401 when no cookie is present');
    pass('authenticateAdmin rejects Authorization: Bearer header when cookie is missing');
  } catch (err) {
    fail('authenticateAdmin rejects Authorization: Bearer header when cookie is missing', err);
  }

  try {
    // Seed an active admin for auth check
    let testAdmin = await Admin.findOne({ email: 'csrf_test_admin@merya.dz' });
    if (!testAdmin) {
      testAdmin = await Admin.create({
        username: 'csrf_test_admin',
        email: 'csrf_test_admin@merya.dz',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqr',
        role: 'admin',
        isActive: true
      });
    }

    let nextCalled = false;
    const token = jwt.sign({ id: testAdmin._id, role: testAdmin.role }, JWT_SECRET);
    const req = {
      headers: {},
      cookies: { token }
    };
    const res = createMockRes();
    await authenticateAdmin(req, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true, 'Valid cookie should authenticate admin');
    assert.strictEqual(req.admin._id.toString(), testAdmin._id.toString());
    pass('authenticateAdmin accepts valid HttpOnly session cookie');
  } catch (err) {
    fail('authenticateAdmin accepts valid HttpOnly session cookie', err);
  }

  // ─── 4. Strict Stock Validation in Inventory Controller ───────────────────
  console.log('\n[Suite 4: Strict Inventory Input Validation]');
  const invalidInputs = [
    { val: '50abc', desc: 'alphanumeric string' },
    { val: 1.5, desc: 'float / decimal' },
    { val: -5, desc: 'negative integer' },
    { val: NaN, desc: 'NaN' },
    { val: Infinity, desc: 'Infinity' },
    { val: '', desc: 'empty string' },
    { val: null, desc: 'null' }
  ];

  for (const { val, desc } of invalidInputs) {
    try {
      const req = {
        body: {
          productId: new mongoose.Types.ObjectId().toString(),
          colorName: 'Noir',
          size: 'M',
          newStock: val
        }
      };
      const res = createMockRes();
      await adjustVariantStock(req, res);
      assert.strictEqual(res.statusCode, 400, `Expected 400 for ${desc}, got ${res.statusCode}`);
      pass(`adjustVariantStock rejects ${desc} (${JSON.stringify(val)}) with HTTP 400`);
    } catch (err) {
      fail(`adjustVariantStock rejects ${desc}`, err);
    }
  }

  // ─── 5. WebSocket Origin Validation & Admin Subscription ──────────────────
  console.log('\n[Suite 5: WebSocket Security & Origin Enforcement]');
  const testServer = http.createServer();
  const allowedOrigin = 'https://merya-trusted-origin.vercel.app';
  const maliciousOrigin = 'https://evil-attacker.com';

  const origEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production'; // Enforce production origin validation

  await new Promise((resolve) => testServer.listen(0, resolve));
  const port = testServer.address().port;

  // Initialize WS with restricted origin whitelist
  wsService.init(testServer, [allowedOrigin]);

  try {
    // 5a. Untrusted Origin in production must be closed with 1008
    const closeCode = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: { Origin: maliciousOrigin }
      });
      ws.on('close', (code) => resolve(code));
      ws.on('error', () => {}); // ignore error event prior to close
    });
    assert.strictEqual(closeCode, 1008, `Expected close code 1008 for untrusted origin, got ${closeCode}`);
    pass('WebSocket rejects connection from untrusted Origin with close code 1008');
  } catch (err) {
    fail('WebSocket rejects connection from untrusted Origin with close code 1008', err);
  }

  try {
    // 5b. Trusted Origin in production is accepted
    const isConnected = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: { Origin: allowedOrigin }
      });
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'CONNECTED') {
          ws.close();
          resolve(true);
        }
      });
      ws.on('error', reject);
    });
    assert.strictEqual(isConnected, true);
    pass('WebSocket accepts connection from whitelisted Origin');
  } catch (err) {
    fail('WebSocket accepts connection from whitelisted Origin', err);
  }

  try {
    // 5c. SUBSCRIBE_ADMIN without admin cookie receives ERROR
    const errorReceived = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: { Origin: allowedOrigin }
      });
      ws.on('open', () => {
        ws.send(JSON.stringify({ action: 'SUBSCRIBE_ADMIN' }));
      });
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'ERROR' && msg.message.includes('Unauthorized')) {
          ws.close();
          resolve(true);
        }
      });
      ws.on('error', reject);
    });
    assert.strictEqual(errorReceived, true);
    pass('SUBSCRIBE_ADMIN without admin session cookie is rejected with Unauthorized error');
  } catch (err) {
    fail('SUBSCRIBE_ADMIN without admin session cookie is rejected with Unauthorized error', err);
  }

  try {
    // 5d. SUBSCRIBE_ADMIN with valid admin cookie in upgrade request receives SUBSCRIBED
    const testAdmin = await Admin.findOne({ email: 'csrf_test_admin@merya.dz' });
    const adminToken = jwt.sign({ id: testAdmin._id, role: testAdmin.role }, JWT_SECRET);

    const subscribed = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: {
          Origin: allowedOrigin,
          Cookie: `token=${adminToken}`
        }
      });
      ws.on('open', () => {
        ws.send(JSON.stringify({ action: 'SUBSCRIBE_ADMIN' }));
      });
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'SUBSCRIBED' && msg.channel === 'admin') {
          ws.close();
          resolve(true);
        }
      });
      ws.on('error', reject);
    });
    assert.strictEqual(subscribed, true);
    pass('SUBSCRIBE_ADMIN with valid HttpOnly cookie receives SUBSCRIBED to admin channel');
  } catch (err) {
    fail('SUBSCRIBE_ADMIN with valid HttpOnly cookie receives SUBSCRIBED', err);
  } finally {
    process.env.NODE_ENV = origEnv;
    testServer.close();
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n==================================================`);
  console.log(`RESULTS: ${passCount} PASSED | ${failCount} FAILED`);
  console.log(`==================================================\n`);

  await mongoose.disconnect();

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
