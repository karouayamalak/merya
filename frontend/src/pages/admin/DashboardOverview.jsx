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

export default function DashboardOverview({ onNavigateToOrders }) {
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="heading-display" style={{ fontSize: '1.8rem', color: 'var(--color-espresso)' }}>
            BUSINESS DASHBOARD
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.2rem' }}>
            Authoritative performance indicators and realized financial records.
          </p>
        </div>

        <button
          onClick={loadData}
          className="btn btn-secondary btn-sm"
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <RefreshCw size={14} />
          <span>Refresh Data</span>
        </button>
      </div>

      {/* Primary KPI Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '1.5rem'
      }}>
        {/* Realized Revenue */}
        <div style={{
          backgroundColor: 'var(--color-surface)',
          padding: '1.75rem',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-sm)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#777' }}>
              Realized Revenue
            </span>
            <div style={{ backgroundColor: '#E8F5E9', padding: '0.4rem', borderRadius: 'var(--radius-sm)', color: 'var(--color-success)' }}>
              <DollarSign size={18} />
            </div>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: '800', color: 'var(--color-espresso)', marginTop: '0.75rem' }}>
            {(metrics?.realizedRevenue || 0).toLocaleString()} DZD
          </div>
          <div style={{ fontSize: '0.75rem', color: '#777', marginTop: '0.35rem' }}>
            Calculated strictly from <strong>Delivered</strong> orders
          </div>
        </div>

        {/* Realized Profit */}
        <div style={{
          backgroundColor: 'var(--color-surface)',
          padding: '1.75rem',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-sm)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#777' }}>
              Realized Profit
            </span>
            <div style={{ backgroundColor: 'var(--color-primary-subtle)', padding: '0.4rem', borderRadius: 'var(--radius-sm)', color: 'var(--color-primary-dark)' }}>
              <TrendingUp size={18} />
            </div>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: '800', color: 'var(--color-primary-dark)', marginTop: '0.75rem' }}>
            {(metrics?.realizedProfit || 0).toLocaleString()} DZD
          </div>
          <div style={{ fontSize: '0.75rem', color: '#777', marginTop: '0.35rem' }}>
            Net profit snapshot (Selling Price - Cost Price)
          </div>
        </div>

        {/* Total Orders */}
        <div
          onClick={onNavigateToOrders}
          style={{
            backgroundColor: 'var(--color-surface)',
            padding: '1.75rem',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-sm)',
            cursor: 'pointer'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#777' }}>
              Total Orders
            </span>
            <div style={{ backgroundColor: '#EDE7F6', padding: '0.4rem', borderRadius: 'var(--radius-sm)', color: '#6A1B9A' }}>
              <Package size={18} />
            </div>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: '800', color: 'var(--color-espresso)', marginTop: '0.75rem' }}>
            {metrics?.totalOrders || 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#777', marginTop: '0.35rem' }}>
            Click to manage all customer orders
          </div>
        </div>

        {/* Units Sold */}
        <div style={{
          backgroundColor: 'var(--color-surface)',
          padding: '1.75rem',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-sm)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#777' }}>
              Delivered Units
            </span>
            <div style={{ backgroundColor: '#FFF3E0', padding: '0.4rem', borderRadius: 'var(--radius-sm)', color: '#EF6C00' }}>
              <CheckCircle2 size={18} />
            </div>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: '800', color: 'var(--color-espresso)', marginTop: '0.75rem' }}>
            {metrics?.unitsSold || 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#777', marginTop: '0.35rem' }}>
            Items physically delivered to customers
          </div>
        </div>
      </div>

      {/* Orders Status Matrix Breakdown */}
      <div style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-xl)',
        padding: '2rem',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)'
      }}>
        <h3 style={{ fontSize: '1rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '1.5rem' }}>
          Order Pipeline Status
        </h3>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '1rem'
        }}>
          {/* Pending */}
          <div style={{ padding: '1.25rem', backgroundColor: '#FFF8E1', borderRadius: 'var(--radius-md)', border: '1px solid #FFE082' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#B78103', fontSize: '0.8rem', fontWeight: '700' }}>
              <Clock size={16} />
              <span>Pending</span>
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#B78103', marginTop: '0.5rem' }}>
              {statusMap['Pending'] || 0}
            </div>
          </div>

          {/* Confirmed */}
          <div style={{ padding: '1.25rem', backgroundColor: '#E3F2FD', borderRadius: 'var(--radius-md)', border: '1px solid #BBDEFB' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#1565C0', fontSize: '0.8rem', fontWeight: '700' }}>
              <CheckCircle2 size={16} />
              <span>Confirmed</span>
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#1565C0', marginTop: '0.5rem' }}>
              {statusMap['Confirmed'] || 0}
            </div>
          </div>

          {/* On the way */}
          <div style={{ padding: '1.25rem', backgroundColor: '#EDE7F6', borderRadius: 'var(--radius-md)', border: '1px solid #D1C4E9' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#6A1B9A', fontSize: '0.8rem', fontWeight: '700' }}>
              <Truck size={16} />
              <span>On The Way</span>
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#6A1B9A', marginTop: '0.5rem' }}>
              {statusMap['On the way'] || 0}
            </div>
          </div>

          {/* At agency */}
          <div style={{ padding: '1.25rem', backgroundColor: '#E0F2F1', borderRadius: 'var(--radius-md)', border: '1px solid #B2DFDB' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#00695C', fontSize: '0.8rem', fontWeight: '700' }}>
              <Building2 size={16} />
              <span>At Agency</span>
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#00695C', marginTop: '0.5rem' }}>
              {statusMap['At agency'] || 0}
            </div>
          </div>

          {/* Delivered */}
          <div style={{ padding: '1.25rem', backgroundColor: '#E8F5E9', borderRadius: 'var(--radius-md)', border: '1px solid #C8E6C9' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#2E7D32', fontSize: '0.8rem', fontWeight: '700' }}>
              <CheckCircle2 size={16} />
              <span>Delivered</span>
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#2E7D32', marginTop: '0.5rem' }}>
              {statusMap['Delivered'] || 0}
            </div>
          </div>

          {/* Cancelled */}
          <div style={{ padding: '1.25rem', backgroundColor: '#FFEBEE', borderRadius: 'var(--radius-md)', border: '1px solid #FFCDD2' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#C62828', fontSize: '0.8rem', fontWeight: '700' }}>
              <XCircle size={16} />
              <span>Cancelled</span>
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#C62828', marginTop: '0.5rem' }}>
              {statusMap['Cancelled'] || 0}
            </div>
          </div>
        </div>
      </div>

      {/* Low Stock Alerts */}
      <div style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-xl)',
        padding: '2rem',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <AlertTriangle size={20} color="var(--color-warning)" />
          <h3 style={{ fontSize: '1rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Low Stock Alerts (Items with 5 or fewer remaining)
          </h3>
        </div>

        {metrics?.lowStockItems?.length === 0 ? (
          <p style={{ fontSize: '0.88rem', color: '#666' }}>All inventory items have healthy stock levels.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
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
                  <div style={{ fontSize: '0.85rem', fontWeight: '700' }}>{item.productName}</div>
                  <div style={{ fontSize: '0.78rem', color: '#666' }}>
                    {item.colorName} • Size {item.size}
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
                  {item.stock === 0 ? 'SOLD OUT' : `${item.stock} left`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
