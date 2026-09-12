import React, { useEffect, useState } from 'react';
import { CheckCircle, Copy, Compass } from 'lucide-react';
import confetti from 'canvas-confetti';
import { useLanguage } from '../context/LanguageContext';

export default function OrderConfirmation({ orderData, onTrackOrder, onContinueShopping }) {
  const { t, isRtl, formatCurrency } = useLanguage();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Fire celebratory confetti on arrival
    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#B89C82', '#2A241F', '#D4AF37', '#808B72']
      });
    } catch {
      // Ignore if canvas-confetti is not supported
    }
  }, []);

  const orderCode = orderData?.orderCode || 'MD-SUCCESS';
  const customer = orderData?.customer || {};

  const handleCopyCode = () => {
    navigator.clipboard.writeText(orderCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div style={{ paddingTop: '4rem', paddingBottom: '7rem' }} dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="container" style={{ maxWidth: '680px', textAlign: 'center' }}>
        {/* Success Icon */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '80px',
          height: '80px',
          borderRadius: '50%',
          backgroundColor: '#E8F5E9',
          color: 'var(--color-success)',
          marginBottom: '1.5rem'
        }}>
          <CheckCircle size={44} />
        </div>

        <span style={{ fontSize: '0.8rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-primary-dark)' }}>
          {t('confirmation.orderConfirmed')}
        </span>

        <h1 className="heading-display" style={{ fontSize: 'clamp(2rem, 4vw, 2.8rem)', color: 'var(--color-espresso)', marginTop: '0.35rem', marginBottom: '1rem' }}>
          {t('confirmation.thankYou')}
        </h1>

        <p style={{ fontSize: '1rem', color: '#666', lineHeight: 1.6, marginBottom: '2.5rem' }}>
          {t('confirmation.orderPlaced')}{' '}
          {customer.phone && (
            <span>
              {t('confirmation.callNoticeWithPhone').replace('{phone}', customer.phone)}
            </span>
          )}
        </p>

        {/* Order Code Callout Box */}
        <div style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl)',
          padding: '2rem',
          border: '2px dashed var(--color-primary)',
          boxShadow: 'var(--shadow-md)',
          marginBottom: '2.5rem'
        }}>
          <div style={{ fontSize: '0.85rem', color: '#777', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
            {t('confirmation.orderCode')}
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            marginBottom: '0.75rem'
          }}>
            <span style={{
              fontSize: '2.2rem',
              fontWeight: '800',
              letterSpacing: '0.08em',
              color: 'var(--color-espresso)',
              fontFamily: 'monospace'
            }}>
              {orderCode}
            </span>

            <button
              onClick={handleCopyCode}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-md)',
                backgroundColor: copied ? 'var(--color-success)' : 'var(--color-bg-card)',
                color: copied ? '#fff' : 'var(--color-espresso)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.8rem',
                fontWeight: '600',
                transition: 'all 0.2s ease',
                border: '1px solid var(--color-border)',
                cursor: 'pointer'
              }}
              title={t('confirmation.copyCode')}
            >
              <Copy size={16} />
              <span>{copied ? t('confirmation.codeCopied') : t('confirmation.copyCode')}</span>
            </button>
          </div>

          <p style={{ fontSize: '0.82rem', color: '#666' }}>
            {t('confirmation.orderCodeHelp')}
          </p>
        </div>

        {/* Order Details Brief */}
        <div style={{
          backgroundColor: 'var(--color-bg-card)',
          borderRadius: 'var(--radius-lg)',
          padding: '1.75rem',
          textAlign: isRtl ? 'right' : 'left',
          marginBottom: '2.5rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.9rem', color: '#666' }}>{t('common.recipient')}</span>
            <span style={{ fontSize: '0.9rem', fontWeight: '600' }}>{customer.fullName}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.9rem', color: '#666' }}>{t('confirmation.recapTitle')}</span>
            <span style={{ fontSize: '0.9rem', fontWeight: '600' }}>
              {customer.wilaya?.code ? `${t('confirmation.wilaya')} ${customer.wilaya?.code} - ${customer.wilaya?.name}` : ''} ({customer.deliveryMethod === 'agency' ? t('checkout.agency') : t('checkout.home')})
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}>
            <span style={{ fontSize: '1.05rem', fontWeight: '700' }}>{t('checkout.totalToPayCod')}</span>
            <span style={{ fontSize: '1.15rem', fontWeight: '800', color: 'var(--color-espresso)' }}>
              {formatCurrency(orderData?.totalPrice || 0)}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => onTrackOrder(customer.phone, orderCode)}
            className="btn btn-primary"
            style={{ padding: '1rem 2rem' }}
          >
            <Compass size={18} className="rtl-flip" />
            <span>{t('confirmation.trackCta')}</span>
          </button>

          <button
            onClick={onContinueShopping}
            className="btn btn-secondary"
            style={{ padding: '1rem 1.75rem' }}
          >
            <span>{t('cart.continueShopping')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
