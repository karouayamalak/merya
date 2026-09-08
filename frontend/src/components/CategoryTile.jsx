import React from 'react';

export default function CategoryTile({ category, onClick }) {
  return (
    <div
      onClick={() => onClick(category)}
      style={{
        cursor: 'pointer',
        position: 'relative',
        backgroundColor: 'var(--color-bg-card)',
        borderRadius: 'var(--radius-xl)',
        overflow: 'hidden',
        aspectRatio: '3 / 4',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        padding: '1.75rem',
        boxShadow: 'var(--shadow-sm)',
        transition: 'var(--transition-smooth)'
      }}
      className="category-tile-box"
    >
      {/* Background Image */}
      <img
        src={category.image}
        alt={category.name}
        loading="lazy"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transition: 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
        className="category-tile-img"
      />

      {/* Subtle bottom gradient to ensure text readability */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '50%',
        background: 'linear-gradient(to top, rgba(28, 25, 23, 0.75) 0%, rgba(28, 25, 23, 0) 100%)',
        zIndex: 1
      }} />

      {/* Content overlay */}
      <div style={{ position: 'relative', zIndex: 2, color: '#FFFFFF' }}>
        <h3 style={{
          fontSize: '1.25rem',
          fontWeight: '700',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          lineHeight: 1.15,
          marginBottom: '0.35rem'
        }}>
          {category.name}
        </h3>
        <span style={{
          fontSize: '0.75rem',
          fontWeight: '600',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--color-primary-light)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.3rem'
        }}>
          Shop Collection →
        </span>
      </div>

      <style>{`
        .category-tile-box:hover .category-tile-img {
          transform: scale(1.06);
        }
        .category-tile-box:hover {
          box-shadow: var(--shadow-hover);
          transform: translateY(-4px);
        }
      `}</style>
    </div>
  );
}
