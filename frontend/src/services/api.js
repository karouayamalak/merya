const API_BASE = ((typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || '') + '/api/v1';

export function getImageUrl(imagePath) {
  if (!imagePath) return '';
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    return imagePath;
  }
  // Repository-owned frontend static assets (must never hit backend)
  if (
    imagePath.startsWith('/products/') ||
    imagePath.startsWith('/decor_') ||
    imagePath.startsWith('/logo') ||
    imagePath.startsWith('/favicon') ||
    imagePath.startsWith('/icons') ||
    imagePath.startsWith('/silk_bg')
  ) {
    return imagePath;
  }
  // Legacy /uploads/ paths for repository-owned assets map to /products/
  if (imagePath.startsWith('/uploads/')) {
    const filename = imagePath.replace(/^\/uploads\//, '');
    if (filename.startsWith('merya_')) {
      return `/products/${filename}`;
    }
  }
  const backendBase = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) || '';
  return `${backendBase}${imagePath}`;
}

let _csrfToken = null;
let _refreshPromise = null;

export function clearCsrfToken() {
  _csrfToken = null;
}

export async function getCsrfToken() {
  if (_csrfToken) return _csrfToken;
  try {
    const res = await fetch(`${API_BASE}/auth/csrf-token`, {
      credentials: 'include'
    });
    if (!res.ok) throw new Error('Failed to fetch CSRF token');
    const data = await res.json();
    if (data && data.csrfToken) {
      _csrfToken = data.csrfToken;
      return _csrfToken;
    }
  } catch (err) {
    console.warn('[CSRF] Could not retrieve CSRF token:', err.message);
  }
  return null;
}

/**
 * Single-flight token refresh mechanism:
 * Concurrent 401 responses coalesce onto a single active refresh promise
 * to prevent refresh stampedes and race conditions.
 */
async function refreshAccessToken() {
  if (_refreshPromise) {
    return _refreshPromise;
  }

  _refreshPromise = (async () => {
    try {
      const csrfToken = await getCsrfToken();
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {}
      });
      const data = await res.json().catch(() => ({}));

      // If CSRF token expired, get a fresh one and retry once
      if (res.status === 403 && data.code === 'CSRF_INVALID') {
        _csrfToken = null;
        const freshToken = await getCsrfToken();
        if (freshToken) {
          const retryRes = await fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-CSRF-Token': freshToken }
          });
          const retryData = await retryRes.json().catch(() => ({}));
          if (!retryRes.ok) {
            throw new Error(retryData.message || 'Token refresh failed');
          }
          return true;
        }
        throw new Error('CSRF token refresh failed');
      }

      if (!res.ok) {
        throw new Error(data.message || 'Token refresh failed');
      }
      return true;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

async function request(endpoint, options = {}) {
  const config = {
    credentials: 'include', // HttpOnly cookie is sent automatically by the browser
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  };

  // If body is FormData, delete Content-Type to let browser set boundary
  if (options.body instanceof FormData) {
    delete config.headers['Content-Type'];
  }

  const method = (options.method || 'GET').toUpperCase();
  const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
  const PUBLIC_ENDPOINTS = ['/orders/checkout', '/orders/quote', '/tracking', '/auth/login'];
  const isPublic = PUBLIC_ENDPOINTS.some(p => endpoint.startsWith(p));

  // Attach CSRF token on mutating requests to protected endpoints
  if (!SAFE_METHODS.has(method) && !isPublic) {
    const token = await getCsrfToken();
    if (token) {
      config.headers['X-CSRF-Token'] = token;
    }
  }

  let res = await fetch(`${API_BASE}${endpoint}`, config);
  let data = await res.json().catch(() => ({}));

  // Automatic retry once if CSRF token expired
  if (res.status === 403 && data.code === 'CSRF_INVALID' && !options._isRetry) {
    _csrfToken = null;
    const freshToken = await getCsrfToken();
    if (freshToken) {
      config.headers['X-CSRF-Token'] = freshToken;
      res = await fetch(`${API_BASE}${endpoint}`, { ...config, _isRetry: true });
      data = await res.json().catch(() => ({}));
    }
  }

  // Automatic retry once if Access Token expired on protected routes
  if (res.status === 401 && !options._isAuthRetry && !isPublic && endpoint !== '/auth/me') {
    try {
      await refreshAccessToken();
      // Retry original request with fresh credentials
      return await request(endpoint, { ...options, _isAuthRetry: true });
    } catch {
      // Refresh failed — clear cached CSRF token and let caller handle 401 / unauthenticated
      _csrfToken = null;
    }
  }

  if (!res.ok) {
    let errorMsg = data.message || 'Request failed';
    if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) {
      errorMsg = `${errorMsg}: ${data.errors.join(', ')}`;
    }
    const err = new Error(errorMsg);
    err.status = res.status;
    err.code = data.code || null;
    err.errors = data.errors || null;
    throw err;
  }

  return data;
}

// Public Storefront APIs
export const fetchCategories = () => request('/categories');
export const fetchProducts = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return request(`/products?${query}`);
};
export const fetchProductBySlug = (slug) => request(`/products/slug/${encodeURIComponent(slug)}`);
export const fetchDeliverySettings = () => request('/settings/delivery');
export const quoteOrder = (quoteData) => request('/orders/quote', {
  method: 'POST',
  body: JSON.stringify(quoteData)
});
export const submitCheckout = (orderData) => request('/orders/checkout', {
  method: 'POST',
  body: JSON.stringify(orderData)
});
export const trackOrder = (phone, orderCode) => request('/tracking', {
  method: 'POST',
  body: JSON.stringify({ phone, orderCode })
});

// Banners Public API
export const fetchBanners = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return request(`/banners?${query}`);
};

// Admin Auth APIs
export const adminLogin = (email, password) => request('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password })
});
export const adminLogout = () => request('/auth/logout', { method: 'POST' });
export const adminLogoutAll = () => request('/auth/logout-all', { method: 'POST' });
export const adminRefreshToken = () => refreshAccessToken();
export const adminGetSessions = () => request('/auth/sessions');
export const adminGetMe = () => request('/auth/me');

// Admin Management APIs
export const adminGetDashboard = () => request('/analytics/dashboard');
export const adminGetOrders = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return request(`/orders/admin?${query}`);
};
export const adminGetOrderById = (id) => request(`/orders/admin/${id}`);
export const adminUpdateOrderStatus = (id, status, note) => request(`/orders/admin/${id}/status`, {
  method: 'PATCH',
  body: JSON.stringify({ status, note })
});
export const adminUpdateCustomerDetails = (id, customerData) => request(`/orders/admin/${id}/customer`, {
  method: 'PUT',
  body: JSON.stringify(customerData)
});
export const adminUpdateOrderItems = (id, itemsData) => request(`/orders/admin/${id}/items`, {
  method: 'PUT',
  body: JSON.stringify(itemsData)
});
export const adminAdjustStock = (productId, colorName, size, newStock) => request('/orders/admin/inventory/adjust', {
  method: 'POST',
  body: JSON.stringify({ productId, colorName, size, newStock })
});

export const adminGetProducts = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return request(`/products/admin/all?${query}`);
};
export const adminGetProductById = (id) => request(`/products/admin/${id}`);
export const adminCreateProduct = (data) => request('/products', {
  method: 'POST',
  body: JSON.stringify(data)
});
export const adminUpdateProduct = (id, data) => request(`/products/${id}`, {
  method: 'PUT',
  body: JSON.stringify(data)
});
export const adminArchiveProduct = (id) => request(`/products/${id}`, { method: 'DELETE' });

export const adminGetCategories = () => request('/categories/admin/all');
export const adminCreateCategory = (data) => request('/categories', {
  method: 'POST',
  body: JSON.stringify(data)
});
export const adminUpdateCategory = (id, data) => request(`/categories/${id}`, {
  method: 'PUT',
  body: JSON.stringify(data)
});
export const adminArchiveCategory = (id) => request(`/categories/${id}`, { method: 'DELETE' });

export const adminUpdateDeliverySettings = (data) => request('/settings/delivery', {
  method: 'PUT',
  body: JSON.stringify(data)
});

// Admin Banners APIs
export const adminGetBanners = () => request('/banners/admin/all');
export const adminCreateBanner = (data) => request('/banners', {
  method: 'POST',
  body: JSON.stringify(data)
});
export const adminUpdateBanner = (id, data) => request(`/banners/${id}`, {
  method: 'PUT',
  body: JSON.stringify(data)
});
export const adminDeleteBanner = (id) => request(`/banners/${id}`, { method: 'DELETE' });

export const adminUploadImage = async (file) => {
  const formData = new FormData();
  formData.append('image', file);
  return request('/upload', {
    method: 'POST',
    body: formData
  });
};
