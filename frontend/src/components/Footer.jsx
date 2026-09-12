import React from 'react';
import { useLanguage } from '../context/LanguageContext';

export default function Footer({ setCurrentView }) {
  const { t, isRtl } = useLanguage();

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
              {t('footer.description')}
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h4 style={{
              fontSize: '0.85rem',
              fontWeight: '700',
              letterSpacing: isRtl ? '0' : '0.08em',
              textTransform: isRtl ? 'none' : 'uppercase',
              marginBottom: '1.25rem'
            }}>
              {t('footer.collection')}
            </h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem', color: '#555' }}>
              <li>
                <button onClick={() => { setCurrentView('shop'); window.scrollTo(0,0); }} style={{ color: 'inherit' }}>
                  {t('home.viewCollection')}
                </button>
              </li>
              <li>
                <button onClick={() => { setCurrentView('shop'); window.scrollTo(0,0); }} style={{ color: 'inherit' }}>
                  {t('home.newArrivals')}
                </button>
              </li>
              <li>
                <button onClick={() => { setCurrentView('shop'); window.scrollTo(0,0); }} style={{ color: 'inherit' }}>
                  {t('home.featuredCategories')}
                </button>
              </li>
            </ul>
          </div>

          {/* Customer Service */}
          <div>
            <h4 style={{
              fontSize: '0.85rem',
              fontWeight: '700',
              letterSpacing: isRtl ? '0' : '0.08em',
              textTransform: isRtl ? 'none' : 'uppercase',
              marginBottom: '1.25rem'
            }}>
              {t('footer.support')}
            </h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem', color: '#555' }}>
              <li>
                <button onClick={() => { setCurrentView('tracking'); window.scrollTo(0,0); }} style={{ color: 'inherit', fontWeight: '600' }}>
                  {t('footer.trackOrder')}
                </button>
              </li>
              <li>{t('footer.allWilayas')}</li>
              <li>{t('footer.careGuide')}</li>
              <li>{t('footer.directSupport')}</li>
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
          <div>© {new Date().getFullYear()} MERYA DZ. {t('footer.allRightsReserved')}</div>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <span>{t('footer.privacy')}</span>
            <span>{t('footer.terms')}</span>
            <span>{t('footer.codGuarantee')}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
