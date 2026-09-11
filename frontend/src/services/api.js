const API_BASE = (import.meta.env.VITE_API_URL || '') + '/api/v1';

export function getImageUrl(imagePath) {
  if (!imagePath) return '';
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    return imagePath;
  }
  const backendBase = import.meta.env.VITE_BACKEND_URL || '';
  return `${backendBase}${imagePath}`;
}

async function request(endpoint, options = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('merya_admin_token') : null;
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  const config = {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...options.headers
    },
    ...options
  };

  // If body is FormData, delete Content-Type to let browser set boundary
  if (options.body instanceof FormData) {
    delete config.headers['Content-Type'];
  }

  const res = await fetch(`${API_BASE}${endpoint}`, config);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401 && token) {
      localStorage.removeItem('merya_admin_token');
    }
    throw new Error(data.message || (data.errors ? data.errors.join(', ') : 'Request failed'));
  }

  return data;
}

// Public Storefront APIs
export const fetchCategories = () => request('/categories');
export const fetchProducts = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return request(`/products?${query}`);
};
export const fetchProductBySlug = (slug) => request(`/products/slug/${slug}`);
export const fetchDeliverySettings = () => request('/settings/delivery');
export const submitCheckout = (orderData) => request('/orders/checkout', {
  method: 'POST',
  body: JSON.stringify(orderData)
});
export const trackOrder = (phone, orderCode) => request('/tracking', {
  method: 'POST',
  body: JSON.stringify({ phone, orderCode })
});

// Admin Auth APIs
export const adminLogin = (email, password) => request('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password })
});
export const adminLogout = () => request('/auth/logout', { method: 'POST' });
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

export const adminUploadImage = async (file) => {
  const formData = new FormData();
  formData.append('image', file);
  return request('/upload', {
    method: 'POST',
    body: formData
  });
};
