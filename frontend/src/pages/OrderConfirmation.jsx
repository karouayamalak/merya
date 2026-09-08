import React, { useEffect } from 'react';
import { CheckCircle, Copy, Compass, ArrowRight, Package } from 'lucide-react';
import confetti from 'canvas-confetti';

export default function OrderConfirmation({ orderData, onTrackOrder, onContinueShopping }) {
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
    alert(`Order code ${orderCode} copied to clipboard!`);
  };

  return (
    <div style={{ paddingTop: '4rem', paddingBottom: '7rem' }}>
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
          Order Confirmed
        </span>

        <h1 className="heading-display" style={{ fontSize: 'clamp(2rem, 4vw, 2.8rem)', color: 'var(--color-espresso)', marginTop: '0.35rem', marginBottom: '1rem' }}>
          THANK YOU FOR YOUR ORDER
        </h1>

        <p style={{ fontSize: '1rem', color: '#666', lineHeight: 1.6, marginBottom: '2.5rem' }}>
          Your order has been recorded successfully. Our customer support will contact you at <strong>{customer.phone}</strong> to confirm dispatch.
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
            Your Official Tracking Code
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
                padding: '0.5rem',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-bg-card)',
                color: 'var(--color-espresso)'
              }}
              title="Copy Code"
            >
              <Copy size={18} />
            </button>
          </div>

          <p style={{ fontSize: '0.82rem', color: '#666' }}>
            Save this code! You can use this code and your phone number anytime to track live delivery status.
          </p>
        </div>

        {/* Order Details Brief */}
        <div style={{
          backgroundColor: 'var(--color-bg-card)',
          borderRadius: 'var(--radius-lg)',
          padding: '1.75rem',
          textAlign: 'left',
          marginBottom: '2.5rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.9rem', color: '#666' }}>Recipient</span>
            <span style={{ fontSize: '0.9rem', fontWeight: '600' }}>{customer.fullName}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.9rem', color: '#666' }}>Delivery Destination</span>
            <span style={{ fontSize: '0.9rem', fontWeight: '600' }}>
              Wilaya {customer.wilaya?.code} - {customer.wilaya?.name} ({customer.deliveryMethod === 'agency' ? 'Agency Pickup' : 'Home Delivery'})
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}>
            <span style={{ fontSize: '1.05rem', fontWeight: '700' }}>Total (Cash on Delivery)</span>
            <span style={{ fontSize: '1.15rem', fontWeight: '800', color: 'var(--color-espresso)' }}>
              {orderData?.totalPrice?.toLocaleString()} DZD
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
            <Compass size={18} />
            <span>Track Order Live</span>
          </button>

          <button
            onClick={onContinueShopping}
            className="btn btn-secondary"
            style={{ padding: '1rem 1.75rem' }}
          >
            <span>Continue Shopping</span>
          </button>
        </div>
      </div>
    </div>
  );
}
