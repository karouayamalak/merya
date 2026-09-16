import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  ShoppingBag,
  Layers,
  Tag,
  Warehouse,
  Settings,
  LogOut,
  ExternalLink,
  Bell,
  Image as ImageIcon,
  Menu,
  X
} from 'lucide-react';
import { useAdminAuth } from '../../context/AdminAuthContext';
import { useWebSocket } from '../../context/WebSocketContext';
import { useLanguage } from '../../context/LanguageContext';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import DashboardOverview from './DashboardOverview';
import OrdersManager from './OrdersManager';
import ProductsManager from './ProductsManager';
import CategoriesManager from './CategoriesManager';
import InventoryManager from './InventoryManager';
import DeliverySettingsManager from './DeliverySettingsManager';
import BannersManager from './BannersManager';
import ErrorBoundary from '../../components/ErrorBoundary';

export default function AdminLayout({ onExitAdmin }) {
  const { admin, logout } = useAdminAuth();
  const { subscribeAdmin } = useWebSocket();
  const { t, isRtl, formatCurrency } = useLanguage();

  const [activeTab, setActiveTab] = useState('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [liveNotification, setLiveNotification] = useState(null);

  // Close mobile drawer on Escape key press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Prevent background scrolling when mobile menu drawer is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  // Subscribe to live admin events (new orders, status updates)
  useEffect(() => {
    const unsubscribe = subscribeAdmin((event) => {
      console.log('[Admin WebSocket] Event received:', event);
      if (event.type === 'NEW_ORDER_RECEIVED') {
        setLiveNotification({
          title: t('confirmation.thankYou'),
          message: `${event.order.customerName} (#${event.order.orderCode} - ${formatCurrency(event.order.totalPrice)})`,
          time: new Date().toLocaleTimeString()
        });

        // Clear after 6 seconds
        setTimeout(() => setLiveNotification(null), 6000);
      }
    });

    return () => unsubscribe();
  }, [subscribeAdmin, t, formatCurrency]);

  const navItems = [
    { id: 'overview', label: t('admin.nav.dashboard'), icon: LayoutDashboard },
    { id: 'orders', label: t('admin.nav.orders'), icon: ShoppingBag },
    { id: 'products', label: t('admin.nav.products'), icon: Layers },
    { id: 'categories', label: t('admin.nav.categories'), icon: Tag },
    { id: 'inventory', label: t('admin.nav.inventory'), icon: Warehouse },
    { id: 'banners', label: t('admin.nav.banners'), icon: ImageIcon },
    { id: 'settings', label: t('admin.nav.delivery'), icon: Settings }
  ];

  const currentTabObj = navItems.find((i) => i.id === activeTab);

  return (
    <div
      className="admin-layout-wrapper"
      dir={isRtl ? 'rtl' : 'ltr'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        backgroundColor: 'var(--color-bg-base)'
      }}
    >
      <style>{`
        /* Desktop Default */
        .admin-mobile-header {
          display: none;
        }
        .admin-close-btn {
          display: none;
        }
        .admin-sidebar {
          width: 260px;
          background-color: var(--color-surface);
          border-inline-end: 1px solid var(--color-border);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          position: sticky;
          top: 0;
          height: 100vh;
          z-index: 50;
          flex-shrink: 0;
          overflow-y: auto;
        }
        .admin-body-flex {
          display: flex;
          flex: 1;
          min-height: 100vh;
          position: relative;
        }
        .admin-main-content {
          flex: 1;
          padding: 2.5rem;
          overflow-y: auto;
          min-width: 0;
          box-sizing: border-box;
        }
        .admin-drawer-backdrop {
          display: none;
        }

        /* Mobile & Tablet Styles (<= 1024px) */
        @media (max-width: 1024px) {
          .admin-mobile-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.75rem 1rem;
            background-color: var(--color-surface);
            border-bottom: 1px solid var(--color-border);
            position: sticky;
            top: 0;
            z-index: 60;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
          }
          .admin-body-flex {
            display: block !important;
            min-height: calc(100vh - 60px);
          }
          .admin-close-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            border: none;
            cursor: pointer;
            padding: 0.4rem;
            color: var(--color-espresso);
            border-radius: var(--radius-sm);
          }
          .admin-sidebar {
            position: fixed !important;
            top: 0 !important;
            bottom: 0 !important;
            ${isRtl ? 'right: 0 !important;' : 'left: 0 !important;'}
            width: 280px !important;
            max-width: 85vw !important;
            height: 100vh !important;
            z-index: 1000 !important;
            box-shadow: ${isRtl ? '-10px 0 30px rgba(0,0,0,0.18)' : '10px 0 30px rgba(0,0,0,0.18)'};
            transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
            transform: ${
              mobileMenuOpen
                ? 'translateX(0)'
                : isRtl
                  ? 'translateX(100%)'
                  : 'translateX(-100%)'
            } !important;
          }
          .admin-drawer-backdrop {
            display: ${mobileMenuOpen ? 'block' : 'none'};
            position: fixed;
            inset: 0;
            background-color: rgba(26, 20, 16, 0.5);
            backdrop-filter: blur(3px);
            z-index: 999;
          }
          .admin-main-content {
            padding: 1.5rem 1rem !important;
          }
        }

        @media (max-width: 640px) {
          .admin-main-content {
            padding: 1rem 0.75rem !important;
          }
        }
      `}</style>

      {/* Top Mobile Bar */}
      <header className="admin-mobile-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open menu"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--color-bg-card)',
              border: '1.5px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '0.45rem',
              cursor: 'pointer',
              color: 'var(--color-espresso)'
            }}
          >
            <Menu size={20} />
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <img src="/logo.png" alt="MERYA DZ" style={{ height: '28px', width: 'auto' }} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: '800', letterSpacing: '0.04em', lineHeight: 1.1 }}>
                MERYA DZ
              </span>
              <span style={{ fontSize: '0.65rem', color: 'var(--color-primary-dark)', fontWeight: '700' }}>
                {t('admin.portalTitle')}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {currentTabObj && (
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: '700',
                backgroundColor: 'var(--color-espresso)',
                color: '#FFFFFF',
                padding: '0.25rem 0.65rem',
                borderRadius: '9999px'
              }}
            >
              {currentTabObj.label}
            </span>
          )}
          <LanguageSwitcher />
        </div>
      </header>

      <div className="admin-body-flex">
        {/* Backdrop for mobile drawer */}
        <div
          className="admin-drawer-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />

        {/* Sidebar Navigation */}
        <aside className="admin-sidebar">
          <div>
            {/* Brand Header */}
            <div
              style={{
                padding: '1.5rem 1.25rem',
                borderBottom: '1px solid var(--color-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <img src="/logo.png" alt="MERYA DZ" style={{ height: '36px', width: 'auto' }} />
                <div>
                  <div style={{ fontSize: '0.88rem', fontWeight: '800', letterSpacing: '0.04em' }}>MERYA DZ</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--color-primary-dark)', fontWeight: '700', textTransform: 'uppercase' }}>
                    {t('admin.portalTitle')}
                  </div>
                </div>
              </div>

              {/* Close Button on Mobile */}
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="admin-close-btn"
                aria-label="Close menu"
              >
                <X size={20} />
              </button>
            </div>

            {/* Navigation Items */}
            <nav style={{ padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.75rem 1rem',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '0.85rem',
                      fontWeight: isActive ? '700' : '500',
                      backgroundColor: isActive ? 'var(--color-espresso)' : 'transparent',
                      color: isActive ? '#FFFFFF' : 'var(--color-espresso)',
                      transition: 'var(--transition-fast)',
                      textAlign: isRtl ? 'right' : 'left',
                      width: '100%',
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <Icon size={18} style={{ flexShrink: 0 }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* User & Storefront Exit */}
          <div
            style={{
              padding: '1rem',
              borderTop: '1px solid var(--color-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem'
            }}
          >
            {/* Language Switcher */}
            <div
              style={{
                padding: '0.4rem 0.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <span style={{ fontSize: '0.75rem', color: '#777', fontWeight: '600' }}>
                {t('admin.language')}
              </span>
              <LanguageSwitcher />
            </div>

            <div style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', color: '#666' }}>
              {t('admin.welcome').replace('{name}', admin?.username || 'Store Owner')}
            </div>

            <button
              onClick={() => {
                onExitAdmin();
                setMobileMenuOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.65rem 1rem',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.82rem',
                color: 'var(--color-espresso)',
                backgroundColor: 'var(--color-bg-card)',
                border: '1px solid var(--color-border)',
                cursor: 'pointer'
              }}
            >
              <ExternalLink size={15} className="rtl-flip" style={{ flexShrink: 0 }} />
              <span>{t('admin.backToStore')}</span>
            </button>

            <button
              onClick={() => {
                logout();
                setMobileMenuOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.65rem 1rem',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.82rem',
                color: 'var(--color-danger)',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              <LogOut size={15} className="rtl-flip" style={{ flexShrink: 0 }} />
              <span>{t('admin.logout')}</span>
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="admin-main-content">
          {/* Live Notification Pop-up */}
          {liveNotification && (
            <div
              style={{
                position: 'fixed',
                bottom: '24px',
                [isRtl ? 'left' : 'right']: '24px',
                backgroundColor: 'var(--color-espresso)',
                color: '#FFFFFF',
                borderRadius: 'var(--radius-lg)',
                padding: '1.25rem 1.5rem',
                boxShadow: 'var(--shadow-lg)',
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                zIndex: 1000,
                animation: 'slideIn 0.3s ease',
                maxWidth: 'calc(100vw - 48px)'
              }}
            >
              <div style={{ backgroundColor: 'var(--color-primary)', padding: '0.5rem', borderRadius: '50%', flexShrink: 0 }}>
                <Bell size={20} color="#FFFFFF" />
              </div>
              <div>
                <div style={{ fontWeight: '700', fontSize: '0.9rem' }}>{liveNotification.title}</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--color-primary-light)' }}>{liveNotification.message}</div>
              </div>
            </div>
          )}

          {/* Tab Router wrapped in ErrorBoundary */}
          <ErrorBoundary fallbackTitle="Erreur dans le panneau d'administration">
            {activeTab === 'overview' && <DashboardOverview onNavigateToOrders={() => setActiveTab('orders')} />}
            {activeTab === 'orders' && <OrdersManager />}
            {activeTab === 'products' && <ProductsManager />}
            {activeTab === 'categories' && <CategoriesManager />}
            {activeTab === 'inventory' && <InventoryManager />}
            {activeTab === 'banners' && <BannersManager />}
            {activeTab === 'settings' && <DeliverySettingsManager />}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
