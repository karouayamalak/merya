/**
 * authConfig.js
 *
 * Centralized authentication and token configuration.
 * Adheres strictly to the separate-secrets, separate-lifetimes security architecture.
 */

export const AUTH_CONFIG = {
  get accessTokenSecret() {
    return process.env.ACCESS_TOKEN_SECRET;
  },

  get refreshTokenSecret() {
    return process.env.REFRESH_TOKEN_SECRET;
  },

  accessTokenExpiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m',
  refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',

  // Numeric milliseconds for cookie maxAge calculation
  accessTokenMaxAgeMs: 15 * 60 * 1000, // 15 minutes
  refreshTokenMaxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days

  cookies: {
    access: 'accessToken',
    refresh: 'refreshToken',
    legacy: 'token'
  }
};
