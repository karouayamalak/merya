import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { handleSafeBannerClick } from '../utils/safeUrl';

export default function AnnouncementBar({ banners = [], setCurrentView }) {
  const { localized, isRtl } = useLanguage();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // Filter only active banners that have at least one translated title
  const activeBanners = banners.filter(b => b.isActive !== false && localized(b.title));

  // Check session dismissal
  useEffect(() => {
    try {
      const dismissed = sessionStorage.getItem('merya_announcement_dismissed');
      if (dismissed === 'true') {
        setIsDismissed(true);
      }
    } catch {}
  }, []);

  const total = activeBanners.length;

  const nextBanner = useCallback(() => {
    if (total > 1) {
      setCurrentIndex(prev => (prev + 1) % total);
    }
  }, [total]);

  const prevBanner = useCallback(() => {
    if (total > 1) {
      setCurrentIndex(prev => (prev - 1 + total) % total);
    }
  }, [total]);

  // Auto-slide every 5.5 seconds if multiple banners and not paused
  useEffect(() => {
    if (total <= 1 || isPaused || isDismissed) return;
    const timer = setInterval(() => {
      nextBanner();
    }, 5500);
    return () => clearInterval(timer);
  }, [total, isPaused, isDismissed, nextBanner]);

  if (isDismissed || total === 0) {
    return null;
  }

  const currentBanner = activeBanners[currentIndex] || activeBanners[0];
  const titleText = localized(currentBanner.title);
  const subtitleText = localized(currentBanner.subtitle);
  const btnText = localized(currentBanner.buttonText) || localized(currentBanner.ctaText);
  const bannerLink = currentBanner.link || currentBanner.ctaLink;

  const handleDismiss = () => {
    setIsDismissed(true);
    try {
      sessionStorage.setItem('merya_announcement_dismissed', 'true');
    } catch {}
  };

  const handleActionClick = () => {
    if (bannerLink) {
      handleSafeBannerClick(bannerLink, setCurrentView, 'shop');
    }
  };

  return (
    <aside
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      aria-label="Announcement"
      style={{
        backgroundColor: '#1E1915',
        color: '#F9F6F0',
        position: 'relative',
        zIndex: 110,
        fontSize: '0.82rem',
        borderBottom: '1px solid rgba(212, 175, 55, 0.25)',
        boxShadow: '0 1px 6px rgba(0, 0, 0, 0.2)',
        transition: 'all 0.3s ease'
      }}
    >
      <div
        className="container"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '40px',
          padding: '0.4rem 2.5rem',
          position: 'relative'
        }}
      >
        {/* Previous button if multiple */}
        {total > 1 && (
          <button
            onClick={isRtl ? nextBanner : prevBanner}
            aria-label="Previous announcement"
            style={{
              position: 'absolute',
              left: isRtl ? 'auto' : '0.75rem',
              right: isRtl ? '0.75rem' : 'auto',
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.7)',
              cursor: 'pointer',
              padding: '0.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              transition: 'color 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#FFFFFF'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.7)'}
          >
            {isRtl ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        )}

        {/* Content */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.85rem',
            textAlign: 'center',
            flexWrap: 'wrap',
            animation: 'fadeIn 0.4s ease'
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: '500', letterSpacing: isRtl ? '0' : '0.02em' }}>
            <Sparkles size={13} color="#D4AF37" style={{ flexShrink: 0 }} />
            <span>{titleText}</span>
          </span>

          {subtitleText && (
            <span style={{ color: 'rgba(249, 246, 240, 0.8)', fontSize: '0.78rem' }}>
              • {subtitleText}
            </span>
          )}

          {btnText && bannerLink && (
            <button
              onClick={handleActionClick}
              style={{
                background: 'rgba(212, 175, 55, 0.18)',
                border: '1px solid rgba(212, 175, 55, 0.4)',
                color: '#FFFFFF',
                borderRadius: '999px',
                padding: '0.2rem 0.75rem',
                fontSize: '0.74rem',
                fontWeight: '600',
                cursor: 'pointer',
                letterSpacing: isRtl ? '0' : '0.04em',
                transition: 'all 0.2s ease',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = '#D4AF37';
                e.currentTarget.style.color = '#1E1915';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(212, 175, 55, 0.18)';
                e.currentTarget.style.color = '#FFFFFF';
              }}
            >
              <span>{btnText}</span>
            </button>
          )}

          {/* Dots indicators if multiple */}
          {total > 1 && (
            <div style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center', marginInlineStart: '0.5rem' }}>
              {activeBanners.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentIndex(i)}
                  aria-label={`Go to slide ${i + 1}`}
                  style={{
                    width: i === currentIndex ? '14px' : '6px',
                    height: '6px',
                    borderRadius: '3px',
                    backgroundColor: i === currentIndex ? '#D4AF37' : 'rgba(255,255,255,0.3)',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    transition: 'all 0.25s ease'
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Next button if multiple */}
        {total > 1 && (
          <button
            onClick={isRtl ? prevBanner : nextBanner}
            aria-label="Next announcement"
            style={{
              position: 'absolute',
              right: isRtl ? 'auto' : '2.25rem',
              left: isRtl ? '2.25rem' : 'auto',
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.7)',
              cursor: 'pointer',
              padding: '0.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              transition: 'color 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#FFFFFF'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.7)'}
          >
            {isRtl ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
        )}

        {/* Dismiss X button */}
        <button
          onClick={handleDismiss}
          aria-label="Dismiss announcement"
          style={{
            position: 'absolute',
            right: isRtl ? 'auto' : '0.65rem',
            left: isRtl ? '0.65rem' : 'auto',
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,0.6)',
            cursor: 'pointer',
            padding: '0.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            transition: 'color 0.2s'
          }}
          onMouseEnter={e => e.currentTarget.style.color = '#FFFFFF'}
          onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.6)'}
        >
          <X size={14} />
        </button>
      </div>
    </aside>
  );
}
