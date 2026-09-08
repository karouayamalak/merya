import React, { useState } from 'react';
import { ShoppingBag, Search, Compass, Menu, X, ShieldCheck } from 'lucide-react';
import { useCart } from '../context/CartContext';

export default function Header({ currentView, setCurrentView }) {
  const { totalQuantity, setIsDrawerOpen } = useCart();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header style={{
      position: 'sticky',
      top: 0,
      zIndex: 100,
      backgroundColor: 'rgba(250, 248, 245, 0.95)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid var(--color-border)'
    }}>
      <div className="container" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: '0.45rem',
        paddingBottom: '0.45rem'
      }}>
        {/* Mobile menu trigger */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          style={{ display: 'none', padding: '0.5rem' }}
          className="mobile-only"
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>

        {/* Brand Logo */}
        <div
          onClick={() => { setCurrentView('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0.1rem 0' }}
          className="brand-logo-btn"
        >
          <img
            src="/logo.png?v=2"
            alt="MERYA DZ Logo"
            className="brand-header-logo"
            style={{
              height: '60px',
              width: 'auto',
              objectFit: 'contain',
              display: 'block'
            }}
          />
        </div>

        {/* Desktop Navigation */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: '2.5rem' }} className="desktop-only">
          <button
            onClick={() => { setCurrentView('home'); window.scrollTo(0,0); }}
            style={{
              fontSize: '0.85rem',
              fontWeight: currentView === 'home' ? '700' : '500',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: currentView === 'home' ? 'var(--color-primary-dark)' : 'var(--color-espresso)'
            }}
          >
            Home
          </button>
          <button
            onClick={() => { setCurrentView('shop'); window.scrollTo(0,0); }}
            style={{
              fontSize: '0.85rem',
              fontWeight: currentView === 'shop' ? '700' : '500',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: currentView === 'shop' ? 'var(--color-primary-dark)' : 'var(--color-espresso)'
            }}
          >
            Collection
          </button>
          <button
            onClick={() => { setCurrentView('tracking'); window.scrollTo(0,0); }}
            style={{
              fontSize: '0.85rem',
              fontWeight: currentView === 'tracking' ? '700' : '500',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: currentView === 'tracking' ? 'var(--color-primary-dark)' : 'var(--color-espresso)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem'
            }}
          >
            <Compass size={15} />
            Track Order
          </button>
        </nav>

        {/* Action icons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <button
            onClick={() => { setCurrentView('tracking'); window.scrollTo(0,0); }}
            title="Track Your Order"
            style={{ color: 'var(--color-espresso)', padding: '0.4rem' }}
            className="mobile-only"
          >
            <Compass size={20} />
          </button>

          <button
            onClick={() => setIsDrawerOpen(true)}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0.5rem',
              color: 'var(--color-espresso)',
              transition: 'var(--transition-fast)'
            }}
            aria-label="Open Shopping Bag"
          >
            <ShoppingBag size={22} />
            {totalQuantity > 0 && (
              <span style={{
                position: 'absolute',
                top: '0px',
                right: '0px',
                backgroundColor: 'var(--color-espresso)',
                color: '#FFFFFF',
                borderRadius: '50%',
                width: '18px',
                height: '18px',
                fontSize: '0.7rem',
                fontWeight: '700',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                {totalQuantity}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Mobile drawer menu */}
      {mobileMenuOpen && (
        <div style={{
          backgroundColor: 'var(--color-bg-base)',
          borderBottom: '1px solid var(--color-border)',
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem'
        }}>
          <button
            onClick={() => { setCurrentView('home'); setMobileMenuOpen(false); }}
            style={{ textAlign: 'left', fontSize: '1rem', fontWeight: '600', textTransform: 'uppercase' }}
          >
            Home
          </button>
          <button
            onClick={() => { setCurrentView('shop'); setMobileMenuOpen(false); }}
            style={{ textAlign: 'left', fontSize: '1rem', fontWeight: '600', textTransform: 'uppercase' }}
          >
            Collection
          </button>
          <button
            onClick={() => { setCurrentView('tracking'); setMobileMenuOpen(false); }}
            style={{ textAlign: 'left', fontSize: '1rem', fontWeight: '600', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <Compass size={18} />
            Track Order
          </button>
        </div>
      )}

      <style>{`
        .brand-header-logo {
          height: 60px !important;
          transition: transform 0.2s ease;
        }
        .brand-logo-btn:hover .brand-header-logo {
          transform: scale(1.02);
        }
        @media (max-width: 768px) {
          .desktop-only { display: none !important; }
          .mobile-only { display: flex !important; }
          .brand-header-logo { height: 46px !important; }
        }
        @media (min-width: 769px) {
          .mobile-only { display: none !important; }
        }
      `}</style>
    </header>
  );
}
