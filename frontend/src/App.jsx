import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import CartDrawer from './components/CartDrawer';
import Home from './pages/Home';
import Shop from './pages/Shop';
import ProductDetail from './pages/ProductDetail';
import Checkout from './pages/Checkout';
import OrderConfirmation from './pages/OrderConfirmation';
import OrderTracking from './pages/OrderTracking';
import AdminLogin from './pages/admin/AdminLogin';
import AdminLayout from './pages/admin/AdminLayout';
import AnnouncementBar from './components/AnnouncementBar';
import { useAdminAuth } from './context/AdminAuthContext';
import { fetchProductBySlug, fetchBanners } from './services/api';

export default function App() {
  const { isAuthenticated } = useAdminAuth();

  const getProductSlugFromPath = () => {
    const rawPath = window.location.pathname;
    const match = rawPath.match(/^\/products?\/([^/]+)/i);
    return match ? decodeURIComponent(match[1]) : null;
  };

  const getViewFromPath = useCallback(() => {
    const rawPath = window.location.pathname.toLowerCase();
    const path = rawPath.replace(/\/+$/, '') || '/';
    if (path.startsWith('/admin')) {
      return isAuthenticated ? 'admin-portal' : 'admin-login';
    }
    if (path === '/tracking') return 'tracking';
    if (path === '/shop') return 'shop';
    if (path === '/checkout') return 'checkout';
    if (path === '/order-confirmation') return 'order-confirmation';
    if (path.startsWith('/product/') || path.startsWith('/products/')) return 'product-detail';
    return 'home';
  }, [isAuthenticated]);

  // Navigation router state
  const [currentView, setCurrentViewState] = useState(getViewFromPath);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [_productLoading, setProductLoading] = useState(false);
  const [announcementBanners, setAnnouncementBanners] = useState([]);

  useEffect(() => {
    fetchBanners({ isActive: 'true', placement: 'top_announcement' })
      .then(res => {
        if (res && res.success && res.banners) {
          setAnnouncementBanners(res.banners);
        }
      })
      .catch(err => console.error('Failed to load announcements:', err));
  }, []);

  const setCurrentView = (view, customPath) => {
    setCurrentViewState(view);
    let targetPath = '/';
    if (customPath) targetPath = customPath;
    else if (view === 'admin-portal' || view === 'admin-login') targetPath = '/admin';
    else if (view === 'shop') targetPath = '/shop';
    else if (view === 'checkout') targetPath = '/checkout';
    else if (view === 'tracking') targetPath = '/tracking';
    else if (view === 'order-confirmation') targetPath = '/order-confirmation';
    else if (view === 'home') targetPath = '/';

    if (window.location.pathname !== targetPath) {
      window.history.pushState(null, '', targetPath);
    }
  };

  // Load product by slug on initial mount, direct navigation, or popstate
  const loadProductBySlug = (slug) => {
    if (!slug) return;
    setProductLoading(true);
    fetchProductBySlug(slug)
      .then((res) => {
        if (res && res.success && res.product) {
          setSelectedProduct(res.product);
        } else {
          setCurrentView('shop');
        }
      })
      .catch(() => {
        setCurrentView('shop');
      })
      .finally(() => {
        setProductLoading(false);
      });
  };

  // Initial slug check on mount
  useEffect(() => {
    const slug = getProductSlugFromPath();
    if (slug) {
      loadProductBySlug(slug);
    }
  }, []);

  // Listen for browser forward/back buttons
  useEffect(() => {
    const handlePopState = () => {
      const view = getViewFromPath();
      setCurrentViewState(view);
      const slug = getProductSlugFromPath();
      if (view === 'product-detail' && slug) {
        loadProductBySlug(slug);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [getViewFromPath]);

  // Completed order data for confirmation & tracking (survives refresh via sessionStorage)
  const [confirmedOrder, setConfirmedOrder] = useState(() => {
    try {
      const stored = sessionStorage.getItem('merya_last_order');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [trackingPhone, setTrackingPhone] = useState('');
  const [trackingOrderCode, setTrackingOrderCode] = useState('');

  const navigateToProduct = (product) => {
    setSelectedProduct(product);
    const slugPath = product?.slug ? `/product/${encodeURIComponent(product.slug)}` : '/shop';
    setCurrentView('product-detail', slugPath);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOrderSuccess = (orderResponse) => {
    setConfirmedOrder(orderResponse);
    try {
      sessionStorage.setItem('merya_last_order', JSON.stringify(orderResponse));
    } catch {}
    setCurrentView('order-confirmation');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleContinueShopping = () => {
    try {
      sessionStorage.removeItem('merya_last_order');
    } catch {}
    setConfirmedOrder(null);
    setCurrentView('shop');
  };

  const handleTrackDirect = (phone, code) => {
    setTrackingPhone(phone);
    setTrackingOrderCode(code);
    setCurrentView('tracking');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // If viewing admin portal and authenticated
  if ((currentView === 'admin-portal' || currentView === 'admin-login') && isAuthenticated) {
    return <AdminLayout onExitAdmin={() => setCurrentView('home')} />;
  }

  // If on admin login page
  if (currentView === 'admin-login' || currentView === 'admin-portal') {
    return (
      <AdminLogin
        onLoginSuccess={() => setCurrentView('admin-portal')}
        onBackToStore={() => setCurrentView('home')}
      />
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Announcement Bar (Site-wide) */}
      <AnnouncementBar banners={announcementBanners} setCurrentView={setCurrentView} />

      {/* Top Header */}
      <Header currentView={currentView} setCurrentView={setCurrentView} />

      {/* Cart Drawer Slide-over */}
      <CartDrawer
        onProceedToCheckout={() => {
          setCurrentView('checkout');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onContinueShopping={() => setCurrentView('shop')}
      />

      {/* Main Page View Router */}
      <main style={{ flex: 1 }}>
        {currentView === 'home' && (
          <Home
            setCurrentView={setCurrentView}
            setSelectedProduct={navigateToProduct}
            setSelectedCategory={setSelectedCategory}
          />
        )}

        {currentView === 'shop' && (
          <Shop
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            onSelectProduct={navigateToProduct}
          />
        )}

        {currentView === 'product-detail' && (
          selectedProduct ? (
            <ProductDetail
              product={selectedProduct}
              onBack={() => setCurrentView('shop')}
              onSelectRelated={navigateToProduct}
            />
          ) : (
            <div style={{ padding: '8rem 1rem', textAlign: 'center' }}>
              <div style={{
                width: '42px',
                height: '42px',
                margin: '0 auto',
                border: '3px solid rgba(111, 78, 55, 0.15)',
                borderTopColor: 'var(--color-espresso)',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite'
              }} />
            </div>
          )
        )}

        {currentView === 'checkout' && (
          <Checkout
            onBack={() => setCurrentView('shop')}
            onOrderSuccess={handleOrderSuccess}
          />
        )}

        {currentView === 'order-confirmation' && (
          <OrderConfirmation
            orderData={confirmedOrder}
            onTrackOrder={handleTrackDirect}
            onContinueShopping={handleContinueShopping}
          />
        )}

        {currentView === 'tracking' && (
          <OrderTracking
            initialPhone={trackingPhone}
            initialOrderCode={trackingOrderCode}
          />
        )}
      </main>

      {/* Footer */}
      <Footer setCurrentView={setCurrentView} />
    </div>
  );
}
