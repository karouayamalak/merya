import React, { useState } from 'react';
import { getImageUrl } from '../services/api';
import { useLanguage } from '../context/LanguageContext';

export default function ProductCard({ product, onSelect }) {
  const { t, formatCurrency, isRtl, localized } = useLanguage();
  // Active selected color for preview
  const [selectedColorIndex, setSelectedColorIndex] = useState(0);

  const activeColor = product.colors?.[selectedColorIndex] || product.colors?.[0] || {};
  const currentImage = getImageUrl(activeColor.images?.[0] || 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?q=80&w=800&auto=format&fit=crop');

  const isPromotionActive = !!(
    product.promotion &&
    product.promotion.active &&
    typeof product.promotion.promotionalPrice === 'number' &&
    product.promotion.promotionalPrice > 0 &&
    product.promotion.promotionalPrice < product.sellingPrice
  );
  const effectivePrice = isPromotionActive ? product.promotion.promotionalPrice : product.sellingPrice;
  const discountPercent = isPromotionActive
    ? Math.round(((product.sellingPrice - product.promotion.promotionalPrice) / product.sellingPrice) * 100)
    : 0;

  return (
    <div
      onClick={() => onSelect(product)}
      style={{
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        transition: 'var(--transition-smooth)'
      }}
      className="product-card-group"
    >
      {/* Visual Image Container with rounded borders */}
      <div style={{
        position: 'relative',
        backgroundColor: 'var(--color-bg-card)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        aspectRatio: '3 / 4',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: 'var(--shadow-sm)',
        transition: 'var(--transition-smooth)'
      }}
      className="product-image-box"
      >
        {/* Sale / Promotion Badge */}
        {isPromotionActive && (
          <span style={{
            position: 'absolute',
            top: '14px',
            [isRtl ? 'left' : 'right']: '14px',
            backgroundColor: '#DC2626',
            color: '#FFFFFF',
            fontSize: '0.72rem',
            fontWeight: '700',
            letterSpacing: '0.04em',
            padding: '0.35rem 0.65rem',
            borderRadius: 'var(--radius-full)',
            zIndex: 2,
            boxShadow: '0 2px 6px rgba(220, 38, 38, 0.35)'
          }}>
            -{discountPercent}%
          </span>
        )}

        {/* Best seller / Tag badge */}
        {product.isBestSeller && (
          <span style={{
            position: 'absolute',
            top: '14px',
            [isRtl ? 'right' : 'left']: '14px',
            backgroundColor: 'var(--color-espresso)',
            color: '#FFFFFF',
            fontSize: '0.68rem',
            fontWeight: '700',
            letterSpacing: isRtl ? '0' : '0.06em',
            textTransform: isRtl ? 'none' : 'uppercase',
            padding: '0.35rem 0.75rem',
            borderRadius: 'var(--radius-full)',
            zIndex: 2
          }}>
            {t('home.newArrivals')}
          </span>
        )}

        <img
          src={currentImage}
          alt={`${localized(product.name)} ${activeColor.colorName || ''}`}
          loading="lazy"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transition: 'transform 0.5s ease'
          }}
          className="product-img-hover"
        />

        {/* Quick View Button overlay on desktop */}
        <div style={{
          position: 'absolute',
          bottom: '16px',
          left: '16px',
          right: '16px',
          opacity: 0,
          transform: 'translateY(8px)',
          transition: 'var(--transition-smooth)',
          zIndex: 3
        }}
        className="quick-view-overlay"
        >
          <button
            className="btn btn-primary btn-sm"
            style={{ width: '100%', borderRadius: 'var(--radius-md)', padding: '0.7rem' }}
          >
            {t('product.selectSize')}
          </button>
        </div>
      </div>

      {/* Product Details below image */}
      <div style={{ paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {/* Color swatches */}
        {product.colors && product.colors.length > 0 && (
          <div
            style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', marginBottom: '0.2rem' }}
            onClick={(e) => e.stopPropagation()}
          >
            {product.colors.map((c, idx) => (
              <button
                key={idx}
                onClick={() => setSelectedColorIndex(idx)}
                title={c.colorName}
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  backgroundColor: c.colorCode,
                  border: selectedColorIndex === idx ? '2px solid var(--color-espresso)' : '1px solid #CCC',
                  padding: '1px',
                  transform: selectedColorIndex === idx ? 'scale(1.15)' : 'scale(1)',
                  transition: 'var(--transition-fast)'
                }}
              />
            ))}
          </div>
        )}

        <h3 style={{
          fontSize: '0.98rem',
          fontWeight: '600',
          color: 'var(--color-espresso)',
          lineHeight: 1.3
        }}>
          {localized(product.name)}
        </h3>

        {/* Price Section */}
        {isPromotionActive ? (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '1.05rem',
              fontWeight: '700',
              color: '#DC2626',
              letterSpacing: '-0.01em'
            }}>
              {formatCurrency(effectivePrice)}
            </span>
            <span style={{
              fontSize: '0.85rem',
              color: '#888888',
              textDecoration: 'line-through',
              fontWeight: '500'
            }}>
              {formatCurrency(product.sellingPrice)}
            </span>
          </div>
        ) : (
          <div style={{
            fontSize: '1rem',
            fontWeight: '700',
            color: 'var(--color-espresso)',
            letterSpacing: '-0.01em'
          }}>
            {formatCurrency(product.sellingPrice)}
          </div>
        )}
      </div>

      <style>{`
        .product-card-group:hover .product-img-hover {
          transform: scale(1.04);
        }
        .product-card-group:hover .product-image-box {
          box-shadow: var(--shadow-hover);
        }
        .product-card-group:hover .quick-view-overlay {
          opacity: 1;
          transform: translateY(0);
        }
      `}</style>
    </div>
  );
}
