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
  CheckCircle2,
  Sparkles
} from 'lucide-react';
import { useAdminAuth } from '../../context/AdminAuthContext';
import { useWebSocket } from '../../context/WebSocketContext';
import DashboardOverview from './DashboardOverview';
import OrdersManager from './OrdersManager';
import ProductsManager from './ProductsManager';
import CategoriesManager from './CategoriesManager';
import InventoryManager from './InventoryManager';
import DeliverySettingsManager from './DeliverySettingsManager';

export default function AdminLayout({ onExitAdmin }) {
  const { admin, logout } = useAdminAuth();
  const { subscribeAdmin } = useWebSocket();

  const [activeTab, setActiveTab] = useState('overview');
  const [liveNotification, setLiveNotification] = useState(null);

  // Subscribe to live admin events (new orders, status updates)
  useEffect(() => {
    const unsubscribe = subscribeAdmin((event) => {
      console.log('[Admin WebSocket] Event received:', event);
      if (event.type === 'NEW_ORDER_RECEIVED') {
        setLiveNotification({
          title: 'New Cash on Delivery Order Received!',
          message: `${event.order.customerName} placed order #${event.order.orderCode} (${event.order.totalPrice.toLocaleString()} DZD)`,
          time: new Date().toLocaleTimeString()
        });

        // Clear after 6 seconds
        setTimeout(() => setLiveNotification(null), 6000);
      }
    });

    return () => unsubscribe();
  }, [subscribeAdmin]);

  const navItems = [
    { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'orders', label: 'Orders', icon: ShoppingBag },
    { id: 'products', label: 'Products & Variants', icon: Layers },
    { id: 'categories', label: 'Categories', icon: Tag },
    { id: 'inventory', label: 'Inventory Stock', icon: Warehouse },
    { id: 'settings', label: 'Delivery Settings', icon: Settings }
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--color-bg-base)' }}>
      {/* Sidebar Navigation */}
      <aside style={{
        width: '260px',
        backgroundColor: 'var(--color-surface)',
        borderRight: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        height: '100vh',
        zIndex: 50
      }}>
        <div>
          {/* Brand Header */}
          <div style={{
            padding: '1.75rem 1.5rem',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem'
          }}>
            <img src="/logo.png" alt="MERYA DZ" style={{ height: '38px', width: 'auto' }} />
            <div>
              <div style={{ fontSize: '0.88rem', fontWeight: '800', letterSpacing: '0.04em' }}>MERYA DZ</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-primary-dark)', fontWeight: '700', textTransform: 'uppercase' }}>
                Admin Portal
              </div>
            </div>
          </div>

          {/* Navigation Items */}
          <nav style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
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
                    textAlign: 'left'
                  }}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* User & Storefront Exit */}
        <div style={{ padding: '1rem', borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ padding: '0.5rem', fontSize: '0.8rem', color: '#666' }}>
            Logged in as <strong>{admin?.username || 'Store Owner'}</strong>
          </div>

          <button
            onClick={onExitAdmin}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1rem',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.82rem',
              color: 'var(--color-espresso)',
              backgroundColor: 'var(--color-bg-card)'
            }}
          >
            <ExternalLink size={15} />
            <span>View Public Store</span>
          </button>

          <button
            onClick={logout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1rem',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.82rem',
              color: 'var(--color-danger)'
            }}
          >
            <LogOut size={15} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '2.5rem', overflowY: 'auto' }}>
        {/* Live Notification Pop-up */}
        {liveNotification && (
          <div style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            backgroundColor: 'var(--color-espresso)',
            color: '#FFFFFF',
            borderRadius: 'var(--radius-lg)',
            padding: '1.25rem 1.5rem',
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            zIndex: 1000,
            animation: 'slideIn 0.3s ease'
          }}>
            <div style={{ backgroundColor: 'var(--color-primary)', padding: '0.5rem', borderRadius: '50%' }}>
              <Bell size={20} color="#FFFFFF" />
            </div>
            <div>
              <div style={{ fontWeight: '700', fontSize: '0.9rem' }}>{liveNotification.title}</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--color-primary-light)' }}>{liveNotification.message}</div>
            </div>
          </div>
        )}

        {/* Tab Router */}
        {activeTab === 'overview' && <DashboardOverview onNavigateToOrders={() => setActiveTab('orders')} />}
        {activeTab === 'orders' && <OrdersManager />}
        {activeTab === 'products' && <ProductsManager />}
        {activeTab === 'categories' && <CategoriesManager />}
        {activeTab === 'inventory' && <InventoryManager />}
        {activeTab === 'settings' && <DeliverySettingsManager />}
      </main>
    </div>
  );
}
