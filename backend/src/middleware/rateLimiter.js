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

/**
 * MongoDB-backed store for express-rate-limit.
 * Implements the Store interface expected by express-rate-limit v6+.
 */
class MongoRateLimitStore {
  constructor(windowMs) {
    this.windowMs = windowMs;
  }

  async increment(key) {
    const now = Date.now();
    const resetTime = new Date(now + this.windowMs);
    const expiresAt = new Date(now + this.windowMs + 5000); // 5s grace for TTL

    try {
      const doc = await RateLimitRecord.findOneAndUpdate(
        { key, resetTime: { $gt: new Date(now) } },
        {
          $inc: { count: 1 },
          $setOnInsert: { resetTime, expiresAt }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      return {
        totalHits: doc.count,
        resetTime: doc.resetTime
      };
    } catch (err) {
      // If upsert races (duplicate key on concurrent inserts), retry once
      if (err.code === 11000) {
        const doc = await RateLimitRecord.findOneAndUpdate(
          { key },
          { $inc: { count: 1 } },
          { new: true }
        );
        return {
          totalHits: doc ? doc.count : 1,
          resetTime: doc ? doc.resetTime : resetTime
        };
      }
      // On store failure (e.g., DB down), allow the request through rather than
      // blocking all traffic — fail open is safer for production availability.
      console.error('[RateLimit] MongoDB store error (fail-open):', err.message);
      return { totalHits: 1, resetTime };
    }
  }

  async decrement(key) {
    await RateLimitRecord.updateOne(
      { key },
      { $inc: { count: -1 } }
    ).catch(() => {});
  }

  async resetKey(key) {
    await RateLimitRecord.deleteOne({ key }).catch(() => {});
  }
}

// ─── Rate Limiter Factory ────────────────────────────────────────────────────

function createLimiter({ windowMs, max, message }) {
  const store = new MongoRateLimitStore(windowMs);
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    message: { success: false, message }
  });
}

// Strict limiter for admin login to block brute-force attacks
export const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 6 : 100,
  message: 'Too many login attempts. Please try again in 15 minutes.'
});

// Order tracking limiter to prevent brute-force order enumeration
export const trackingLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: 'Too many tracking attempts. Please wait a few minutes before trying again.'
});

// Checkout limiter to prevent rapid spam orders
export const checkoutLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  max: 15,
  message: 'Too many checkout attempts. Please wait a moment.'
});

// General public API limiter
export const apiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: 'Too many requests. Please slow down.'
});
