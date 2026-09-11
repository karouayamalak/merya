import React from 'react';
import { X, Trash2, Plus, Minus, ArrowRight, ShoppingBag } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { getImageUrl } from '../services/api';

export default function CartDrawer({ onProceedToCheckout, onContinueShopping }) {
  const { items, isDrawerOpen, setIsDrawerOpen, updateQuantity, removeFromCart, subtotal, totalQuantity } = useCart();

  if (!isDrawerOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 200,
      display: 'flex',
      justifyContent: 'flex-end'
    }}>
      {/* Backdrop */}
      <div
        onClick={() => setIsDrawerOpen(false)}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(28, 25, 23, 0.45)',
          backdropFilter: 'blur(4px)',
          transition: 'opacity 0.3s ease'
        }}
      />

      {/* Drawer Panel */}
      <div style={{
        position: 'relative',
        width: '100%',
        maxWidth: '460px',
        height: '100%',
        backgroundColor: 'var(--color-bg-base)',
        boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.15)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 201,
        animation: 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.5rem',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShoppingBag size={20} color="var(--color-espresso)" />
            <h2 style={{ fontSize: '1.1rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Your Bag ({totalQuantity})
            </h2>
          </div>
          <button
            onClick={() => setIsDrawerOpen(false)}
            style={{ padding: '0.5rem', color: '#666', borderRadius: '50%' }}
            aria-label="Close cart"
          >
            <X size={22} />
          </button>
        </div>

        {/* Cart Item List */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem'
        }}>
          {items.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              textAlign: 'center',
              gap: '1rem',
              color: '#777'
            }}>
              <ShoppingBag size={48} strokeWidth={1.2} />
              <p style={{ fontSize: '1rem', fontWeight: '500' }}>Your shopping bag is currently empty</p>
              <button
                onClick={() => { setIsDrawerOpen(false); onContinueShopping(); }}
                className="btn btn-secondary btn-sm"
              >
                Explore Collection
              </button>
            </div>
          ) : (
            items.map((item, idx) => (
              <div
                key={`${item.productId}-${item.colorName}-${item.size}`}
                style={{
                  display: 'flex',
                  gap: '1rem',
                  paddingBottom: '1.25rem',
                  borderBottom: '1px solid var(--color-border)',
                  position: 'relative'
                }}
              >
                {/* Item Thumbnail */}
                <div style={{
                  width: '80px',
                  height: '105px',
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  backgroundColor: 'var(--color-bg-card)',
                  flexShrink: 0
                }}>
                  <img
                    src={getImageUrl(item.image) || 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?q=80&w=300&auto=format&fit=crop'}
                    alt={item.productName}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>

                {/* Item Details */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <h4 style={{ fontSize: '0.92rem', fontWeight: '600', color: 'var(--color-espresso)', maxWidth: '210px' }}>
                        {item.productName}
                      </h4>
                      <button
                        onClick={() => removeFromCart(item.productId, item.colorName, item.size)}
                        style={{ color: '#999', padding: '0.2rem' }}
                        title="Remove item"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.35rem', fontSize: '0.8rem', color: '#666' }}>
                      <span>Color: <strong>{item.colorName}</strong></span>
                      <span>Size: <strong>{item.size}</strong></span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem' }}>
                    {/* Quantity Selector */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-full)',
                      padding: '0.15rem 0.5rem',
                      backgroundColor: 'var(--color-surface)'
                    }}>
                      <button
                        onClick={() => updateQuantity(item.productId, item.colorName, item.size, -1)}
                        style={{ padding: '0.25rem', color: '#555' }}
                        disabled={item.quantity <= 1}
                      >
                        <Minus size={13} />
                      </button>
                      <span style={{ fontSize: '0.85rem', fontWeight: '600', minWidth: '24px', textAlign: 'center' }}>
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.productId, item.colorName, item.size, 1)}
                        style={{ padding: '0.25rem', color: '#555' }}
                      >
                        <Plus size={13} />
                      </button>
                    </div>

                    <div style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--color-espresso)' }}>
                      {(item.unitPrice * item.quantity).toLocaleString()} DZD
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer with Checkout CTA */}
        {items.length > 0 && (
          <div style={{
            padding: '1.5rem',
            borderTop: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.9rem', color: '#666', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Estimated Subtotal
              </span>
              <span style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--color-espresso)' }}>
                {subtotal.toLocaleString()} DZD
              </span>
            </div>

            <p style={{ fontSize: '0.75rem', color: '#777', lineHeight: 1.4 }}>
              * Delivery fee (Home or Agency pickup) is calculated dynamically at checkout based on your Wilaya.
            </p>

            <button
              onClick={() => {
                setIsDrawerOpen(false);
                onProceedToCheckout();
              }}
              className="btn btn-primary"
              style={{ width: '100%', padding: '1rem', fontSize: '0.9rem' }}
            >
              <span>Proceed to Cash on Delivery</span>
              <ArrowRight size={18} />
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
