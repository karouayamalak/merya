import React, { useState, useEffect } from 'react';
import { ArrowLeft, ShoppingBag, ShieldCheck, Truck, RotateCcw, Check, AlertCircle } from 'lucide-react';
import { useCart } from '../context/CartContext';
import ProductCard from '../components/ProductCard';
import { getImageUrl } from '../services/api';
import { useLanguage } from '../context/LanguageContext';

export default function ProductDetail({ product, onBack, onSelectRelated }) {
  const { addToCart } = useCart();
  const { t, formatCurrency, isRtl, localized } = useLanguage();

  const [selectedColorIndex, setSelectedColorIndex] = useState(0);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [selectedSize, setSelectedSize] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [addedAnimation, setAddedAnimation] = useState(false);

  // Active color variant
  const activeColor = product.colors?.[selectedColorIndex] || product.colors?.[0] || { sizes: [], images: [] };

  // When color changes, reset image index and default to first size with stock
  useEffect(() => {
    setSelectedImageIndex(0);
    const firstAvailableSize = activeColor.sizes?.find(s => s.stock > 0);
    setSelectedSize(firstAvailableSize ? firstAvailableSize.size : (activeColor.sizes?.[0]?.size || ''));
    setQuantity(1);
  }, [selectedColorIndex, product]);

  const activeSizeObj = activeColor.sizes?.find(s => s.size === selectedSize);
  const currentStock = activeSizeObj ? activeSizeObj.stock : 0;
  const isOutOfStock = currentStock <= 0;

  const currentImages = activeColor.images?.length > 0
    ? activeColor.images
    : ['https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?q=80&w=800&auto=format&fit=crop'];

  const mainImage = currentImages[selectedImageIndex] || currentImages[0];

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

  const handleAddToCart = () => {
    if (!selectedSize || isOutOfStock) return;

    addToCart({
      productId: product._id,
      productName: product.name,
      slug: product.slug,
      colorName: activeColor.colorName,
      colorCode: activeColor.colorCode,
      size: selectedSize,
      quantity,
      unitPrice: effectivePrice,
      originalPrice: product.sellingPrice,
      image: mainImage
    });

    setAddedAnimation(true);
    setTimeout(() => setAddedAnimation(false), 2000);
  };

  return (
    <div style={{ paddingTop: '2rem', paddingBottom: '6rem' }}>
      <div className="container">
        {/* Back navigation */}
        <button
          onClick={onBack}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.85rem',
            fontWeight: '600',
            color: 'var(--color-espresso)',
            marginBottom: '2rem'
          }}
        >
          <ArrowLeft size={16} className="rtl-flip" />
          {t('product.backToCollection')}
        </button>

        {/* Product Hero Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '3.5rem',
          alignItems: 'flex-start'
        }}>
          {/* Gallery View */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Main Stage Image */}
            <div style={{
              backgroundColor: 'var(--color-bg-card)',
              borderRadius: 'var(--radius-xl)',
              overflow: 'hidden',
              aspectRatio: '3 / 4',
              boxShadow: 'var(--shadow-md)',
              position: 'relative'
            }}>
              <img
                src={getImageUrl(mainImage)}
                alt={`${localized(product.name)} - ${activeColor.colorName}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />

              {isPromotionActive && (
                <span style={{
                  position: 'absolute',
                  top: '16px',
                  [isRtl ? 'left' : 'right']: '16px',
                  backgroundColor: '#DC2626',
                  color: '#FFF',
                  fontSize: '0.8rem',
                  fontWeight: '700',
                  letterSpacing: '0.04em',
                  padding: '0.4rem 0.85rem',
                  borderRadius: 'var(--radius-full)',
                  boxShadow: '0 2px 8px rgba(220, 38, 38, 0.4)',
                  zIndex: 2
                }}>
                  -{discountPercent}% {t('product.off')}
                </span>
              )}
            </div>

            {/* Thumbnail Row */}
            {currentImages.length > 1 && (
              <div style={{ display: 'flex', gap: '0.75rem', overflowX: 'auto' }}>
                {currentImages.map((img, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedImageIndex(idx)}
                    style={{
                      width: '75px',
                      height: '95px',
                      borderRadius: 'var(--radius-md)',
                      overflow: 'hidden',
                      border: selectedImageIndex === idx ? '2px solid var(--color-espresso)' : '1px solid var(--color-border)',
                      opacity: selectedImageIndex === idx ? 1 : 0.65,
                      transition: 'var(--transition-fast)',
                      flexShrink: 0
                    }}
                  >
                    <img src={getImageUrl(img)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Product Details & Purchase Form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
            <div>
              <span style={{
                fontSize: '0.78rem',
                fontWeight: '700',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--color-primary-dark)'
              }}>
                {localized(product.category?.name) || 'Modest Fashion'}
              </span>

              <h1 className="heading-luxury" style={{
                fontSize: 'clamp(2rem, 3.5vw, 2.7rem)',
                color: 'var(--color-espresso)',
                marginTop: '0.35rem',
                lineHeight: 1.15
              }}>
                {localized(product.name)}
              </h1>

              {isPromotionActive ? (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.85rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: '1.8rem',
                    fontWeight: '800',
                    color: '#DC2626',
                    letterSpacing: '-0.02em'
                  }}>
                    {formatCurrency(effectivePrice)}
                  </span>
                  <span style={{
                    fontSize: '1.2rem',
                    color: '#888',
                    textDecoration: 'line-through',
                    fontWeight: '500'
                  }}>
                    {formatCurrency(product.sellingPrice)}
                  </span>
                  <span style={{
                    fontSize: '0.85rem',
                    fontWeight: '700',
                    color: '#DC2626',
                    backgroundColor: '#FEE2E2',
                    padding: '0.2rem 0.6rem',
                    borderRadius: '6px'
                  }}>
                    {t('product.save')} {formatCurrency(product.sellingPrice - effectivePrice)} (-{discountPercent}%)
                  </span>
                </div>
              ) : (
                <div style={{
                  fontSize: '1.6rem',
                  fontWeight: '800',
                  color: 'var(--color-espresso)',
                  marginTop: '0.75rem'
                }}>
                  {formatCurrency(product.sellingPrice)}
                </div>
              )}
            </div>

            {/* 1. COLOR SELECTION */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {t('product.color')}: <strong style={{ color: 'var(--color-primary-dark)' }}>{activeColor.colorName}</strong>
                </span>
                <span style={{ fontSize: '0.8rem', color: '#777' }}>
                  {product.colors.length} {t('product.colorsAvailable')}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {product.colors.map((c, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedColorIndex(idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.45rem 0.9rem',
                      borderRadius: 'var(--radius-full)',
                      border: selectedColorIndex === idx ? '2px solid var(--color-espresso)' : '1px solid var(--color-border)',
                      backgroundColor: selectedColorIndex === idx ? 'var(--color-surface)' : 'var(--color-bg-card)',
                      cursor: 'pointer',
                      transition: 'var(--transition-fast)'
                    }}
                  >
                    <span style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      backgroundColor: c.colorCode,
                      border: '1px solid rgba(0,0,0,0.1)'
                    }} />
                    <span style={{ fontSize: '0.82rem', fontWeight: '600' }}>{c.colorName}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 2. SIZE SELECTION */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {t('product.selectSize')}
                </span>
                {/* Real-time stock badge */}
                {isOutOfStock ? (
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-danger)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <AlertCircle size={14} />
                    {t('product.soldOutColor')}
                  </span>
                ) : currentStock <= 3 ? (
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-warning)', fontWeight: '700' }}>
                    {t('product.onlyLeft', { count: currentStock })}
                  </span>
                ) : (
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-success)', fontWeight: '600' }}>
                    {t('product.inStock', { count: currentStock })}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                {activeColor.sizes?.map((s) => {
                  const out = s.stock <= 0;
                  const isSelected = selectedSize === s.size;
                  return (
                    <button
                      key={s.size}
                      onClick={() => !out && setSelectedSize(s.size)}
                      disabled={out}
                      style={{
                        padding: '0.65rem 1.4rem',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '0.85rem',
                        fontWeight: '700',
                        border: isSelected ? '2px solid var(--color-espresso)' : '1px solid var(--color-border)',
                        backgroundColor: isSelected ? 'var(--color-espresso)' : (out ? '#EAE5DF' : 'var(--color-surface)'),
                        color: isSelected ? '#FFF' : (out ? '#999' : 'var(--color-espresso)'),
                        opacity: out ? 0.45 : 1,
                        cursor: out ? 'not-allowed' : 'pointer',
                        textDecoration: out ? 'line-through' : 'none',
                        transition: 'var(--transition-fast)'
                      }}
                    >
                      {s.size}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. QUANTITY & ADD TO BAG */}
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                border: '1.5px solid var(--color-border)',
                borderRadius: 'var(--radius-full)',
                padding: '0.35rem 0.75rem',
                backgroundColor: 'var(--color-surface)'
              }}>
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  disabled={quantity <= 1 || isOutOfStock}
                  style={{ padding: '0.4rem', fontSize: '1rem' }}
                >
                  -
                </button>
                <span style={{ minWidth: '32px', textAlign: 'center', fontWeight: '700', fontSize: '0.95rem' }}>
                  {quantity}
                </span>
                <button
                  onClick={() => setQuantity(Math.min(currentStock, quantity + 1))}
                  disabled={quantity >= currentStock || isOutOfStock}
                  style={{ padding: '0.4rem', fontSize: '1rem' }}
                >
                  +
                </button>
              </div>

              <button
                onClick={handleAddToCart}
                disabled={isOutOfStock || !selectedSize}
                className="btn btn-primary"
                style={{ flex: 1, padding: '1.05rem', fontSize: '0.92rem' }}
              >
                {addedAnimation ? (
                  <>
                    <Check size={18} />
                    <span>{t('product.addedToBag')}</span>
                  </>
                ) : isOutOfStock ? (
                  <span>{t('product.soldOut')}</span>
                ) : (
                  <>
                    <ShoppingBag size={18} />
                    <span>{t('product.addToBag')} • {formatCurrency(effectivePrice * quantity)}</span>
                  </>
                )}
              </button>
            </div>

            {/* Guarantees Box */}
            <div style={{
              backgroundColor: 'var(--color-bg-card)',
              borderRadius: 'var(--radius-lg)',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              border: '1px solid var(--color-border)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.85rem' }}>
                <Truck size={18} color="var(--color-primary-dark)" />
                <span>{t('product.codNotice')}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.85rem' }}>
                <ShieldCheck size={18} color="var(--color-primary-dark)" />
                <span>{t('product.qualityNotice')}</span>
              </div>
            </div>

            {/* Description */}
            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.5rem' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.6rem' }}>
                {t('product.descriptionFit')}
              </h3>
              <p style={{ fontSize: '0.92rem', color: '#555', lineHeight: 1.7 }}>
                {localized(product.description)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
