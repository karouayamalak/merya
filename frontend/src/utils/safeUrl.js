/**
 * Safe URL validation and navigation helpers for frontend storefront & admin.
 * Protects against XSS via javascript:, data:, vbscript:, and other dangerous schemes.
 */

/**
 * Checks whether a URL is safe for navigation or opening in browser.
 * Allowed:
 *  - https://...
 *  - http://...
 *  - safe relative paths beginning with single '/' (e.g. '/shop', '/products/slug')
 * Rejected:
 *  - javascript:, data:, vbscript:, file:, blob: and other executable schemes
 *  - Protocol-relative links ('//...')
 *  - Backslash schemes ('/\...')
 *  - Control characters and malformed URIs
 */
export function isSafeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  // Reject ASCII control characters
  if (/[\x00-\x1F\x7F]/.test(trimmed)) return false;

  // Safe relative paths starting with '/'
  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return false;
    return true;
  }

  // Absolute URLs: http or https only
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Sanitizes a URL for use in href attributes.
 * Returns the trimmed URL if safe, or the fallback string (default '#').
 */
export function sanitizeUrl(url, fallback = '#') {
  if (!url || typeof url !== 'string') return fallback;
  return isSafeUrl(url) ? url.trim() : fallback;
}

/**
 * Safely navigates or opens a link defensively.
 * If url is an external http/https URL, opens with window.open using noopener,noreferrer.
 * If url is a relative path or invalid, delegates safely to setCurrentView or navigates.
 */
export function handleSafeBannerClick(url, setCurrentView, fallbackView = 'shop') {
  if (!url || !isSafeUrl(url)) {
    if (typeof setCurrentView === 'function') {
      setCurrentView(fallbackView);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    return;
  }

  const trimmed = url.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    window.open(trimmed, '_blank', 'noopener,noreferrer');
  } else if (trimmed.startsWith('/')) {
    const cleanPath = trimmed.split('?')[0].replace(/^\//, '').toLowerCase();
    if (cleanPath === 'shop' || cleanPath === '' || cleanPath === 'home') {
      if (typeof setCurrentView === 'function') {
        setCurrentView(cleanPath || 'shop');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } else {
      if (typeof setCurrentView === 'function') {
        setCurrentView('shop');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  } else {
    if (typeof setCurrentView === 'function') {
      setCurrentView(fallbackView);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
}
