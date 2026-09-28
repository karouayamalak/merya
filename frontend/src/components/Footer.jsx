import React from 'react';
import { useLanguage } from '../context/LanguageContext';

// SVG icons for social media (inline, no extra deps)
const FacebookIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
  </svg>
);
const InstagramIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
  </svg>
);
const TikTokIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.3 6.3 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z"/>
  </svg>
);

import { useStoreSettings } from '../context/StoreSettingsContext';

export default function Footer({ setCurrentView }) {
  const { t, isRtl } = useLanguage();
  const { settings: storeSettings } = useStoreSettings();
  const social = storeSettings?.socialLinks || {};


  const socialItems = [
    { key: 'facebook', label: t('footer.socialFacebook'), href: social.facebook, Icon: FacebookIcon },
    { key: 'instagram', label: t('footer.socialInstagram'), href: social.instagram, Icon: InstagramIcon },
    { key: 'tiktok', label: t('footer.socialTiktok'), href: social.tiktok, Icon: TikTokIcon },
  ];

  const hasSocialLinks = socialItems.some(s => s.href);

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
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
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

            {/* Social Media */}
            <div style={{ marginTop: '1.5rem' }}>
              <p style={{
                fontSize: '0.75rem',
                fontWeight: '700',
                textTransform: isRtl ? 'none' : 'uppercase',
                letterSpacing: isRtl ? '0' : '0.08em',
                color: 'var(--color-espresso)',
                marginBottom: '0.75rem'
              }}>
                {t('footer.followUs')}
              </p>
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                {socialItems.map(({ key, label, href, Icon }) => (
                  <a
                    key={key}
                    href={href || '#'}
                    target={href ? '_blank' : undefined}
                    rel="noopener noreferrer"
                    aria-label={label}
                    title={label}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '38px',
                      height: '38px',
                      borderRadius: '50%',
                      backgroundColor: href ? 'var(--color-espresso)' : 'rgba(0,0,0,0.07)',
                      color: href ? '#fff' : 'rgba(0,0,0,0.35)',
                      transition: 'all 0.22s ease',
                      textDecoration: 'none',
                      cursor: href ? 'pointer' : 'default',
                      border: '1px solid',
                      borderColor: href ? 'var(--color-espresso)' : 'rgba(0,0,0,0.1)',
                    }}
                    onMouseEnter={href ? (e) => {
                      e.currentTarget.style.transform = 'translateY(-2px) scale(1.08)';
                      e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.18)';
                    } : undefined}
                    onMouseLeave={href ? (e) => {
                      e.currentTarget.style.transform = 'none';
                      e.currentTarget.style.boxShadow = 'none';
                    } : undefined}
                  >
                    <Icon />
                  </a>
                ))}
              </div>
              {!hasSocialLinks && (
                <p style={{ fontSize: '0.75rem', color: '#aaa', marginTop: '0.4rem', fontStyle: 'italic' }}>
                  {/* placeholder hint for owner */}
                  Links coming soon
                </p>
              )}
            </div>
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
