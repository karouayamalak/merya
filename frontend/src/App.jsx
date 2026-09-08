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

  // Navigation router state
  const [currentView, setCurrentView] = useState('home');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('all');

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
  if (currentView === 'admin-portal' && isAuthenticated) {
    return <AdminLayout onExitAdmin={() => setCurrentView('home')} />;
  }

  // If on admin login page
  if (currentView === 'admin-login') {
    if (isAuthenticated) {
      return <AdminLayout onExitAdmin={() => setCurrentView('home')} />;
    }
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
