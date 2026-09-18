import React, { useState, useEffect, useCallback } from 'react';
import {
  Compass,
  Search,
  CheckCircle,
  Clock,
  Truck,
  Building2,
  PackageCheck,
  XCircle,
  Wifi,
  AlertCircle,
  Loader2,
  MapPin,
  Check,
  Calendar
} from 'lucide-react';
import { trackOrder, getImageUrl } from '../services/api';
import { useWebSocket } from '../context/WebSocketContext';
import { useLanguage } from '../context/LanguageContext';

const STATUS_STEPS_HOME = [
  { key: 'Pending', statusKey: 'pending', icon: Clock },
  { key: 'Confirmed', statusKey: 'confirmed', icon: CheckCircle },
  { key: 'On the way', statusKey: 'onTheWay', icon: Truck },
  { key: 'Delivered', statusKey: 'delivered', icon: PackageCheck }
];

const STATUS_STEPS_AGENCY = [
  { key: 'Pending', statusKey: 'pending', icon: Clock },
  { key: 'Confirmed', statusKey: 'confirmed', icon: CheckCircle },
  { key: 'On the way', statusKey: 'onTheWay', icon: Truck },
  { key: 'At agency', statusKey: 'atAgency', icon: Building2 },
  { key: 'Delivered', statusKey: 'delivered', icon: PackageCheck }
];

export default function OrderTracking({ initialPhone = '', initialOrderCode = '' }) {
  const { isConnected, subscribeOrder } = useWebSocket();
  const { t, isRtl, formatCurrency } = useLanguage();

  const [phone, setPhone] = useState(initialPhone);
  const [orderCode, setOrderCode] = useState(initialOrderCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [orderData, setOrderData] = useState(null);
  const [liveFlash, setLiveFlash] = useState(false);

  const handleLookup = useCallback(async (phoneVal = phone, codeVal = orderCode) => {
    if (!phoneVal.trim() || !codeVal.trim()) {
      setError(t('tracking.enterPhoneAndCode'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await trackOrder(phoneVal.trim(), codeVal.trim().toUpperCase());
      if (res.success) {
        setOrderData(res.order);
      } else {
        setError(res.message || t('tracking.notFoundDesc'));
        setOrderData(null);
      }
    } catch (err) {
      setError(err.message || t('tracking.notFoundDesc'));
      setOrderData(null);
    } finally {
      setLoading(false);
    }
  }, [phone, orderCode, t]);

  // If initial props are provided, trigger search automatically
  useEffect(() => {
    if (initialPhone && initialOrderCode) {
      handleLookup(initialPhone, initialOrderCode);
    }
  }, [initialPhone, initialOrderCode, handleLookup]);

  // Subscribe to real-time WebSocket updates whenever order is loaded
  useEffect(() => {
    if (!orderData?.orderCode) return;

    const unsubscribe = subscribeOrder(orderData.orderCode, phone, (event) => {
      console.log('[WebSocket Tracking] Status signal received, refreshing from API:', event.type);
      trackOrder(phone, orderData.orderCode)
        .then((res) => {
          if (res.success) {
            setOrderData(res.order);
          }
        })
        .catch((err) => {
          console.warn('[WebSocket Tracking] API refresh failed after WS signal:', err.message);
        });
      setLiveFlash(true);
      setTimeout(() => setLiveFlash(false), 3000);
    });

    return () => unsubscribe();
  }, [orderData?.orderCode, phone, subscribeOrder]);

  const getStepIndex = (status, steps) => {
    if (status === 'Cancelled') return -1;
    return steps.findIndex(s => s.key.toLowerCase() === status.toLowerCase());
  };

  const getStatusLabel = (status) => {
    const map = {
      'Pending': 'status.pending',
      'Confirmed': 'status.confirmed',
      'On the way': 'status.onTheWay',
      'At agency': 'status.atAgency',
      'Delivered': 'status.delivered',
      'Returned': 'status.returned',
      'Cancelled': 'status.cancelled'
    };
    const key = map[status];
    return key ? t(key) : status;
  };

  const formatTimelineDate = (isoString) => {
    if (!isoString) return null;
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleDateString(isRtl ? 'ar-DZ' : 'fr-FR', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return null;
    }
  };

  const getStepTimestamp = (stepKey) => {
    if (stepKey === 'Pending' && orderData?.createdAt) {
      return formatTimelineDate(orderData.createdAt);
    }
    if (!orderData?.timeline || !Array.isArray(orderData.timeline)) return null;
    const entry = orderData.timeline.find(e => e.status?.toLowerCase() === stepKey.toLowerCase());
    return entry ? formatTimelineDate(entry.timestamp) : null;
  };

  const currentSteps = orderData?.deliveryMethod === 'agency' ? STATUS_STEPS_AGENCY : STATUS_STEPS_HOME;
  const currentStepIdx = orderData ? getStepIndex(orderData.status, currentSteps) : -1;

  return (
    <div className="tracking-wrapper" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="container" style={{ maxWidth: '820px' }}>
        {/* Header */}
        <div className="tracking-header">
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
            marginBottom: '0.85rem'
          }}>
            <Compass size={14} className="rtl-flip" />
            {t('tracking.liveTracking')}
          </div>

          <h1 className="heading-display" style={{ fontSize: 'clamp(1.75rem, 5vw, 2.7rem)', color: 'var(--color-espresso)' }}>
            {t('tracking.title').toUpperCase()}
          </h1>

          <p style={{ fontSize: 'clamp(0.85rem, 2.5vw, 0.95rem)', color: '#666', marginTop: '0.4rem', maxWidth: '520px', marginInline: 'auto' }}>
            {t('tracking.subtitle')}
          </p>
        </div>

        {/* Tracking Search Card */}
        <div className="tracking-search-card">
          <form
            onSubmit={(e) => { e.preventDefault(); handleLookup(); }}
            className="tracking-search-form"
          >
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
                {t('tracking.phoneLabel')}
              </label>
              <input
                type="tel"
                required
                placeholder={t('tracking.phonePlaceholder')}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="tracking-input"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
                {t('tracking.codeLabel')}
              </label>
              <input
                type="text"
                required
                placeholder={t('tracking.codePlaceholder')}
                value={orderCode}
                onChange={(e) => setOrderCode(e.target.value)}
                className="tracking-input"
                autoCapitalize="characters"
                style={{ textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.05em' }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ padding: '0.85rem 1.4rem', height: '48px' }}
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
              <span>{t('tracking.trackBtn')}</span>
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
              <AlertCircle size={17} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Real-time Result Card */}
        {orderData && (
          <div className="tracking-result-card" style={{ border: liveFlash ? '2px solid var(--color-primary)' : '1px solid var(--color-border)' }}>
            {/* Real-time status bar */}
            <div className="tracking-live-bar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Wifi size={14} color={isConnected ? '#4CAF50' : '#FF9800'} />
                <span>{isConnected ? t('tracking.realTimeActive') : t('tracking.connectingToUpdates')}</span>
              </div>
              <span style={{
                fontFamily: 'monospace',
                fontWeight: '700',
                letterSpacing: '0.06em',
                backgroundColor: 'rgba(255, 255, 255, 0.12)',
                padding: '0.2rem 0.6rem',
                borderRadius: '4px'
              }}>
                {orderData.orderCode}
              </span>
            </div>

            <div className="tracking-card-body">
              {/* Status & Delivery Info Header */}
              <div className="tracking-status-header">
                <div>
                  <span style={{ fontSize: '0.78rem', color: '#777', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600' }}>
                    {t('tracking.currentStatus')}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                    <h2 style={{ fontSize: 'clamp(1.3rem, 3.5vw, 1.6rem)', fontWeight: '800', color: 'var(--color-espresso)', margin: 0 }}>
                      {getStatusLabel(orderData.status)}
                    </h2>
                    {orderData.status === 'Cancelled' ? (
                      <span className="badge badge-cancelled">{t('status.cancelled')}</span>
                    ) : (
                      <span className={`badge badge-${orderData.status.toLowerCase().replace(/\s+/g, '')}`}>
                        {getStatusLabel(orderData.status)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Wilaya & Destination Badge */}
                <div className="tracking-wilaya-box">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: '#777', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: '700' }}>
                    <MapPin size={13} />
                    <span>{t('tracking.wilaya')}</span>
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--color-espresso)', marginTop: '0.2rem' }}>
                    {orderData.wilaya} • <span style={{ color: 'var(--color-primary-dark)', fontWeight: '600' }}>{orderData.deliveryMethod === 'agency' ? t('checkout.agency') : t('checkout.home')}</span>
                  </div>
                  {orderData.agencyName && (
                    <div style={{ fontSize: '0.78rem', color: '#666', marginTop: '0.15rem' }}>
                      {orderData.agencyName}
                    </div>
                  )}
                  {orderData.createdAt && (
                    <div style={{ fontSize: '0.74rem', color: '#888', marginTop: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Calendar size={12} />
                      <span>{formatTimelineDate(orderData.createdAt)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Progress Steppers */}
              {orderData.status !== 'Cancelled' ? (
                <>
                  {/* Desktop Stepper (>= 641px) */}
                  <div className="tracking-stepper-desktop">
                    <div style={{ position: 'relative', marginBottom: '1rem' }}>
                      {/* Connecting Line behind circles */}
                      <div style={{
                        position: 'absolute',
                        top: '22px',
                        left: `${50 / currentSteps.length}%`,
                        right: `${50 / currentSteps.length}%`,
                        height: '3px',
                        backgroundColor: 'var(--color-border)',
                        zIndex: 1
                      }}>
                        <div style={{
                          height: '100%',
                          backgroundColor: 'var(--color-primary)',
                          width: `${Math.min(100, Math.max(0, (currentStepIdx / (currentSteps.length - 1)) * 100))}%`,
                          transition: 'width 0.4s ease'
                        }} />
                      </div>

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
                          const stepTime = getStepTimestamp(step.key);

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
                                {t('status.' + step.statusKey)}
                              </div>
                              {stepTime && (
                                <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '0.2rem' }}>
                                  {stepTime}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Mobile Stepper (<= 640px) */}
                  <div className="tracking-stepper-mobile">
                    {currentSteps.map((step, idx) => {
                      const Icon = step.icon;
                      const isCompleted = idx <= currentStepIdx;
                      const isCurrent = idx === currentStepIdx;
                      const isLast = idx === currentSteps.length - 1;
                      const stepTime = getStepTimestamp(step.key);

                      return (
                        <div key={step.key} className="tracking-mobile-step">
                          {/* Indicator Column: circle + connecting vertical line */}
                          <div className="tracking-mobile-indicator-col">
                            <div
                              className="tracking-mobile-icon-circle"
                              style={{
                                backgroundColor: isCurrent ? 'var(--color-espresso)' : (isCompleted ? 'var(--color-primary)' : 'var(--color-bg-card)'),
                                color: isCompleted ? '#FFFFFF' : '#888',
                                boxShadow: isCurrent ? '0 0 0 4px rgba(42, 36, 31, 0.18)' : 'none'
                              }}
                            >
                              <Icon size={18} />
                            </div>
                            {!isLast && (
                              <div
                                className="tracking-mobile-vertical-line"
                                style={{
                                  backgroundColor: idx < currentStepIdx ? 'var(--color-primary)' : 'var(--color-border)'
                                }}
                              />
                            )}
                          </div>

                          {/* Content Column */}
                          <div className="tracking-mobile-content">
                            <div style={{
                              backgroundColor: isCurrent ? 'var(--color-bg-subtle)' : 'transparent',
                              border: isCurrent ? '1px solid var(--color-border)' : '1px solid transparent',
                              borderRadius: 'var(--radius-md)',
                              padding: isCurrent ? '0.65rem 0.85rem' : '0.1rem 0'
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                                <div style={{
                                  fontSize: '0.92rem',
                                  fontWeight: isCurrent ? '800' : (isCompleted ? '700' : '500'),
                                  color: isCompleted ? 'var(--color-espresso)' : '#888'
                                }}>
                                  {t('status.' + step.statusKey)}
                                </div>
                                {isCurrent ? (
                                  <span style={{
                                    fontSize: '0.68rem',
                                    fontWeight: '700',
                                    color: 'var(--color-espresso)',
                                    backgroundColor: 'var(--color-primary-light)',
                                    padding: '0.2rem 0.5rem',
                                    borderRadius: 'var(--radius-full)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.25rem'
                                  }}>
                                    <Clock size={11} />
                                    {isRtl ? 'الحالة الحالية' : 'Étape actuelle'}
                                  </span>
                                ) : isCompleted ? (
                                  <span style={{
                                    fontSize: '0.68rem',
                                    fontWeight: '700',
                                    color: 'var(--color-success)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.2rem'
                                  }}>
                                    <Check size={12} />
                                    {isRtl ? 'تمت' : 'Validé'}
                                  </span>
                                ) : null}
                              </div>
                              {stepTime && (
                                <div style={{ fontSize: '0.72rem', color: '#777', marginTop: '0.25rem' }}>
                                  {stepTime}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div style={{
                  padding: '1.25rem',
                  backgroundColor: '#FFEBEE',
                  borderRadius: 'var(--radius-lg)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.85rem',
                  marginBottom: '2rem'
                }}>
                  <XCircle size={26} color="var(--color-danger)" style={{ flexShrink: 0 }} />
                  <div>
                    <h4 style={{ fontWeight: '700', color: 'var(--color-danger)', fontSize: '0.95rem' }}>{t('status.cancelled')}</h4>
                    <p style={{ fontSize: '0.82rem', color: '#666', marginTop: '0.15rem' }}>
                      {t('tracking.cancelledNotice')}
                    </p>
                  </div>
                </div>
              )}

              {/* Items List in Order */}
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.5rem' }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '1rem', color: 'var(--color-espresso)' }}>
                  {t('tracking.orderItems')}
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {orderData.items.map((item, idx) => (
                    <div
                      key={idx}
                      className="tracking-item-row"
                      style={{ borderBottom: idx < orderData.items.length - 1 ? '1px solid var(--color-border)' : 'none' }}
                    >
                      <img
                        src={getImageUrl(item.image)}
                        alt={item.productName}
                        style={{
                          width: '52px',
                          height: '68px',
                          borderRadius: 'var(--radius-sm)',
                          objectFit: 'cover',
                          flexShrink: 0,
                          backgroundColor: 'var(--color-bg-card)'
                        }}
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = '/products/merya_dress_blue_1.jpg';
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: '0.92rem',
                          fontWeight: '700',
                          color: 'var(--color-espresso)',
                          marginBottom: '0.3rem',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>
                          {item.productName}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', fontSize: '0.78rem', color: '#666' }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                            backgroundColor: 'var(--color-bg-base)',
                            padding: '0.15rem 0.5rem',
                            borderRadius: '4px'
                          }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: item.colorCode || '#222' }} />
                            {item.colorName}
                          </span>
                          <span style={{ backgroundColor: 'var(--color-bg-base)', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: '600' }}>
                            {item.size}
                          </span>
                          <span style={{ backgroundColor: 'var(--color-bg-base)', padding: '0.15rem 0.5rem', borderRadius: '4px' }}>
                            ×{item.quantity}
                          </span>
                        </div>
                      </div>
                      <div style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--color-espresso)', textAlign: isRtl ? 'left' : 'right', flexShrink: 0 }}>
                        {formatCurrency(item.unitPrice * item.quantity)}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Financial Summary */}
                <div style={{
                  borderTop: '1px solid var(--color-border)',
                  marginTop: '1.5rem',
                  paddingTop: '1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem'
                }}>
                  {typeof orderData.subtotal === 'number' && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', color: '#666' }}>
                      <span>{t('tracking.subtotal') || 'Sous-total'}</span>
                      <span style={{ fontWeight: '600' }}>{formatCurrency(orderData.subtotal)}</span>
                    </div>
                  )}
                  {typeof orderData.deliveryFee === 'number' && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', color: '#666' }}>
                      <span>{t('tracking.deliveryFee') || 'Livraison'}</span>
                      <span style={{ fontWeight: '600' }}>
                        {orderData.deliveryFee === 0 ? (t('tracking.freeDelivery') || 'Gratuit') : formatCurrency(orderData.deliveryFee)}
                      </span>
                    </div>
                  )}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingTop: '0.75rem',
                    borderTop: '1px dashed var(--color-border)',
                    marginTop: '0.25rem',
                    flexWrap: 'wrap',
                    gap: '0.5rem'
                  }}>
                    <div>
                      <span style={{ fontSize: '1rem', fontWeight: '800', color: 'var(--color-espresso)', display: 'block' }}>
                        {t('checkout.totalToPayCod')}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-sage)', fontWeight: '600' }}>
                        {isRtl ? 'الدفع نقداً عند الاستلام' : 'Paiement en espèces à la livraison'}
                      </span>
                    </div>
                    <span style={{ fontSize: '1.35rem', fontWeight: '800', color: 'var(--color-espresso)' }}>
                      {formatCurrency(orderData.totalPrice)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

