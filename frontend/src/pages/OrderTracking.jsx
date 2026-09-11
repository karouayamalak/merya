import React, { useState, useEffect } from 'react';
import { Compass, Search, CheckCircle, Clock, Truck, Building2, PackageCheck, XCircle, Wifi, AlertCircle, Loader2 } from 'lucide-react';
import { trackOrder } from '../services/api';
import { useWebSocket } from '../context/WebSocketContext';

const STATUS_STEPS_HOME = [
  { key: 'Pending', label: 'Order Received', labelAr: 'تم الاستلام', icon: Clock },
  { key: 'Confirmed', label: 'Confirmed', labelAr: 'تم التأكيد', icon: CheckCircle },
  { key: 'On the way', label: 'On The Way', labelAr: 'جاري التوصيل', icon: Truck },
  { key: 'Delivered', label: 'Delivered', labelAr: 'تم التسليم', icon: PackageCheck }
];

const STATUS_STEPS_AGENCY = [
  { key: 'Pending', label: 'Order Received', labelAr: 'تم الاستلام', icon: Clock },
  { key: 'Confirmed', label: 'Confirmed', labelAr: 'تم التأكيد', icon: CheckCircle },
  { key: 'On the way', label: 'Dispatched', labelAr: 'تم الشحن', icon: Truck },
  { key: 'At agency', label: 'At Stopdesk/Bureau', labelAr: 'في المكتب', icon: Building2 },
  { key: 'Delivered', label: 'Delivered', labelAr: 'تم الاستلام', icon: PackageCheck }
];

export default function OrderTracking({ initialPhone = '', initialOrderCode = '' }) {
  const { isConnected, subscribeOrder } = useWebSocket();

  const [phone, setPhone] = useState(initialPhone);
  const [orderCode, setOrderCode] = useState(initialOrderCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [orderData, setOrderData] = useState(null);
  const [liveFlash, setLiveFlash] = useState(false);

  // If initial props are provided, trigger search automatically
  useEffect(() => {
    if (initialPhone && initialOrderCode) {
      handleLookup(initialPhone, initialOrderCode);
    }
  }, [initialPhone, initialOrderCode]);

  // Subscribe to real-time WebSocket updates whenever order is loaded
  useEffect(() => {
    if (!orderData?.orderCode) return;

    const unsubscribe = subscribeOrder(orderData.orderCode, phone, (event) => {
      console.log('[WebSocket Tracking] Received status update:', event);
      setOrderData((prev) => prev ? { ...prev, status: event.status } : null);
      setLiveFlash(true);
      setTimeout(() => setLiveFlash(false), 3000);
    });

    return () => unsubscribe();
  }, [orderData?.orderCode, phone, subscribeOrder]);

  const handleLookup = async (phoneVal = phone, codeVal = orderCode) => {
    if (!phoneVal.trim() || !codeVal.trim()) {
      setError('Please enter both your phone number and order tracking code');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await trackOrder(phoneVal.trim(), codeVal.trim().toUpperCase());
      if (res.success) {
        setOrderData(res.order);
      } else {
        setError(res.message || 'Order not found');
        setOrderData(null);
      }
    } catch (err) {
      setError(err.message || 'No order found matching this tracking code and phone number');
      setOrderData(null);
    } finally {
      setLoading(false);
    }
  };

  const getStepIndex = (status, steps) => {
    if (status === 'Cancelled') return -1;
    return steps.findIndex(s => s.key.toLowerCase() === status.toLowerCase());
  };

  const currentSteps = orderData?.deliveryMethod === 'agency' ? STATUS_STEPS_AGENCY : STATUS_STEPS_HOME;
  const currentStepIdx = orderData ? getStepIndex(orderData.status, currentSteps) : -1;

  return (
    <div style={{ paddingTop: '3rem', paddingBottom: '6rem' }}>
      <div className="container" style={{ maxWidth: '800px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            backgroundColor: 'var(--color-bg-card)',
            padding: '0.4rem 0.9rem',
            borderRadius: 'var(--radius-full)',
            fontSize: '0.78rem',
            fontWeight: '700',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--color-primary-dark)',
            marginBottom: '1rem'
          }}>
            <Compass size={14} />
            Live Delivery Tracking
          </div>

          <h1 className="heading-display" style={{ fontSize: 'clamp(2rem, 4vw, 2.7rem)', color: 'var(--color-espresso)' }}>
            TRACK YOUR ORDER
          </h1>
          <p style={{ fontSize: '0.95rem', color: '#666', marginTop: '0.5rem' }}>
            Enter your phone number and the unique order code received after checkout.
          </p>
        </div>

        {/* Tracking Search Box */}
        <div style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl)',
          padding: '2rem',
          boxShadow: 'var(--shadow-md)',
          border: '1px solid var(--color-border)',
          marginBottom: '3rem'
        }}>
          <form
            onSubmit={(e) => { e.preventDefault(); handleLookup(); }}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr)) 140px', gap: '1rem', alignItems: 'flex-end' }}
          >
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
                Phone Number
              </label>
              <input
                type="tel"
                required
                placeholder="e.g. 0550123456"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.8rem 1rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-bg-base)'
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
                Order Code
              </label>
              <input
                type="text"
                required
                placeholder="e.g. MD-8K3N9P"
                value={orderCode}
                onChange={(e) => setOrderCode(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.8rem 1rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-bg-base)',
                  textTransform: 'uppercase',
                  fontWeight: '700',
                  letterSpacing: '0.05em'
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ padding: '0.85rem 1rem', height: '48px', width: '100%' }}
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
              <span>Track</span>
            </button>
          </form>

          {error && (
            <div style={{
              marginTop: '1.25rem',
              backgroundColor: '#FFEBEE',
              border: '1px solid #FFCDD2',
              color: 'var(--color-danger)',
              padding: '0.85rem 1.25rem',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              fontSize: '0.85rem'
            }}>
              <AlertCircle size={17} flexShrink={0} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Real-time Result Card */}
        {orderData && (
          <div style={{
            backgroundColor: 'var(--color-surface)',
            borderRadius: 'var(--radius-xl)',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-lg)',
            border: liveFlash ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
            transition: 'var(--transition-smooth)'
          }}>
            {/* Real-time indicator bar */}
            <div style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: 'var(--color-espresso)',
              color: '#FFF',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '0.8rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Wifi size={14} color={isConnected ? '#4CAF50' : '#FF9800'} />
                <span>{isConnected ? 'Real-Time Updates Active' : 'Connecting to Live Updates...'}</span>
              </div>
              <span style={{ fontFamily: 'monospace', fontWeight: '700', letterSpacing: '0.05em' }}>
                {orderData.orderCode}
              </span>
            </div>

            <div style={{ padding: '2rem' }}>
              {/* Status Header */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '1rem',
                marginBottom: '2.5rem'
              }}>
                <div>
                  <span style={{ fontSize: '0.8rem', color: '#777', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Current Status
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.25rem' }}>
                    <h2 style={{ fontSize: '1.6rem', fontWeight: '800', color: 'var(--color-espresso)' }}>
                      {orderData.status}
                    </h2>
                    {orderData.status === 'Cancelled' ? (
                      <span className="badge badge-cancelled">Cancelled</span>
                    ) : (
                      <span className={`badge badge-${orderData.status.toLowerCase().replace(/\s+/g, '')}`}>
                        Active Delivery
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '0.8rem', color: '#777', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Delivery Wilaya
                  </span>
                  <div style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--color-espresso)', marginTop: '0.2rem' }}>
                    {orderData.wilaya} ({orderData.deliveryMethod === 'agency' ? 'Agency Pickup' : 'Home Delivery'})
                  </div>
                  {orderData.agencyName && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-primary-dark)', fontWeight: '600' }}>
                      {orderData.agencyName}
                    </div>
                  )}
                </div>
              </div>

              {/* Progress Stepper (Timeline) */}
              {orderData.status !== 'Cancelled' ? (
                <div style={{ marginBottom: '3rem', position: 'relative' }}>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${currentSteps.length}, 1fr)`,
                    position: 'relative',
                    textAlign: 'center'
                  }}>
                    {currentSteps.map((step, idx) => {
                      const Icon = step.icon;
                      const isCompleted = idx <= currentStepIdx;
                      const isCurrent = idx === currentStepIdx;

                      return (
                        <div key={step.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                          {/* Circle Icon */}
                          <div style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '50%',
                            backgroundColor: isCurrent ? 'var(--color-espresso)' : (isCompleted ? 'var(--color-primary)' : 'var(--color-bg-card)'),
                            color: isCompleted ? '#FFFFFF' : '#888',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginBottom: '0.75rem',
                            zIndex: 2,
                            boxShadow: isCurrent ? '0 0 0 4px rgba(42, 36, 31, 0.15)' : 'none',
                            transition: 'var(--transition-smooth)'
                          }}>
                            <Icon size={20} />
                          </div>

                          <div style={{ fontSize: '0.82rem', fontWeight: isCurrent ? '800' : '600', color: isCompleted ? 'var(--color-espresso)' : '#999' }}>
                            {step.label}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#888', marginTop: '0.1rem' }}>
                            {step.labelAr}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div style={{
                  padding: '1.5rem',
                  backgroundColor: '#FFEBEE',
                  borderRadius: 'var(--radius-lg)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  marginBottom: '2.5rem'
                }}>
                  <XCircle size={28} color="var(--color-danger)" />
                  <div>
                    <h4 style={{ fontWeight: '700', color: 'var(--color-danger)' }}>This order has been cancelled</h4>
                    <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.2rem' }}>
                      Reserved stock was safely restored. If you have any questions, please contact our support team.
                    </p>
                  </div>
                </div>
              )}

              {/* Items List in Order */}
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.75rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '1.25rem' }}>
                  Items in Package
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {orderData.items.map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                      <img
                        src={item.image || 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?q=80&w=200&auto=format&fit=crop'}
                        alt=""
                        style={{ width: '48px', height: '62px', borderRadius: 'var(--radius-sm)', objectFit: 'cover' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.9rem', fontWeight: '600' }}>{item.productName}</div>
                        <div style={{ fontSize: '0.78rem', color: '#666' }}>
                          Color: {item.colorName} • Size: {item.size} • Qty: {item.quantity}
                        </div>
                      </div>
                      <div style={{ fontSize: '0.95rem', fontWeight: '700' }}>
                        {(item.unitPrice * item.quantity).toLocaleString()} DZD
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{
                  borderTop: '1px solid var(--color-border)',
                  marginTop: '1.5rem',
                  paddingTop: '1rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span style={{ fontSize: '1rem', fontWeight: '700' }}>Total (Cash on Delivery)</span>
                  <span style={{ fontSize: '1.3rem', fontWeight: '800', color: 'var(--color-espresso)' }}>
                    {orderData.totalPrice.toLocaleString()} DZD
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
