import React from 'react';
import { ShieldCheck } from 'lucide-react';

export default function Footer({ setCurrentView }) {
  return (
    <footer style={{
      backgroundColor: 'var(--color-bg-card)',
      borderTop: '1px solid var(--color-border)',
      paddingTop: '4rem',
      paddingBottom: '2.5rem',
      marginTop: '5rem'
    }}>
      <div className="container">
        {/* Footer Navigation & Brand */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '3rem',
          paddingTop: '3.5rem',
          paddingBottom: '3.5rem'
        }}>
          {/* Brand Info */}
          <div>
            <img
              src="/logo.png?v=2"
              alt="MERYA DZ"
              style={{ height: '92px', width: 'auto', marginBottom: '1.25rem' }}
            />
            <p style={{ fontSize: '0.85rem', color: '#666', lineHeight: 1.7, maxWidth: '320px' }}>
              Dedicated to designing graceful, modest, and timeless silhouettes for the contemporary Algerian woman. Handcrafted with authentic Saudi Medina silk, washed linen, and flowing wool peach fabrics.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h4 style={{ fontSize: '0.85rem', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '1.25rem' }}>
              Collection
            </h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem', color: '#555' }}>
              <li>
                <button onClick={() => { setCurrentView('shop'); window.scrollTo(0,0); }} style={{ color: 'inherit' }}>
                  Dresses
                </button>
              </li>
              <li>
                <button onClick={() => { setCurrentView('shop'); window.scrollTo(0,0); }} style={{ color: 'inherit' }}>
                  Tops
                </button>
              </li>
              <li>
                <button onClick={() => { setCurrentView('shop'); window.scrollTo(0,0); }} style={{ color: 'inherit' }}>
                  Skirts
                </button>
              </li>
              <li>
                <button onClick={() => { setCurrentView('shop'); window.scrollTo(0,0); }} style={{ color: 'inherit' }}>
                  Ensembles
                </button>
              </li>
            </ul>
          </div>

          {/* Customer Service */}
          <div>
            <h4 style={{ fontSize: '0.85rem', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '1.25rem' }}>
              Customer Support
            </h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem', color: '#555' }}>
              <li>
                <button onClick={() => { setCurrentView('tracking'); window.scrollTo(0,0); }} style={{ color: 'inherit', fontWeight: '600' }}>
                  Track Your Order
                </button>
              </li>
              <li>Delivery to all 58 Wilayas</li>
              <li>Care Guide for Medina Silk</li>
              <li>Direct WhatsApp / Phone Support</li>
            </ul>
          </div>
        </div>

        {/* Copyright Bar */}
        <div style={{
          borderTop: '1px solid var(--color-border)',
          paddingTop: '2rem',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          fontSize: '0.78rem',
          color: '#888'
        }}>
          <div>© {new Date().getFullYear()} MERYA DZ. All Rights Reserved. Modest Fashion Algeria.</div>
          <div style={{ display: 'flex', gap: '1.5rem' }}>
            <span>Privacy Policy</span>
            <span>Terms of Service</span>
            <span>Cash on Delivery Guarantee</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
