/**
 * CSRF Protection — Double-Submit Signed Cookie Pattern
 *
 * Flow:
 *   1. Client calls GET /api/v1/auth/csrf-token
 *   2. Server sets a JS-readable cookie `csrf_token` containing a signed token.
 *   3. Client reads the cookie and sends it back in the `X-CSRF-Token` header
 *      on every mutating request (POST, PUT, PATCH, DELETE).
 *   4. `verifyCsrf` middleware validates the header token against the cookie,
 *      rejecting mismatches or expired tokens with HTTP 403.
 *
 * Security properties:
 *   - Token is NOT the JWT (a separate, short-lived HMAC-signed value).
 *   - Signed with CSRF_SECRET (or derived from COOKIE_SECRET) — forgery fails.
 *   - Time-limited: 1-hour expiry encoded in the token payload.
 *   - The HttpOnly auth cookie is separate and never exposed to JavaScript.
 *   - CORS alone does not protect cross-origin state mutations when
 *     SameSite=None is in use, so this adds the required second factor.
 */

import crypto from 'crypto';

// ─── Token Generation & Verification ─────────────────────────────────────────

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const SEPARATOR = '.';

/**
 * Returns the HMAC key for signing CSRF tokens.
 * Prefers CSRF_SECRET, falls back to COOKIE_SECRET, errors in production if neither is set.
 */
function getCsrfSecret() {
  const secret = process.env.CSRF_SECRET || process.env.COOKIE_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[CSRF] CSRF_SECRET or COOKIE_SECRET must be set in production.');
    }
    return 'merya_dev_csrf_secret_2026'; // safe dev-only fallback
  }
  return secret;
}

/**
 * Generate a new signed CSRF token.
 * Format: <random_hex>.<expiry_ms>.<hmac_hex>
 */
export function generateCsrfToken() {
  const secret = getCsrfSecret();
  const value = crypto.randomBytes(24).toString('hex');
  const expiry = Date.now() + TOKEN_TTL_MS;
  const payload = `${value}${SEPARATOR}${expiry}`;
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}${SEPARATOR}${hmac}`;
}

/**
 * Verify a CSRF token.
 * Returns true if the token is structurally valid, correctly signed, and not expired.
 */
export function verifyCsrfToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split(SEPARATOR);
  if (parts.length !== 3) return false;
  const [value, expiryStr, receivedHmac] = parts;
  const expiry = parseInt(expiryStr, 10);
  if (!Number.isFinite(expiry) || Date.now() > expiry) return false;
  const payload = `${value}${SEPARATOR}${expiry}`;
  try {
    const secret = getCsrfSecret();
    const expectedHmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    // Constant-time comparison prevents timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(receivedHmac, 'hex'),
      Buffer.from(expectedHmac, 'hex')
    );
  } catch {
    return false;
  }
}

// ─── Express Middleware ───────────────────────────────────────────────────────

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Express middleware that enforces CSRF token validation for all
 * state-changing HTTP methods (POST, PUT, PATCH, DELETE).
 *
 * Reads the token from the `X-CSRF-Token` request header.
 * GET / HEAD / OPTIONS pass through without a check.
 */
export function verifyCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  // Token-authenticated requests via Authorization Bearer header are immune to browser ambient CSRF attacks
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return next();
  }

  const headerToken = req.headers['x-csrf-token'];
  // Also accept the cookie value for the double-submit check
  const cookieToken = req.cookies?.csrf_token;

  // Header token must be present and valid
  if (!headerToken || !verifyCsrfToken(headerToken)) {
    return res.status(403).json({
      success: false,
      message: 'CSRF token missing, invalid, or expired. Refresh and retry.',
      code: 'CSRF_INVALID'
    });
  }

  // If cookie is also present, ensure they match (double submit)
  if (cookieToken && headerToken !== cookieToken) {
    return res.status(403).json({
      success: false,
      message: 'CSRF token mismatch. Refresh and retry.',
      code: 'CSRF_INVALID'
    });
  }

  next();
}

/**
 * Issues a fresh CSRF token:
 *  - Sets it as a JS-readable (not HttpOnly) cookie named `csrf_token`
 *  - Returns it in the response body for frameworks that prefer reading JSON
 *
 * Call this from GET /api/v1/auth/csrf-token.
 */
export function issueCsrfToken(req, res) {
  const token = generateCsrfToken();
  const isProduction = process.env.NODE_ENV === 'production';
  const sameSite = isProduction ? (process.env.COOKIE_SAME_SITE || 'none') : 'lax';

  // NOT httpOnly — JavaScript must be able to read this cookie to forward it in the header
  res.cookie('csrf_token', token, {
    httpOnly: false,
    secure: isProduction,
    sameSite,
    maxAge: TOKEN_TTL_MS
  });

  res.json({ success: true, csrfToken: token });
}
