import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';

// ─── MongoDB-Backed Rate Limit Store ─────────────────────────────────────────
// Provides shared, persistent rate limit state across multiple backend instances.
// Uses atomic $inc on a TTL-indexed collection so concurrent hits on different
// nodes are counted correctly.
//
// Collection: ratelimitrecords
// TTL index: expiresAt (MongoDB auto-deletes documents past this date)
// Atomic increment: $inc to prevent race conditions

const rateLimitRecordSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  resetTime: { type: Date, required: true },
  expiresAt: { type: Date, required: true }
});
rateLimitRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Note: unique index on 'key' is declared via { unique: true } on the field itself — no duplicate schema.index() needed.

// Lazy model: only register once, reuse if already registered (hot reload safety)
const RateLimitRecord = mongoose.models.RateLimitRecord ||
  mongoose.model('RateLimitRecord', rateLimitRecordSchema);

const MAX_FALLBACK_KEYS = 1000;

/**
 * MongoDB-backed store for express-rate-limit with a bounded in-memory
 * emergency fallback circuit breaker.
 *
 * Primary behavior:
 * - Distributed atomic increments on the RateLimitRecord MongoDB collection.
 * - TTL-indexed expiration for automated cleanup.
 *
 * Emergency failure behavior (e.g. database down, replica set reconnecting):
 * - If MongoDB is unavailable, sensitive rate limiters must NOT trivially fail open
 *   and allow unlimited brute-force attacks against login, tracking, or checkout.
 * - An in-memory fallback Map is maintained, strictly bounded to MAX_FALLBACK_KEYS (1,000 entries).
 * - When capacity is reached, expired or oldest entries are pruned to strictly prevent
 *   memory exhaustion / secondary memory DoS during outages.
 */
class MongoRateLimitStore {
  constructor(windowMs, prefix = '') {
    this.windowMs = windowMs;
    this.prefix = prefix;
    // Bounded in-memory emergency cache for database outage scenarios: fullKey -> { count, resetTime }
    this._fallbackStore = new Map();
  }

  _getFullKey(key) {
    return this.prefix ? `${this.prefix}:${key}` : key;
  }

  _recordFallbackHit(rawKey, now) {
    const fullKey = this._getFullKey(rawKey);

    // Evict expired entries if approaching capacity
    if (this._fallbackStore.size >= MAX_FALLBACK_KEYS) {
      for (const [k, v] of this._fallbackStore.entries()) {
        if (v.resetTime <= now) {
          this._fallbackStore.delete(k);
        }
      }
    }
    // If still at capacity, evict oldest FIFO key to guarantee strict bound
    if (this._fallbackStore.size >= MAX_FALLBACK_KEYS) {
      const oldestKey = this._fallbackStore.keys().next().value;
      if (oldestKey) this._fallbackStore.delete(oldestKey);
    }

    const current = this._fallbackStore.get(fullKey);
    if (current && current.resetTime > now) {
      current.count += 1;
      return { totalHits: current.count, resetTime: new Date(current.resetTime) };
    }

    const entry = { count: 1, resetTime: now + this.windowMs };
    this._fallbackStore.set(fullKey, entry);
    return { totalHits: 1, resetTime: new Date(entry.resetTime) };
  }

  async increment(key) {
    const fullKey = this._getFullKey(key);
    const now = Date.now();
    const resetTime = new Date(now + this.windowMs);
    const expiresAt = new Date(now + this.windowMs + 5000); // 5s grace for TTL

    const executeAtomicUpdate = async () => {
      return await RateLimitRecord.findOneAndUpdate(
        { key: fullKey },
        [
          {
            $set: {
              count: {
                $cond: {
                  if: {
                    $or: [
                      { $eq: [{ $type: '$resetTime' }, 'missing'] },
                      { $lte: ['$resetTime', new Date(now)] }
                    ]
                  },
                  then: 1,
                  else: { $add: ['$count', 1] }
                }
              },
              resetTime: {
                $cond: {
                  if: {
                    $or: [
                      { $eq: [{ $type: '$resetTime' }, 'missing'] },
                      { $lte: ['$resetTime', new Date(now)] }
                    ]
                  },
                  then: resetTime,
                  else: '$resetTime'
                }
              },
              expiresAt: {
                $cond: {
                  if: {
                    $or: [
                      { $eq: [{ $type: '$resetTime' }, 'missing'] },
                      { $lte: ['$resetTime', new Date(now)] }
                    ]
                  },
                  then: expiresAt,
                  else: '$expiresAt'
                }
              }
            }
          }
        ],
        { upsert: true, new: true }
      );
    };

    try {
      const doc = await executeAtomicUpdate();
      return {
        totalHits: doc.count,
        resetTime: doc.resetTime
      };
    } catch (err) {
      // If two concurrent requests race to create a new key and one hits E11000,
      // retry once — the document now exists so it will match and update atomically.
      if (err.code === 11000) {
        try {
          const retryDoc = await executeAtomicUpdate();
          if (retryDoc) {
            return {
              totalHits: retryDoc.count,
              resetTime: retryDoc.resetTime
            };
          }
        } catch (retryErr) {
          console.warn(`[RateLimit] MongoDB retry error after 11000: ${retryErr.message}`);
        }
      }

      // On store failure (e.g., DB down), fall back to bounded in-memory emergency cache
      // rather than trivially failing open and exposing sensitive endpoints to brute force.
      console.warn(`[RateLimit] MongoDB store error, using bounded emergency fallback: ${err.message}`);
      return this._recordFallbackHit(key, now);
    }
  }

  async decrement(key) {
    const fullKey = this._getFullKey(key);
    const entry = this._fallbackStore.get(fullKey);
    if (entry && entry.count > 0) entry.count -= 1;
    await RateLimitRecord.updateOne(
      { key: fullKey, count: { $gt: 0 } },
      { $inc: { count: -1 } }
    ).catch(() => {});
  }

  async resetKey(key) {
    const fullKey = this._getFullKey(key);
    this._fallbackStore.delete(fullKey);
    await RateLimitRecord.deleteOne({ key: fullKey }).catch(() => {});
  }
}

// ─── Rate Limiter Factory ────────────────────────────────────────────────────

function createLimiter({ windowMs, max, message, prefix = '' }) {
  const store = new MongoRateLimitStore(windowMs, prefix);
  const limiter = rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    message: { success: false, message }
  });
  // Expose the store directly on the middleware for testability
  limiter.store = store;
  return limiter;
}

// Strict limiter for admin login to block brute-force attacks
export const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 6 : 10000,
  message: 'Too many login attempts. Please try again in 15 minutes.',
  prefix: 'login'
});

// Order tracking limiter to prevent brute-force order enumeration
export const trackingLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 20 : 1000,
  message: 'Too many tracking attempts. Please wait a few minutes before trying again.',
  prefix: 'tracking'
});

// Checkout limiter to prevent rapid spam orders
export const checkoutLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 15 : 1000,
  message: 'Too many checkout attempts. Please wait a moment.',
  prefix: 'checkout'
});

// General public API limiter
export const apiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: 'Too many requests. Please slow down.',
  prefix: 'api'
});
