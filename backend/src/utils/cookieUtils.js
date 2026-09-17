import { AUTH_CONFIG } from '../config/authConfig.js';

function getCookieBaseOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  // In production across domains (e.g. Vercel frontend + Render backend), sameSite must be 'none' with secure: true
  const sameSite = isProduction ? (process.env.COOKIE_SAME_SITE || 'none') : 'lax';

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite
  };
}

/**
 * Set both Access and Refresh cookies with appropriate security and scope.
 */
export function setAuthCookies(res, { accessToken, refreshToken }) {
  const base = getCookieBaseOptions();

  if (accessToken) {
    res.cookie(AUTH_CONFIG.cookies.access, accessToken, {
      ...base,
      path: '/',
      maxAge: AUTH_CONFIG.accessTokenMaxAgeMs
    });
  }

  if (refreshToken) {
    res.cookie(AUTH_CONFIG.cookies.refresh, refreshToken, {
      ...base,
      path: '/api/v1/auth',
      maxAge: AUTH_CONFIG.refreshTokenMaxAgeMs
    });
  }

  // Clear any legacy token cookie on new session issuance
  res.clearCookie(AUTH_CONFIG.cookies.legacy, {
    ...base,
    path: '/'
  });
}

/**
 * Clear all authentication cookies (Access, Refresh, and legacy token).
 */
export function clearAuthCookies(res) {
  const base = getCookieBaseOptions();

  res.clearCookie(AUTH_CONFIG.cookies.access, {
    ...base,
    path: '/'
  });

  res.clearCookie(AUTH_CONFIG.cookies.refresh, {
    ...base,
    path: '/api/v1/auth'
  });

  res.clearCookie(AUTH_CONFIG.cookies.legacy, {
    ...base,
    path: '/'
  });
}
