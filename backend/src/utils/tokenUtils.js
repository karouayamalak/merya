import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AUTH_CONFIG } from '../config/authConfig.js';

/**
 * Generate a short-lived Access JWT.
 * Payload is strictly minimal (sub, sid, type, jti) — mutable DB state is never trusted in payload.
 */
export function generateAccessToken({ adminId, sessionId }) {
  const secret = AUTH_CONFIG.accessTokenSecret;
  if (!secret) {
    throw new Error('Server authentication configuration error: ACCESS_TOKEN_SECRET is missing');
  }

  const payload = {
    sub: String(adminId),
    sid: String(sessionId),
    type: 'access',
    jti: crypto.randomUUID()
  };

  return jwt.sign(payload, secret, {
    expiresIn: AUTH_CONFIG.accessTokenExpiresIn
  });
}

/**
 * Generate a long-lived Refresh JWT.
 * Valid ONLY against the refresh endpoint.
 */
export function generateRefreshToken({ adminId, sessionId }) {
  const secret = AUTH_CONFIG.refreshTokenSecret;
  if (!secret) {
    throw new Error('Server authentication configuration error: REFRESH_TOKEN_SECRET is missing');
  }

  const payload = {
    sub: String(adminId),
    sid: String(sessionId),
    type: 'refresh',
    jti: crypto.randomUUID()
  };

  return jwt.sign(payload, secret, {
    expiresIn: AUTH_CONFIG.refreshTokenExpiresIn
  });
}

/**
 * Verify and decode an Access JWT.
 * Strictly asserts token type === 'access'.
 */
export function verifyAccessToken(token) {
  const secret = AUTH_CONFIG.accessTokenSecret;
  if (!secret) {
    throw new Error('ACCESS_TOKEN_SECRET is missing');
  }

  const decoded = jwt.verify(token, secret);
  if (decoded.type !== 'access') {
    const err = new Error('Invalid token type for access authentication');
    err.code = 'INVALID_TOKEN_TYPE';
    throw err;
  }
  return decoded;
}

/**
 * Verify and decode a Refresh JWT.
 * Strictly asserts token type === 'refresh'.
 */
export function verifyRefreshToken(token) {
  const secret = AUTH_CONFIG.refreshTokenSecret;
  if (!secret) {
    throw new Error('REFRESH_TOKEN_SECRET is missing');
  }

  const decoded = jwt.verify(token, secret);
  if (decoded.type !== 'refresh') {
    const err = new Error('Invalid token type for session refresh');
    err.code = 'INVALID_TOKEN_TYPE';
    throw err;
  }
  return decoded;
}

/**
 * Deterministic SHA-256 verifier for storing refresh token hashes in MongoDB.
 * Never stores raw refresh tokens.
 */
export function hashToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid token supplied for hashing');
  }
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison between a presented token and stored SHA-256 hash.
 */
export function verifyTokenHash(presentedToken, storedHash) {
  if (!presentedToken || !storedHash) return false;
  const presentedHash = hashToken(presentedToken);
  try {
    const a = Buffer.from(presentedHash, 'hex');
    const b = Buffer.from(storedHash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
