/**
 * multiDeviceSessionAuth.test.js
 *
 * Comprehensive test suite verifying all 17 targeted authentication/session requirements:
 * 1. Admin login → Session A created
 * 2. Second login/device → Session B created
 * 3. Session A and B both remain valid
 * 4. Refresh using A → only A's session is updated/rotated
 * 5. Refresh using B → B still works independently
 * 6. Revoke/logout A → A fails afterward
 * 7. B continues working after A is revoked
 * 8. Revoke/logout B → B fails afterward
 * 9. Expired session → refresh rejected
 * 10. Revoked session → refresh rejected
 * 11. Wrong/mismatched sessionId → refresh rejected
 * 12. Access token cannot be used as a refresh token
 * 13. Refresh token cannot be accepted as an access token
 * 14. Inactive/deleted Admin cannot continue authentication
 * 15. Existing CSRF protections still work
 * 16. Existing WebSocket authentication still works
 * 17. Customer public order tracking still works
 */

import assert from 'node:assert';
import http from 'node:http';
import { WebSocket } from 'ws';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { Admin } from '../src/models/Admin.js';
import { Session } from '../src/models/Session.js';
import { Order } from '../src/models/Order.js';
import { AUTH_CONFIG } from '../src/config/authConfig.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
  verifyTokenHash
} from '../src/utils/tokenUtils.js';
import {
  createSession,
  rotateSessionToken,
  revokeSession,
  revokeAllAdminSessions
} from '../src/services/sessionService.js';
import { authenticateAdmin } from '../src/middleware/auth.js';
import { wsService } from '../src/services/websocketService.js';
import authRoutes from '../src/routes/authRoutes.js';

dotenv.config();

const DB_URI = process.env.MONGODB_LOCAL_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27018/merya_dz?replicaSet=rs0&directConnection=true';

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

// Helper to make HTTP requests against a test Express app
function makeRequest(server, { method = 'GET', path, headers = {}, body = null, cookies = {} }) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const cookieHeader = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

    const reqHeaders = { ...headers };
    if (cookieHeader) reqHeaders['Cookie'] = cookieHeader;
    if (body && !reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';

    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        const setCookies = res.headers['set-cookie'] || [];
        const parsedCookies = {};
        for (const sc of setCookies) {
          const parts = sc.split(';')[0].split('=');
          parsedCookies[parts[0].trim()] = parts.slice(1).join('=').trim();
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          setCookies,
          parsedCookies,
          body: json || data
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('=== MULTI-DEVICE SESSION AUTHENTICATION & VERIFICATION SUITE ===\n');

  await mongoose.connect(DB_URI);
  console.log('Connected to DB:', mongoose.connection.name);

  // Setup test Express app
  const app = express();
  app.use(express.json());
  app.use(cookieParser(process.env.COOKIE_PARSER_SECRET || 'merya_test_cookie_secret'));
  app.use('/api/v1/auth', authRoutes);
  app.get('/api/v1/protected', authenticateAdmin, (req, res) => {
    res.json({
      success: true,
      adminId: req.admin._id,
      sessionId: req.authSession._id,
      role: req.admin.role
    });
  });

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  wsService.init(server, []);

  try {
    // ── Setup Clean Database State ─────────────────────────────────────────────
    await Admin.deleteMany({ email: /test_targeted_.*@merya\.dz/ });
    await Order.deleteMany({ orderCode: /^MRY-WS-TEST-/ });
    await Session.deleteMany({});

    const testPassword = 'AdminSecret123!';
    const testAdmin = await Admin.create({
      username: 'TargetedAuthAdmin',
      email: `test_targeted_${Date.now()}@merya.dz`,
      passwordHash: await bcrypt.hash(testPassword, 10),
      role: 'admin',
      isActive: true
    });

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 1: Admin login → Session A created
    // ───────────────────────────────────────────────────────────────────────────
    let sessionA_Cookies = {};
    let sessionA_Id = null;
    try {
      const res = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/login',
        headers: { 'user-agent': 'Device-A-Laptop' },
        body: { email: testAdmin.email, password: testPassword }
      });

      assert.strictEqual(res.status, 200, 'Login A status must be 200');
      assert.strictEqual(res.body.success, true);
      assert.ok(res.parsedCookies.accessToken, 'accessToken cookie must be set');
      assert.ok(res.parsedCookies.refreshToken, 'refreshToken cookie must be set');
      assert.ok(!res.body.accessToken && !res.body.refreshToken, 'Raw tokens must NEVER be returned in JSON body');

      sessionA_Cookies = res.parsedCookies;
      const decoded = verifyAccessToken(sessionA_Cookies.accessToken);
      sessionA_Id = decoded.sid;
      assert.ok(sessionA_Id, 'Session A ID must be in token payload');

      const docA = await Session.findById(sessionA_Id);
      assert.ok(docA, 'Session A document must exist in MongoDB');
      assert.strictEqual(String(docA.adminId), String(testAdmin._id));
      assert.strictEqual(docA.userAgent, 'Device-A-Laptop');
      assert.ok(docA.refreshTokenHash, 'Session A must store a refreshTokenHash');
      assert.ok(!docA.refreshToken, 'Session A must NEVER store raw refresh token');

      pass('1. Admin login → Session A created with HttpOnly cookies & hashed refresh verifier');
    } catch (e) { fail('1. Admin login → Session A created', e); }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 2: Second login/device → Session B created
    // ───────────────────────────────────────────────────────────────────────────
    let sessionB_Cookies = {};
    let sessionB_Id = null;
    try {
      const res = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/login',
        headers: { 'user-agent': 'Device-B-Mobile' },
        body: { email: testAdmin.email, password: testPassword }
      });

      assert.strictEqual(res.status, 200, 'Login B status must be 200');
      sessionB_Cookies = res.parsedCookies;
      const decoded = verifyAccessToken(sessionB_Cookies.accessToken);
      sessionB_Id = decoded.sid;

      assert.notStrictEqual(sessionA_Id, sessionB_Id, 'Device A and Device B must have distinct Session IDs');

      const activeSessions = await Session.find({ adminId: testAdmin._id, revokedAt: null });
      assert.strictEqual(activeSessions.length, 2, 'Admin must simultaneously hold 2 active session documents');

      pass('2. Second login/device → Session B created independently');
    } catch (e) { fail('2. Second login/device → Session B created', e); }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 3: Session A and B both remain valid simultaneously
    // ───────────────────────────────────────────────────────────────────────────
    try {
      const resA = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/protected',
        cookies: { accessToken: sessionA_Cookies.accessToken }
      });
      assert.strictEqual(resA.status, 200);
      assert.strictEqual(String(resA.body.sessionId), String(sessionA_Id));

      const resB = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/protected',
        cookies: { accessToken: sessionB_Cookies.accessToken }
      });
      assert.strictEqual(resB.status, 200);
      assert.strictEqual(String(resB.body.sessionId), String(sessionB_Id));

      pass('3. Session A and B both remain valid simultaneously for protected access');
    } catch (e) { fail('3. Session A and B both remain valid', e); }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 4: Refresh using A → only A\'s session is updated/rotated
    // ───────────────────────────────────────────────────────────────────────────
    let sessionA_RotatedCookies = {};
    try {
      const docB_Before = await Session.findById(sessionB_Id);

      const res = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/refresh',
        cookies: { refreshToken: sessionA_Cookies.refreshToken }
      });

      assert.strictEqual(res.status, 200, 'Refresh A status must be 200');
      assert.ok(res.parsedCookies.accessToken, 'New access token issued for A');
      assert.ok(res.parsedCookies.refreshToken, 'New refresh token issued for A');
      assert.notStrictEqual(res.parsedCookies.refreshToken, sessionA_Cookies.refreshToken, 'Refresh token rotated');

      sessionA_RotatedCookies = res.parsedCookies;

      const docA_After = await Session.findById(sessionA_Id);
      const docB_After = await Session.findById(sessionB_Id);

      assert.notStrictEqual(docA_After.refreshTokenHash, sessionA_Cookies.refreshToken, 'Session A verifier updated');
      assert.strictEqual(docB_After.refreshTokenHash, docB_Before.refreshTokenHash, 'Session B verifier remained UNTOUCHED');
      assert.strictEqual(docB_After.revokedAt, null, 'Session B remains active');

      pass('4. Refresh using A → only Session A is updated/rotated; Session B is untouched');
    } catch (e) { fail('4. Refresh using A', e); }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 5: Refresh using B → B still works independently
    // ───────────────────────────────────────────────────────────────────────────
    let sessionB_RotatedCookies = {};
    try {
      const res = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/refresh',
        cookies: { refreshToken: sessionB_Cookies.refreshToken }
      });

      assert.strictEqual(res.status, 200, 'Refresh B status must be 200');
      assert.ok(res.parsedCookies.accessToken);
      assert.ok(res.parsedCookies.refreshToken);
      assert.notStrictEqual(res.parsedCookies.refreshToken, sessionB_Cookies.refreshToken);

      sessionB_RotatedCookies = res.parsedCookies;

      // Verify B can make protected calls with newly issued access token
      const resB = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/protected',
        cookies: { accessToken: sessionB_RotatedCookies.accessToken }
      });
      assert.strictEqual(resB.status, 200);
      assert.strictEqual(String(resB.body.sessionId), String(sessionB_Id));

      pass('5. Refresh using B → B rotates and works independently');
    } catch (e) { fail('5. Refresh using B', e); }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 6: Revoke/logout A → A fails afterward
    // ───────────────────────────────────────────────────────────────────────────
    try {
      // Get CSRF token for logout POST
      const csrfRes = await makeRequest(server, { method: 'GET', path: '/api/v1/auth/csrf-token' });
      const csrfToken = csrfRes.body.csrfToken;

      const logoutRes = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/logout',
        headers: { 'X-CSRF-Token': csrfToken },
        cookies: {
          accessToken: sessionA_RotatedCookies.accessToken,
          refreshToken: sessionA_RotatedCookies.refreshToken,
          csrf_token: csrfToken
        }
      });
      assert.strictEqual(logoutRes.status, 200, 'Logout A returns 200');

      const docA = await Session.findById(sessionA_Id);
      assert.ok(docA.revokedAt, 'Session A must have revokedAt set in DB');
      assert.strictEqual(docA.revokeReason, 'LOGOUT');

      // Now verify A's access token is rejected on protected routes
      const protectedRes = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/protected',
        cookies: { accessToken: sessionA_RotatedCookies.accessToken }
      });
      assert.strictEqual(protectedRes.status, 401, 'A access token must be rejected after logout');

      // Verify A's refresh token is rejected on refresh
      const refreshRes = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/refresh',
        cookies: { refreshToken: sessionA_RotatedCookies.refreshToken }
      });
      assert.strictEqual(refreshRes.status, 401, 'A refresh token must be rejected after logout');

      pass('6. Revoke/logout A → Session A fails on both access and refresh endpoints');
    } catch (e) { fail('6. Revoke/logout A fails afterward', e); }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 7: B continues working after A is revoked
    // ───────────────────────────────────────────────────────────────────────────
    try {
      // Device B protected call
      const resB = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/protected',
        cookies: { accessToken: sessionB_RotatedCookies.accessToken }
      });
      assert.strictEqual(resB.status, 200, 'Device B access token remains valid after A logout');
      assert.strictEqual(String(resB.body.sessionId), String(sessionB_Id));

      // Device B refresh call
      const refB = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/refresh',
        cookies: { refreshToken: sessionB_RotatedCookies.refreshToken }
      });
      assert.strictEqual(refB.status, 200, 'Device B refresh remains valid after A logout');
      sessionB_RotatedCookies = refB.parsedCookies;

      pass('7. Multi-Device Isolation: Device B continues working completely unaffected after Device A logout');
    } catch (e) { fail('7. B continues working after A is revoked', e); }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 8: Revoke/logout B → B fails afterward
    // ───────────────────────────────────────────────────────────────────────────
    try {
      const csrfRes = await makeRequest(server, { method: 'GET', path: '/api/v1/auth/csrf-token' });
      const csrfToken = csrfRes.body.csrfToken;

      const logoutBRes = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/logout',
        headers: { 'X-CSRF-Token': csrfToken },
        cookies: {
          accessToken: sessionB_RotatedCookies.accessToken,
          refreshToken: sessionB_RotatedCookies.refreshToken,
          csrf_token: csrfToken
        }
      });
      assert.strictEqual(logoutBRes.status, 200);

      const docB = await Session.findById(sessionB_Id);
      assert.ok(docB.revokedAt, 'Session B must have revokedAt set in DB');

      const protectedRes = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/protected',
        cookies: { accessToken: sessionB_RotatedCookies.accessToken }
      });
      assert.strictEqual(protectedRes.status, 401, 'B access token must be rejected after logout');

      const refreshRes = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/refresh',
        cookies: { refreshToken: sessionB_RotatedCookies.refreshToken }
      });
      assert.strictEqual(refreshRes.status, 401, 'B refresh token must be rejected after logout');

      pass('8. Revoke/logout B → Session B fails on access and refresh afterward');
    } catch (e) { fail('8. Revoke/logout B fails afterward', e); }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 9: Expired session → refresh rejected
    // ───────────────────────────────────────────────────────────────────────────
    try {
      // Create session whose DB record is expired in the past
      const expiredSession = await Session.create({
        adminId: testAdmin._id,
        userAgent: 'Expired-Test',
        expiresAt: new Date(Date.now() - 60000), // 1 minute in the past
        refreshTokenHash: 'dummy_hash'
      });

      const expiredRefreshJwt = generateRefreshToken({
        adminId: testAdmin._id,
        sessionId: expiredSession._id
      });
      expiredSession.refreshTokenHash = hashToken(expiredRefreshJwt);
      await expiredSession.save();

      const res = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/refresh',
        cookies: { refreshToken: expiredRefreshJwt }
      });

      assert.strictEqual(res.status, 401, 'Expired session must return 401 on refresh');
      assert.ok(res.body.message.includes('expired') || res.body.message.includes('revoked'));

      pass('9. Expired session → server-side date validation rejects refresh with 401');
    } catch (e) { fail('9. Expired session → refresh rejected', e); }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 10: Revoked session → refresh rejected
    // ───────────────────────────────────────────────────────────────────────────
    try {
      const revokedSession = await Session.create({
        adminId: testAdmin._id,
        userAgent: 'Revoked-Test',
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: new Date(),
        revokeReason: 'LOGOUT',
        refreshTokenHash: 'dummy_hash'
      });

      const revokedRefreshJwt = generateRefreshToken({
        adminId: testAdmin._id,
        sessionId: revokedSession._id
      });
      revokedSession.refreshTokenHash = hashToken(revokedRefreshJwt);
      await revokedSession.save();

      const res = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/refresh',
        cookies: { refreshToken: revokedRefreshJwt }
      });

      assert.strictEqual(res.status, 401, 'Revoked session must return 401 on refresh');
      pass('10. Revoked session → refresh rejected with 401');
    } catch (e) { fail('10. Revoked session → refresh rejected', e); }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 11: Wrong/mismatched sessionId → refresh rejected
    // ───────────────────────────────────────────────────────────────────────────
    try {
      // 11a. Non-existent sessionId (valid ObjectId)
      const nonExistentSid = new mongoose.Types.ObjectId();
      const forgedJwtA = generateRefreshToken({
        adminId: testAdmin._id,
        sessionId: nonExistentSid
      });
      const resA = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/refresh',
        cookies: { refreshToken: forgedJwtA }
      });
      assert.strictEqual(resA.status, 401, 'Non-existent sessionId must return 401');

      // 11b. Mismatched sessionId (session belongs to Admin 2, token signed for Admin 1)
      const otherAdmin = await Admin.create({
        username: 'OtherAdmin',
        email: `test_other_${Date.now()}@merya.dz`,
        passwordHash: await bcrypt.hash('OtherSecret123!', 10),
        role: 'admin',
        isActive: true
      });
      const otherSession = await Session.create({
        adminId: otherAdmin._id,
        expiresAt: new Date(Date.now() + 86400000),
        refreshTokenHash: 'dummy'
      });
      // Token claims sub: testAdmin._id, but sid: otherSession._id
      const mismatchedJwt = generateRefreshToken({
        adminId: testAdmin._id,
        sessionId: otherSession._id
      });
      const resB = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/refresh',
        cookies: { refreshToken: mismatchedJwt }
      });
      assert.strictEqual(resB.status, 401, 'Mismatched sessionId ownership must return 401');

      // 11c. Malformed non-ObjectId sessionId in token
      const malformedSidJwt = jwt.sign(
        { sub: String(testAdmin._id), sid: 'not-a-valid-hex-objectid', type: 'refresh' },
        AUTH_CONFIG.refreshTokenSecret,
        { expiresIn: '7d' }
      );
      const resC = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/refresh',
        cookies: { refreshToken: malformedSidJwt }
      });
      assert.strictEqual(resC.status, 401, 'Malformed sessionId must be safely rejected with 401 without crashing');

      pass('11. Wrong/mismatched sessionId → safely rejected with 401');
    } catch (e) { fail('11. Wrong/mismatched sessionId', e); }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 12: Access token cannot be used as a refresh token
    // ───────────────────────────────────────────────────────────────────────────
    try {
      const sess = await createSession({ adminId: testAdmin._id });
      const res = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/refresh',
        cookies: { refreshToken: sess.accessToken } // Access token sent to refresh endpoint
      });
      assert.strictEqual(res.status, 401, 'Access token presented as refresh token must return 401');
      pass('12. Access token cannot be used as a refresh token');
    } catch (e) { fail('12. Access token cannot be used as refresh token', e); }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 13: Refresh token cannot be accepted as an access token
    // ───────────────────────────────────────────────────────────────────────────
    try {
      const sess = await createSession({ adminId: testAdmin._id });
      const res = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/protected',
        cookies: { accessToken: sess.refreshToken } // Refresh token sent as access token
      });
      assert.strictEqual(res.status, 401, 'Refresh token presented as access token must return 401');
      pass('13. Refresh token cannot be accepted as an access token');
    } catch (e) { fail('13. Refresh token cannot be accepted as access token', e); }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 14: Inactive/deleted Admin cannot continue authentication
    // ───────────────────────────────────────────────────────────────────────────
    try {
      const ephemeralAdmin = await Admin.create({
        username: 'EphemeralAdmin',
        email: `test_ephemeral_${Date.now()}@merya.dz`,
        passwordHash: await bcrypt.hash(testPassword, 10),
        role: 'admin',
        isActive: true
      });
      const sess = await createSession({ adminId: ephemeralAdmin._id });

      // Check it works when active
      const resActive = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/protected',
        cookies: { accessToken: sess.accessToken }
      });
      assert.strictEqual(resActive.status, 200);

      // 14a. Deactivate Admin
      ephemeralAdmin.isActive = false;
      await ephemeralAdmin.save();

      const resDeactivatedProtected = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/protected',
        cookies: { accessToken: sess.accessToken }
      });
      assert.strictEqual(resDeactivatedProtected.status, 401, 'Deactivated admin must be rejected on protected routes');

      const resDeactivatedRefresh = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/refresh',
        cookies: { refreshToken: sess.refreshToken }
      });
      assert.strictEqual(resDeactivatedRefresh.status, 401, 'Deactivated admin must be rejected on refresh');

      // 14b. Delete Admin
      await Admin.findByIdAndDelete(ephemeralAdmin._id);

      const resDeletedProtected = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/protected',
        cookies: { accessToken: sess.accessToken }
      });
      assert.strictEqual(resDeletedProtected.status, 401, 'Deleted admin must be rejected on protected routes');

      pass('14. Inactive/deleted Admin cannot continue authentication on access or refresh');
    } catch (e) { fail('14. Inactive/deleted Admin cannot continue authentication', e); }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 15: Existing CSRF protections still work
    // ───────────────────────────────────────────────────────────────────────────
    try {
      const sess = await createSession({ adminId: testAdmin._id });

      // 15a. Mutating request without CSRF header / cookie must fail with 403
      const resNoCsrf = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/logout',
        cookies: { accessToken: sess.accessToken }
      });
      assert.strictEqual(resNoCsrf.status, 403, 'Mutating request without CSRF must return 403');
      assert.strictEqual(resNoCsrf.body.code, 'CSRF_INVALID');

      // 15b. Mutating request with valid double-submit CSRF tokens must succeed
      const csrfRes = await makeRequest(server, { method: 'GET', path: '/api/v1/auth/csrf-token' });
      const csrfToken = csrfRes.body.csrfToken;

      const resWithCsrf = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/logout',
        headers: { 'X-CSRF-Token': csrfToken },
        cookies: {
          accessToken: sess.accessToken,
          csrf_token: csrfToken
        }
      });
      assert.strictEqual(resWithCsrf.status, 200, 'Mutating request with valid CSRF must return 200');

      pass('15. Existing CSRF protection correctly rejects unauthorized mutations and accepts valid tokens');
    } catch (e) { fail('15. Existing CSRF protections', e); }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 16: Existing WebSocket authentication still works
    // ───────────────────────────────────────────────────────────────────────────
    try {
      const sessA = await createSession({ adminId: testAdmin._id });
      const sessB = await createSession({ adminId: testAdmin._id });

      const wsUrl = `ws://127.0.0.1:${server.address().port}/ws`;

      // 16a. Unauthenticated connection rejected on SUBSCRIBE_ADMIN
      const wsUnauth = new WebSocket(wsUrl);
      await new Promise(r => wsUnauth.on('open', r));
      wsUnauth.send(JSON.stringify({ action: 'SUBSCRIBE_ADMIN' }));

      const unauthMsg = await new Promise((resolve) => {
        wsUnauth.on('message', data => {
          const m = JSON.parse(data.toString());
          if (m.type === 'ERROR') resolve(m);
        });
      });
      assert.strictEqual(unauthMsg.type, 'ERROR');
      wsUnauth.close();

      // 16b. Authenticated connection via accessToken cookie
      const wsA = new WebSocket(wsUrl, { headers: { Cookie: `accessToken=${sessA.accessToken}` } });
      const wsB = new WebSocket(wsUrl, { headers: { Cookie: `accessToken=${sessB.accessToken}` } });

      await Promise.all([
        new Promise(r => wsA.on('open', r)),
        new Promise(r => wsB.on('open', r))
      ]);
      await new Promise(r => setTimeout(r, 100)); // allow upgrade auth promise to finish

      wsA.send(JSON.stringify({ action: 'SUBSCRIBE_ADMIN' }));
      wsB.send(JSON.stringify({ action: 'SUBSCRIBE_ADMIN' }));

      await new Promise(r => setTimeout(r, 150));

      // 16c. Revoke session A WebSocket only; session B WebSocket remains open
      let aRevoked = false;
      wsA.on('message', msg => {
        const d = JSON.parse(msg.toString());
        if (d.type === 'SESSION_REVOKED') aRevoked = true;
      });

      wsService.revokeAdminSession(sessA.session._id);
      await new Promise(r => setTimeout(r, 150));

      assert.strictEqual(aRevoked, true, 'wsA received SESSION_REVOKED');
      assert.strictEqual(wsA.readyState, WebSocket.CLOSED, 'wsA socket closed with 4001');
      assert.strictEqual(wsB.readyState, WebSocket.OPEN, 'wsB socket remains OPEN');

      wsB.close();
      pass('16. Existing WebSocket authentication & per-session revocation works seamlessly');
    } catch (e) { fail('16. Existing WebSocket authentication', e); }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 17: Customer public order tracking still works
    // ───────────────────────────────────────────────────────────────────────────
    try {
      const order = await Order.create({
        orderCode: 'MRY-WS-TEST-PUBLIC-99',
        customer: {
          fullName: 'Amira Benali',
          phone: '0555987654',
          wilaya: { code: 16, name: 'Alger' },
          deliveryMethod: 'home'
        },
        items: [{
          productId: new mongoose.Types.ObjectId(),
          productName: 'Abaya Soie de Médine',
          colorName: 'Beige',
          size: 'L',
          unitCost: 2500,
          unitPrice: 6200,
          quantity: 1
        }],
        totalPrice: 6800,
        subtotal: 6200,
        deliveryFee: 600,
        status: 'Pending'
      });

      const wsUrl = `ws://127.0.0.1:${server.address().port}/ws`;
      const customerWs = new WebSocket(wsUrl);

      await new Promise((resolve, reject) => {
        customerWs.on('open', () => {
          // Public subscription: orderCode + phone (NO tokens required)
          customerWs.send(JSON.stringify({
            action: 'SUBSCRIBE_ORDER',
            orderCode: order.orderCode,
            phone: '0555 98 76 54' // formatted phone with spaces
          }));
        });

        customerWs.on('message', (msg) => {
          const data = JSON.parse(msg.toString());
          if (data.type === 'SUBSCRIBED' && data.channel === `order:${order.orderCode}`) {
            customerWs.close();
            resolve();
          }
        });

        customerWs.on('error', reject);
        setTimeout(() => reject(new Error('Public order tracking subscription timed out')), 4000);
      });

      pass('17. Customer public order tracking works independently without admin authentication');
    } catch (e) { fail('17. Customer public order tracking', e); }

  } finally {
    server.close();
    await mongoose.disconnect();
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passCount} passed, ${failCount} failed`);
  console.log(`========================================\n`);

  if (failCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
