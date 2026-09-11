import React, { useState } from 'react';
import { getImageUrl } from '../services/api';

export default function ProductCard({ product, onSelect }) {
  // Active selected color for preview
  const [selectedColorIndex, setSelectedColorIndex] = useState(0);

  const activeColor = product.colors?.[selectedColorIndex] || product.colors?.[0] || {};
  const currentImage = getImageUrl(activeColor.images?.[0] || 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?q=80&w=800&auto=format&fit=crop');

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
        {/* Best seller / Tag badge */}
        {product.isBestSeller && (
          <span style={{
            position: 'absolute',
            top: '14px',
            left: '14px',
            backgroundColor: 'var(--color-espresso)',
            color: '#FFFFFF',
            fontSize: '0.68rem',
            fontWeight: '700',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            padding: '0.35rem 0.75rem',
            borderRadius: 'var(--radius-full)',
            zIndex: 2
          }}>
            Best Seller
          </span>
        )}

        <img
          src={currentImage}
          alt={`${product.name} in ${activeColor.colorName || ''}`}
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
            Select Color & Size
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
            {product.colors.length > 1 && (
              <span style={{ fontSize: '0.72rem', color: '#777', marginLeft: '0.25rem' }}>
                {product.colors.length} colors
              </span>
            )}
          </div>
        )}

        <h3 style={{
          fontSize: '0.98rem',
          fontWeight: '600',
          color: 'var(--color-espresso)',
          lineHeight: 1.3
        }}>
          {product.name}
        </h3>

        <div style={{
          fontSize: '1rem',
          fontWeight: '700',
          color: 'var(--color-espresso)',
          letterSpacing: '-0.01em'
        }}>
          {product.sellingPrice.toLocaleString()} DZD
        </div>
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
