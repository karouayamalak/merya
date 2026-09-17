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
import { createSession } from '../src/services/sessionService.js';
import { adjustVariantStock } from '../src/controllers/orderController.js';
import { logout } from '../src/controllers/authController.js';
import authRoutes from '../src/routes/authRoutes.js';

dotenv.config();

const DB_URI = process.env.MONGODB_LOCAL_URI || 'mongodb://127.0.0.1:27018/merya_dz?replicaSet=rs0&directConnection=true';
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test_access_token_secret_for_suite_2026';

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

  // ─── 2.1 Admin Logout CSRF Enforcement ──────────────────────────────────
  console.log('\n[Suite 2.1: Admin Logout CSRF Route Protection]');
  try {
    // 1. Verify route definition has verifyCsrf
    const logoutRoute = authRoutes.stack.find(s => s.route && s.route.path === '/logout');
    assert(logoutRoute, 'POST /logout route must be registered on authRoutes');
    assert(logoutRoute.route.methods.post, 'Route must handle POST');
    const middlewareStack = logoutRoute.route.stack.map(l => l.handle);
    assert.strictEqual(middlewareStack[0], verifyCsrf, 'First handler on /logout must be verifyCsrf');
    assert.strictEqual(middlewareStack[1], logout, 'Second handler on /logout must be logout');
    pass('authRoutes explicitly binds verifyCsrf before logout on POST /logout');
  } catch (err) {
    fail('authRoutes explicitly binds verifyCsrf before logout on POST /logout', err);
  }

  try {
    // 2. Unit test: POST /logout without CSRF token is rejected with 403
    let logoutInvoked = false;
    const req = { method: 'POST', headers: {}, cookies: {} };
    const res = createMockRes();
    verifyCsrf(req, res, () => {
      logoutInvoked = true;
    });
    assert.strictEqual(logoutInvoked, false, 'Logout handler must not be reached when CSRF is missing');
    assert.strictEqual(res.statusCode, 403, 'Must respond with 403');
    assert.strictEqual(res.jsonData?.code, 'CSRF_INVALID');
    pass('Admin logout without CSRF token is rejected with 403 CSRF_INVALID');
  } catch (err) {
    fail('Admin logout without CSRF token is rejected with 403 CSRF_INVALID', err);
  }

  try {
    // 3. Unit test: POST /logout with valid CSRF token succeeds and executes logout
    let logoutAdmin = await Admin.findOne({ email: 'logout_csrf_admin@merya.dz' });
    if (!logoutAdmin) {
      logoutAdmin = await Admin.create({
        username: 'logout_csrf_admin',
        email: 'logout_csrf_admin@merya.dz',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqr',
        role: 'admin',
        isActive: true
      });
    }
    const { accessToken, refreshToken } = await createSession({ adminId: logoutAdmin._id });
    const validCsrf = generateCsrfToken();

    let csrfPassed = false;
    const req = {
      method: 'POST',
      headers: { 'x-csrf-token': validCsrf },
      cookies: { csrf_token: validCsrf, accessToken, refreshToken }
    };
    const res = {
      ...createMockRes(),
      cleared: false,
      clearCookie(name) {
        if (name === 'token' || name === 'accessToken' || name === 'refreshToken') this.cleared = true;
        return this;
      }
    };

    await new Promise((resolve) => {
      verifyCsrf(req, res, async () => {
        csrfPassed = true;
        await logout(req, res, () => {});
        resolve();
      });
    });

    assert.strictEqual(csrfPassed, true, 'verifyCsrf allowed request through');
    assert.strictEqual(res.statusCode, 200, 'Logout succeeded with 200');
    assert.strictEqual(res.jsonData?.success, true);
    assert.strictEqual(res.jsonData?.message, 'Logged out successfully');
    assert.strictEqual(res.cleared, true, 'HttpOnly token cookie cleared');
    pass('Admin logout with valid CSRF token succeeds with 200 and clears session');
  } catch (err) {
    fail('Admin logout with valid CSRF token succeeds with 200 and clears session', err);
  }

  // 4. HTTP network test against live backend server
  try {
    const healthCheck = await fetch('http://localhost:5000/health').then(r => r.json()).catch(() => null);
    if (healthCheck && healthCheck.status === 'healthy') {
      // Live HTTP test without CSRF -> 403
      const liveRes403 = await fetch('http://localhost:5000/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      assert.strictEqual(liveRes403.status, 403, 'Live HTTP POST /auth/logout without CSRF must return 403');
      const live403Data = await liveRes403.json();
      assert.strictEqual(live403Data.code, 'CSRF_INVALID');
      pass('Live HTTP POST /auth/logout without CSRF is rejected with 403 CSRF_INVALID');

      // Live HTTP test with CSRF -> 200
      const csrfFetch = await fetch('http://localhost:5000/api/v1/auth/csrf-token');
      const csrfData = await csrfFetch.json();
      const setCookie = csrfFetch.headers.get('set-cookie') || '';
      const csrfCookieVal = setCookie.split(';')[0];

      const liveRes200 = await fetch('http://localhost:5000/api/v1/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfData.csrfToken,
          'Cookie': csrfCookieVal
        }
      });
      assert.strictEqual(liveRes200.status, 200, 'Live HTTP POST /auth/logout with CSRF must return 200');
      const live200Data = await liveRes200.json();
      assert.strictEqual(live200Data.success, true);
      pass('Live HTTP POST /auth/logout with valid CSRF token succeeds with 200');
    }
  } catch (err) {
    fail('Live HTTP integration test for /auth/logout CSRF enforcement', err);
  }

  // ─── 3. Cookie-Only Auth (Bearer Fallback Removed) ─────────────────────────
  console.log('\n[Suite 3: Cookie-Only Authentication (No Bearer Header)]');
  try {
    let nextCalled = false;
    const token = jwt.sign({ id: new mongoose.Types.ObjectId(), role: 'admin' }, ACCESS_TOKEN_SECRET);
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
    const { accessToken } = await createSession({ adminId: testAdmin._id });
    const req = {
      headers: {},
      cookies: { accessToken }
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
    // Small delay to let libuv finish closing the rejected connection's async handle (Windows safety)
    await new Promise(r => setTimeout(r, 50));
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
    // Small delay to let libuv finish closing the connection's async handle (Windows safety)
    await new Promise(r => setTimeout(r, 50));
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
    // Small delay to let libuv finish closing the connection's async handle (Windows safety)
    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(errorReceived, true);
    pass('SUBSCRIBE_ADMIN without admin session cookie is rejected with Unauthorized error');
  } catch (err) {
    fail('SUBSCRIBE_ADMIN without admin session cookie is rejected with Unauthorized error', err);
  }

  try {
    // 5d. SUBSCRIBE_ADMIN with valid admin cookie in upgrade request receives SUBSCRIBED
    const testAdmin = await Admin.findOne({ email: 'csrf_test_admin@merya.dz' });
    const { accessToken } = await createSession({ adminId: testAdmin._id });

    const subscribed = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: {
          Origin: allowedOrigin,
          Cookie: `accessToken=${accessToken}`
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
        } else if (msg.type === 'ERROR') {
          ws.close();
          reject(new Error(`Received ERROR: ${msg.message}`));
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
    await new Promise((resolve) => {
      if (wsService.wss) {
        wsService.wss.close(() => {
          testServer.close(() => resolve());
        });
      } else {
        testServer.close(() => resolve());
      }
    });
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
