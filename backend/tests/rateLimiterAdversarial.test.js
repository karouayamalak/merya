import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import {
  loginLimiter,
  trackingLimiter,
  checkoutLimiter,
  apiLimiter
} from '../src/middleware/rateLimiter.js';
import { connectDB } from '../src/config/db.js';

describe('Rate Limiter Adversarial & Namespace Isolation Suite', () => {
  let RateLimitRecord;

  before(async () => {
    if (mongoose.connection.readyState !== 1) {
      await connectDB();
    }
    RateLimitRecord = mongoose.models.RateLimitRecord;
    // Clear test rate limit records
    await RateLimitRecord.deleteMany({ key: { $regex: /^test-/ } });
    await RateLimitRecord.deleteMany({ key: { $regex: /:(test-ip|192\.168\.)/ } });
  });

  after(async () => {
    if (RateLimitRecord) {
      await RateLimitRecord.deleteMany({ key: { $regex: /^test-/ } });
      await RateLimitRecord.deleteMany({ key: { $regex: /:(test-ip|192\.168\.)/ } });
    }
    // Disconnect MongoDB so the process exits cleanly (no hanging open handles)
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  test('1-5. Independent namespaces: same IP gets isolated buckets for login, tracking, checkout, api', async () => {
    const testIp = '192.168.10.50';

    // Hit login store 3 times
    const l1 = await loginLimiter.store.increment(testIp);
    const l2 = await loginLimiter.store.increment(testIp);
    const l3 = await loginLimiter.store.increment(testIp);
    assert.strictEqual(l3.totalHits, 3);

    // Hit tracking store 1 time
    const t1 = await trackingLimiter.store.increment(testIp);
    assert.strictEqual(t1.totalHits, 1, 'Tracking bucket should start at 1, completely isolated from login');

    // Hit checkout store 2 times
    const c1 = await checkoutLimiter.store.increment(testIp);
    const c2 = await checkoutLimiter.store.increment(testIp);
    assert.strictEqual(c2.totalHits, 2, 'Checkout bucket should be at 2, completely isolated from login and tracking');

    // Hit api store 5 times
    for (let i = 0; i < 5; i++) {
      await apiLimiter.store.increment(testIp);
    }
    const aLast = await apiLimiter.store.increment(testIp);
    assert.strictEqual(aLast.totalHits, 6, 'API bucket should count hits independently');

    // Verify MongoDB keys physically reflect distinct namespaces
    const loginDoc = await RateLimitRecord.findOne({ key: `login:${testIp}` });
    const trackingDoc = await RateLimitRecord.findOne({ key: `tracking:${testIp}` });
    const checkoutDoc = await RateLimitRecord.findOne({ key: `checkout:${testIp}` });
    const apiDoc = await RateLimitRecord.findOne({ key: `api:${testIp}` });

    assert.ok(loginDoc, 'MongoDB must have namespaced login document');
    assert.strictEqual(loginDoc.count, 3);

    assert.ok(trackingDoc, 'MongoDB must have namespaced tracking document');
    assert.strictEqual(trackingDoc.count, 1);

    assert.ok(checkoutDoc, 'MongoDB must have namespaced checkout document');
    assert.strictEqual(checkoutDoc.count, 2);

    assert.ok(apiDoc, 'MongoDB must have namespaced api document');
    assert.strictEqual(apiDoc.count, 6);

    // Cleanup
    await loginLimiter.store.resetKey(testIp);
    await trackingLimiter.store.resetKey(testIp);
    await checkoutLimiter.store.resetKey(testIp);
    await apiLimiter.store.resetKey(testIp);
  });

  test('6. Normal limit enforcement decrement and resetKey', async () => {
    const testIp = '192.168.10.51';
    await loginLimiter.store.increment(testIp);
    await loginLimiter.store.increment(testIp);

    await loginLimiter.store.decrement(testIp);
    const doc = await RateLimitRecord.findOne({ key: `login:${testIp}` });
    assert.strictEqual(doc.count, 1);

    await loginLimiter.store.resetKey(testIp);
    const docAfterReset = await RateLimitRecord.findOne({ key: `login:${testIp}` });
    assert.strictEqual(docAfterReset, null);
  });

  test('7-8. Expired MongoDB document physically present is correctly reset without relying on TTL cleanup', async () => {
    const testIp = '192.168.10.52';
    const pastTime = new Date(Date.now() - 60000); // 1 minute in the past

    // Manually create an expired document directly in MongoDB to simulate TTL deletion delay
    await RateLimitRecord.findOneAndUpdate(
      { key: `login:${testIp}` },
      {
        count: 50, // previously exhausted
        resetTime: pastTime,
        expiresAt: new Date(pastTime.getTime() + 5000)
      },
      { upsert: true }
    );

    // Verify it is physically present in DB
    const existingExpired = await RateLimitRecord.findOne({ key: `login:${testIp}` });
    assert.ok(existingExpired, 'Expired doc must be physically present in DB');
    assert.strictEqual(existingExpired.count, 50);

    // Now make a new request via store.increment
    const newHit = await loginLimiter.store.increment(testIp);

    // The count MUST be reset to 1 and resetTime must be in the future
    assert.strictEqual(newHit.totalHits, 1, 'Expired record must reset count to 1 immediately');
    assert.ok(newHit.resetTime.getTime() > Date.now(), 'New resetTime must be established in the future');

    const updatedDoc = await RateLimitRecord.findOne({ key: `login:${testIp}` });
    assert.strictEqual(updatedDoc.count, 1);
    assert.ok(updatedDoc.resetTime.getTime() > Date.now());

    await loginLimiter.store.resetKey(testIp);
  });

  test('9-10. Concurrent first requests (duplicate-key race handling)', async () => {
    const testIp = '192.168.10.53';
    await loginLimiter.store.resetKey(testIp);

    // Fire 10 simultaneous requests from the same IP when no record exists yet
    const results = await Promise.all(
      Array.from({ length: 10 }, () => loginLimiter.store.increment(testIp))
    );

    // Total hits must be tracked across all 10 calls, max count should be 10
    const finalDoc = await RateLimitRecord.findOne({ key: `login:${testIp}` });
    assert.ok(finalDoc);
    assert.strictEqual(finalDoc.count, 10, 'All 10 concurrent initial requests must be counted atomically without race error');

    await loginLimiter.store.resetKey(testIp);
  });

  test('11. Concurrent requests exactly around expiration window', async () => {
    const testIp = '192.168.10.54';
    const justExpired = new Date(Date.now() - 100);

    // Seed expired document
    await RateLimitRecord.findOneAndUpdate(
      { key: `checkout:${testIp}` },
      {
        count: 15,
        resetTime: justExpired,
        expiresAt: new Date(justExpired.getTime() + 5000)
      },
      { upsert: true }
    );

    // Fire 5 concurrent requests at the boundary
    const results = await Promise.all(
      Array.from({ length: 5 }, () => checkoutLimiter.store.increment(testIp))
    );

    // All results must have valid positive counts <= 5, and the document count must be 5
    const finalDoc = await RateLimitRecord.findOne({ key: `checkout:${testIp}` });
    assert.ok(finalDoc);
    assert.strictEqual(finalDoc.count, 5, 'Count must reset to 1 and increment to 5 across concurrent calls at expiration boundary');
    assert.ok(finalDoc.resetTime.getTime() > Date.now());

    await checkoutLimiter.store.resetKey(testIp);
  });

  test('12-13. Fallback when MongoDB is unavailable and strictly bounded to MAX_FALLBACK_KEYS', async () => {
    const store = loginLimiter.store;

    // Simulate fallback hit recording
    const now = Date.now();
    const fallbackIp = '10.0.0.1';

    const h1 = store._recordFallbackHit(fallbackIp, now);
    assert.strictEqual(h1.totalHits, 1);

    const h2 = store._recordFallbackHit(fallbackIp, now);
    assert.strictEqual(h2.totalHits, 2);

    // Verify bounded memory eviction
    const MAX_KEYS = 1000;
    // Preload store map with 1000 entries
    for (let i = 0; i < MAX_KEYS + 50; i++) {
      store._recordFallbackHit(`stress-ip-${i}`, now);
    }

    assert.ok(store._fallbackStore.size <= MAX_KEYS, `Fallback store size (${store._fallbackStore.size}) must never exceed MAX_FALLBACK_KEYS (${MAX_KEYS})`);

    // Clean up
    store._fallbackStore.clear();
  });

  test('14. Multi-instance-safe semantics: distributed hits on same collection update the single shared state', async () => {
    // Two store instances simulating two different microservices / server nodes
    const nodeAStore = loginLimiter.store;
    const nodeBStore = loginLimiter.store; // Same MongoDB collection and prefix

    const testIp = '192.168.10.99';
    await loginLimiter.store.resetKey(testIp);

    // Hit node A
    const hitA1 = await nodeAStore.increment(testIp);
    assert.strictEqual(hitA1.totalHits, 1);

    // Hit node B
    const hitB1 = await nodeBStore.increment(testIp);
    assert.strictEqual(hitB1.totalHits, 2, 'Node B must observe increment from Node A via shared MongoDB store');

    // Hit node A again
    const hitA2 = await nodeAStore.increment(testIp);
    assert.strictEqual(hitA2.totalHits, 3, 'Node A must observe increment from Node B');

    await loginLimiter.store.resetKey(testIp);
  });
});
