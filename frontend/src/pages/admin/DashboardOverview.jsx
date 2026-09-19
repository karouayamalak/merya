import React, { useState, useEffect } from 'react';
import {
  DollarSign,
  TrendingUp,
  Package,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Truck,
  Building2,
  XCircle,
  RefreshCw
} from 'lucide-react';
import { adminGetDashboard } from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';

export default function DashboardOverview({ onNavigateToOrders }) {
  const { t, formatCurrency, localized } = useLanguage();
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await adminGetDashboard();
      if (res.success) {
        setMetrics(res.metrics);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        <div style={{ height: '36px', width: '240px' }} className="skeleton" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem' }}>
          {[1, 2, 3, 4].map(n => (
            <div key={n} style={{ height: '140px', borderRadius: 'var(--radius-lg)' }} className="skeleton" />
          ))}
        </div>
      </div>
    );
  }

  const statusMap = metrics?.statusCounts || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.85rem' }}>
        <div>
          <h1 className="heading-display" style={{ fontSize: '1.6rem', color: 'var(--color-espresso)' }}>
            {t('admin.dashboard.title').toUpperCase()}
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.2rem' }}>
            {t('admin.dashboard.quickStats')}
          </p>
        </div>

        <button
          onClick={loadData}
          className="btn btn-secondary btn-sm"
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <RefreshCw size={14} className="rtl-flip" />
          <span>{t('common.retry')}</span>
        </button>
      </div>

      {/* Primary KPI Cards */}
      <div className="admin-kpi-grid">
        {/* Realized Revenue */}
        <div style={{
          backgroundColor: 'var(--color-surface)',
          padding: 'clamp(0.85rem, 2.5vw, 1.5rem)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-sm)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#777' }}>
              {t('admin.dashboard.totalRevenue')}
            </span>
            <div style={{ backgroundColor: '#E8F5E9', padding: '0.35rem', borderRadius: 'var(--radius-sm)', color: 'var(--color-success)', flexShrink: 0 }}>
              <DollarSign size={16} />
            </div>
          </div>
          <div style={{ fontSize: 'clamp(1.15rem, 3.5vw, 1.7rem)', fontWeight: '800', color: 'var(--color-espresso)', marginTop: '0.4rem', wordBreak: 'break-word', lineHeight: 1.2 }}>
            {formatCurrency(metrics?.realizedRevenue || 0)}
          </div>
          <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '0.2rem' }}>
            {t('status.delivered')}
          </div>
        </div>

        {/* Realized Profit */}
        <div style={{
          backgroundColor: 'var(--color-surface)',
          padding: 'clamp(0.85rem, 2.5vw, 1.5rem)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-sm)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#777' }}>
              {t('admin.dashboard.netProfit')}
            </span>
            <div style={{ backgroundColor: 'var(--color-primary-subtle)', padding: '0.35rem', borderRadius: 'var(--radius-sm)', color: 'var(--color-primary-dark)', flexShrink: 0 }}>
              <TrendingUp size={16} />
            </div>
          </div>
          <div style={{
            fontSize: 'clamp(1.15rem, 3.5vw, 1.7rem)',
            fontWeight: '800',
            color: (metrics?.realizedProfit ?? 0) >= 0 ? 'var(--color-espresso)' : 'var(--color-danger)',
            marginTop: '0.4rem',
            wordBreak: 'break-word',
            lineHeight: 1.2
          }}>
            {formatCurrency(metrics?.realizedProfit || 0)}
          </div>
          <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '0.2rem' }}>
            {t('status.delivered')}
          </div>
        </div>

        {/* Total Orders */}
        <div
          onClick={() => onNavigateToOrders && onNavigateToOrders('')}
          style={{
            backgroundColor: 'var(--color-surface)',
            padding: 'clamp(0.85rem, 2.5vw, 1.5rem)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-sm)',
            cursor: 'pointer',
            transition: 'var(--transition-fast)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#777' }}>
              {t('admin.dashboard.totalOrders')}
            </span>
            <div style={{ backgroundColor: '#EDE7F6', padding: '0.35rem', borderRadius: 'var(--radius-sm)', color: '#6A1B9A', flexShrink: 0 }}>
              <Package size={16} />
            </div>
          </div>
          <div style={{ fontSize: 'clamp(1.15rem, 3.5vw, 1.7rem)', fontWeight: '800', color: 'var(--color-espresso)', marginTop: '0.4rem', lineHeight: 1.2 }}>
            {metrics?.totalOrders || 0}
          </div>
          <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '0.2rem' }}>
            {t('admin.orders.title')} →
          </div>
        </div>

        {/* Units Sold */}
        <div style={{
          backgroundColor: 'var(--color-surface)',
          padding: 'clamp(0.85rem, 2.5vw, 1.5rem)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-sm)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#777' }}>
              {t('admin.dashboard.deliveredOrders')}
            </span>
            <div style={{ backgroundColor: '#FFF3E0', padding: '0.35rem', borderRadius: 'var(--radius-sm)', color: '#EF6C00', flexShrink: 0 }}>
              <CheckCircle2 size={16} />
            </div>
          </div>
          <div style={{ fontSize: 'clamp(1.15rem, 3.5vw, 1.7rem)', fontWeight: '800', color: 'var(--color-espresso)', marginTop: '0.4rem', lineHeight: 1.2 }}>
            {metrics?.unitsSold || 0}
          </div>
          <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '0.2rem' }}>
            {t('admin.inventory.title')}
          </div>
        </div>
      </div>

      {/* Orders Status Matrix Breakdown */}
      <div style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-xl)',
        padding: 'clamp(1rem, 2.5vw, 1.75rem)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '0.92rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>
            {t('admin.orders.title')}
          </h3>
          <span style={{ fontSize: '0.72rem', color: '#888' }}>
            {t('common.tapToFilter') || 'Cliquez pour filtrer'}
          </span>
        </div>

        <div className="admin-status-grid">
          {/* Pending */}
          <div
            onClick={() => onNavigateToOrders && onNavigateToOrders('Pending')}
            style={{ padding: '0.9rem', backgroundColor: '#FFF8E1', borderRadius: 'var(--radius-md)', border: '1px solid #FFE082', cursor: 'pointer', transition: 'transform 0.15s ease' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#B78103', fontSize: '0.78rem', fontWeight: '700' }}>
              <Clock size={15} />
              <span>{t('status.pending')}</span>
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#B78103', marginTop: '0.35rem', lineHeight: 1.1 }}>
              {statusMap['Pending'] || 0}
            </div>
          </div>

          {/* Confirmed */}
          <div
            onClick={() => onNavigateToOrders && onNavigateToOrders('Confirmed')}
            style={{ padding: '0.9rem', backgroundColor: '#E3F2FD', borderRadius: 'var(--radius-md)', border: '1px solid #BBDEFB', cursor: 'pointer', transition: 'transform 0.15s ease' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#1565C0', fontSize: '0.78rem', fontWeight: '700' }}>
              <CheckCircle2 size={15} />
              <span>{t('status.confirmed')}</span>
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#1565C0', marginTop: '0.35rem', lineHeight: 1.1 }}>
              {statusMap['Confirmed'] || 0}
            </div>
          </div>

          {/* On the way */}
          <div
            onClick={() => onNavigateToOrders && onNavigateToOrders('On the way')}
            style={{ padding: '0.9rem', backgroundColor: '#EDE7F6', borderRadius: 'var(--radius-md)', border: '1px solid #D1C4E9', cursor: 'pointer', transition: 'transform 0.15s ease' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#6A1B9A', fontSize: '0.78rem', fontWeight: '700' }}>
              <Truck size={15} />
              <span>{t('status.onTheWay')}</span>
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#6A1B9A', marginTop: '0.35rem', lineHeight: 1.1 }}>
              {statusMap['On the way'] || 0}
            </div>
          </div>

          {/* At agency */}
          <div
            onClick={() => onNavigateToOrders && onNavigateToOrders('At agency')}
            style={{ padding: '0.9rem', backgroundColor: '#E0F2F1', borderRadius: 'var(--radius-md)', border: '1px solid #B2DFDB', cursor: 'pointer', transition: 'transform 0.15s ease' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#00695C', fontSize: '0.78rem', fontWeight: '700' }}>
              <Building2 size={15} />
              <span>{t('status.atAgency')}</span>
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#00695C', marginTop: '0.35rem', lineHeight: 1.1 }}>
              {statusMap['At agency'] || 0}
            </div>
          </div>

          {/* Delivered */}
          <div
            onClick={() => onNavigateToOrders && onNavigateToOrders('Delivered')}
            style={{ padding: '0.9rem', backgroundColor: '#E8F5E9', borderRadius: 'var(--radius-md)', border: '1px solid #C8E6C9', cursor: 'pointer', transition: 'transform 0.15s ease' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#2E7D32', fontSize: '0.78rem', fontWeight: '700' }}>
              <CheckCircle2 size={15} />
              <span>{t('status.delivered')}</span>
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#2E7D32', marginTop: '0.35rem', lineHeight: 1.1 }}>
              {statusMap['Delivered'] || 0}
            </div>
          </div>

          {/* Cancelled */}
          <div
            onClick={() => onNavigateToOrders && onNavigateToOrders('Cancelled')}
            style={{ padding: '0.9rem', backgroundColor: '#FFEBEE', borderRadius: 'var(--radius-md)', border: '1px solid #FFCDD2', cursor: 'pointer', transition: 'transform 0.15s ease' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#C62828', fontSize: '0.78rem', fontWeight: '700' }}>
              <XCircle size={15} />
              <span>{t('status.cancelled')}</span>
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#C62828', marginTop: '0.35rem', lineHeight: 1.1 }}>
              {statusMap['Cancelled'] || 0}
            </div>
          </div>
        </div>
      </div>

      {/* Low Stock Alerts */}
      <div style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-xl)',
        padding: 'clamp(1rem, 2.5vw, 1.75rem)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <AlertTriangle size={20} color="var(--color-warning)" />
          <h3 style={{ fontSize: '1rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {t('admin.inventory.lowStockAlert')}
          </h3>
        </div>

        {metrics?.lowStockItems?.length === 0 ? (
          <p style={{ fontSize: '0.88rem', color: '#666' }}>{t('product.inStock').replace('{count}', '')}</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: '1rem' }}>
            {metrics?.lowStockItems?.map((item, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  padding: '0.85rem 1rem',
                  backgroundColor: 'var(--color-bg-base)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)'
                }}
              >
                <img
                  src={item.image || 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?q=80&w=150&auto=format&fit=crop'}
                  alt=""
                  style={{ width: '40px', height: '52px', borderRadius: 'var(--radius-sm)', objectFit: 'cover' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: '700' }}>
                    {typeof item.productName === 'object' ? (localized(item.productName) || item.productName?.fr || item.productName?.en || '—') : (item.productName || '—')}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#666' }}>
                    {item.colorDisplayName ? (localized(item.colorDisplayName) || item.colorName) : item.colorName} • {t('cart.size')} {item.size}
                  </div>
                </div>
                <div style={{
                  padding: '0.3rem 0.6rem',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: item.stock === 0 ? '#FFEBEE' : '#FFF3E0',
                  color: item.stock === 0 ? 'var(--color-danger)' : 'var(--color-warning)',
                  fontWeight: '800',
                  fontSize: '0.82rem'
                }}>
                  {item.stock === 0 ? t('product.soldOut') : t('product.onlyLeft').replace('{count}', item.stock)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
