import React, { useState } from 'react';
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
import { useAdminAuth } from './context/AdminAuthContext';

export default function App() {
  const { isAuthenticated } = useAdminAuth();

  const getViewFromPath = () => {
    const rawPath = window.location.pathname.toLowerCase();
    const path = rawPath.replace(/\/+$/, '') || '/';
    if (path.startsWith('/admin')) {
      return isAuthenticated ? 'admin-portal' : 'admin-login';
    }
    if (path === '/tracking') return 'tracking';
    if (path === '/shop') return 'shop';
    if (path === '/checkout') return 'checkout';
    return 'home';
  };

  // Navigation router state
  const [currentView, setCurrentViewState] = useState(getViewFromPath);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('all');

  const setCurrentView = (view) => {
    setCurrentViewState(view);
    let targetPath = '/';
    if (view === 'admin-portal' || view === 'admin-login') targetPath = '/admin';
    else if (view === 'shop') targetPath = '/shop';
    else if (view === 'checkout') targetPath = '/checkout';
    else if (view === 'tracking') targetPath = '/tracking';
    else if (view === 'home') targetPath = '/';

    if (window.location.pathname !== targetPath) {
      window.history.pushState(null, '', targetPath);
    }
  };

  // Listen for browser forward/back buttons
  React.useEffect(() => {
    const handlePopState = () => {
      setCurrentViewState(getViewFromPath());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Completed order data for confirmation & tracking
  const [confirmedOrder, setConfirmedOrder] = useState(null);
  const [trackingPhone, setTrackingPhone] = useState('');
  const [trackingOrderCode, setTrackingOrderCode] = useState('');

  const navigateToProduct = (product) => {
    setSelectedProduct(product);
    setCurrentView('product-detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOrderSuccess = (orderResponse) => {
    setConfirmedOrder(orderResponse);
    setCurrentView('order-confirmation');
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

        {currentView === 'product-detail' && selectedProduct && (
          <ProductDetail
            product={selectedProduct}
            onBack={() => setCurrentView('shop')}
            onSelectRelated={navigateToProduct}
          />
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
            onContinueShopping={() => setCurrentView('shop')}
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
