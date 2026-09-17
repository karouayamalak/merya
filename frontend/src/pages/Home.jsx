import React, { useState, useEffect, useCallback } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import CategoryTile from '../components/CategoryTile';
import ProductCard from '../components/ProductCard';
import { fetchCategories, fetchProducts, fetchBanners } from '../services/api';
import { useLanguage } from '../context/LanguageContext';

export default function Home({ setCurrentView, setSelectedProduct, setSelectedCategory }) {
  const { t, isRtl, localized } = useLanguage();
  const [categories, setCategories] = useState([]);
  const [bestSellers, setBestSellers] = useState([]);
  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentSlide, setCurrentSlide] = useState(0);

  const goToNext = useCallback(() => {
    if (banners.length > 0) {
      setCurrentSlide((prev) => (prev + 1) % banners.length);
    }
  }, [banners.length]);

  const goToPrev = useCallback(() => {
    if (banners.length > 0) {
      setCurrentSlide((prev) => (prev - 1 + banners.length) % banners.length);
    }
  }, [banners.length]);

  // Reset to first slide when banners change
  useEffect(() => {
    setCurrentSlide(0);
  }, [banners.length]);

  useEffect(() => {
    async function loadData() {
      try {
        const [catRes, prodRes, bannerRes] = await Promise.all([
          fetchCategories(),
          fetchProducts({ isBestSeller: 'true', limit: 8 }),
          fetchBanners({ isActive: 'true' })
        ]);
        if (catRes.success) setCategories(catRes.categories || []);
        if (prodRes.success) setBestSellers(prodRes.products || []);
        if (bannerRes?.success && bannerRes.banners) {
          setBanners(bannerRes.banners);
        } else if (bannerRes?.banners) {
          // Backward compatibility if API doesn't return success flag
          setBanners(bannerRes.banners);
        }
      } catch (err) {
        console.error('Failed to load homepage banners:', err);
        setBanners([]);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleCategoryClick = (cat) => {
    setSelectedCategory(cat.slug);
    setCurrentView('shop');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleProductClick = (prod) => {
    setSelectedProduct(prod);
    setCurrentView('product-detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div>
      {/* 1. HERO SECTION - Full-bleed Haute Modest Visual Campaign */}
      <section style={{
        position: 'relative',
        width: '100%',
        minHeight: '85vh',
        height: 'clamp(580px, 88vh, 920px)',
        overflow: 'hidden',
        backgroundColor: 'var(--color-bg-base)',
        marginBottom: '2rem'
      }}>
        <img
          src="/products/merya_dress_blue_1.jpg"
          alt="MERYA DZ Haute Modest Couture Campaign"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center 22%',
            display: 'block'
          }}
        />

        {/* Soft centered overlay */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0.25) 50%, rgba(0, 0, 0, 0.55) 100%)',
          pointerEvents: 'none'
        }} />

        {/* LOGO IN THE MIDDLE OF THE HERO IMAGE */}
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10,
          textAlign: 'center',
          pointerEvents: 'none',
          width: '90%',
          maxWidth: '520px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <img
            src="/logo_white.png"
            alt="MERYA DZ"
            style={{
              width: 'clamp(240px, 36vw, 380px)',
              height: 'auto',
              objectFit: 'contain',
              filter: 'drop-shadow(0 4px 20px rgba(0, 0, 0, 0.65))',
              display: 'block',
              margin: '0 auto'
            }}
          />
        </div>

        {/* SHOP NOW BUTTON IN THE BOTTOM MIDDLE */}
        <div style={{
          position: 'absolute',
          bottom: 'clamp(2rem, 5.5vh, 3.8rem)',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          textAlign: 'center',
          width: 'max-content'
        }}>
          <button
            onClick={() => { setCurrentView('shop'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            style={{
              backgroundColor: '#FFFFFF',
              color: 'var(--color-espresso)',
              padding: '1.2rem 4rem',
              fontSize: '0.92rem',
              fontWeight: '800',
              letterSpacing: isRtl ? '0' : '0.2em',
              textTransform: isRtl ? 'none' : 'uppercase',
              borderRadius: 'var(--radius-full)',
              boxShadow: '0 14px 35px rgba(0, 0, 0, 0.35)',
              border: '2px solid rgba(255, 255, 255, 0.9)',
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              whiteSpace: 'nowrap'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--color-espresso)';
              e.currentTarget.style.color = '#FFFFFF';
              e.currentTarget.style.transform = 'translateY(-3px) scale(1.02)';
              e.currentTarget.style.boxShadow = '0 18px 40px rgba(0, 0, 0, 0.42)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#FFFFFF';
              e.currentTarget.style.color = 'var(--color-espresso)';
              e.currentTarget.style.transform = 'translateY(0) scale(1)';
              e.currentTarget.style.boxShadow = '0 14px 35px rgba(0, 0, 0, 0.35)';
            }}
          >
            {t('home.heroCta')}
          </button>
        </div>
      </section>

      {/* 2. CATEGORIES SECTION */}
      <section style={{
        paddingTop: '3rem',
        paddingBottom: '4.5rem',
        backgroundColor: 'var(--color-bg-base)'
      }}>
        <div className="container">
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            marginBottom: '2.5rem'
          }}>
            <div>
              <span style={{
                fontSize: '0.75rem',
                fontWeight: '700',
                textTransform: isRtl ? 'none' : 'uppercase',
                letterSpacing: isRtl ? '0' : '0.1em',
                color: 'var(--color-primary-dark)'
              }}>
                {t('home.featuredCategoriesSubtitle')}
              </span>
              <h2 className="heading-display" style={{ fontSize: 'clamp(1.6rem, 3vw, 2.4rem)', color: 'var(--color-espresso)', marginTop: '0.25rem' }}>
                {t('home.featuredCategories')}
              </h2>
            </div>
            <button
              onClick={() => { setCurrentView('shop'); window.scrollTo(0, 0); }}
              style={{
                fontSize: '0.85rem',
                fontWeight: '600',
                color: 'var(--color-espresso)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem'
              }}
            >
              <span>{t('home.viewCollection')}</span>
              <ArrowRight size={16} className="rtl-flip" />
            </button>
          </div>

          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem' }}>
              {[1, 2, 3, 4].map(n => (
                <div key={n} className="skeleton" style={{ height: '360px', borderRadius: 'var(--radius-xl)' }} />
              ))}
            </div>
          ) : categories.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: '#777' }}>
              <p style={{ fontSize: '0.95rem' }}>{t('shop.noProducts')}</p>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '1.5rem'
            }}>
              {categories.slice(0, 4).map(cat => (
                <CategoryTile
                  key={cat._id}
                  category={cat}
                  onClick={handleCategoryClick}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* PROMOTIONAL CAMPAIGN BANNER CAROUSEL (Active owner-created banners) */}
      {banners && banners.length > 0 && (
        <section style={{
          padding: '2rem 0',
          backgroundColor: 'var(--color-bg-base)'
        }}>
          <div className="container">
            <div style={{ position: 'relative' }}>
              <div style={{ overflow: 'hidden' }}>
                <div
                  style={{
                    display: 'flex',
                    transition: 'transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                    transform: `translateX(-${currentSlide * 100}%)`
                  }}
                >
                  {banners.map((banner, index) => (
                    <div
                      key={banner._id || index}
                      style={{
                        flex: '0 0 100%',
                        minWidth: '100%',
                        position: 'relative',
                        borderRadius: 'var(--radius-xl)',
                        overflow: 'hidden',
                        minHeight: '260px',
                        display: 'flex',
                        alignItems: 'center',
                        boxShadow: 'var(--shadow-md)',
                        background: banner.image ? `url(${banner.image}) center/cover no-repeat` : 'linear-gradient(135deg, #2A241F 0%, #4A3B32 100%)',
                        color: '#FFFFFF',
                        padding: '3rem 2.5rem'
                      }}
                    >
                      {banner.image && (
                        <div style={{
                          position: 'absolute',
                          inset: 0,
                          background: 'linear-gradient(to right, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.35) 100%)',
                          pointerEvents: 'none'
                        }} />
                      )}
                      <div style={{ position: 'relative', zIndex: 2, maxWidth: '580px' }}>
                        <h3 style={{
                          fontFamily: "var(--font-serif, 'Cormorant Garamond', Georgia, serif)",
                          fontSize: 'clamp(1.6rem, 2.8vw, 2.4rem)',
                          fontWeight: '700',
                          color: '#FFFFFF',
                          marginBottom: '0.6rem'
                        }}>
                          {localized(banner.title)}
                        </h3>
                        {localized(banner.subtitle) && (
                          <p style={{
                            fontSize: '1rem',
                            color: 'rgba(255,255,255,0.88)',
                            marginBottom: '1.5rem',
                            lineHeight: '1.6'
                          }}>
                            {localized(banner.subtitle)}
                          </p>
                        )}
                        {(localized(banner.buttonText) || localized(banner.ctaText)) && (
                          <button
                            onClick={() => {
                              const linkUrl = banner.link || banner.ctaLink;
                              if (linkUrl && linkUrl.startsWith('http')) {
                                window.open(linkUrl, '_blank');
                              } else {
                                setCurrentView('shop');
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }
                            }}
                            className="btn btn-primary"
                            style={{
                              backgroundColor: '#FFFFFF',
                              color: 'var(--color-espresso)',
                              border: 'none',
                              fontWeight: '700',
                              padding: '0.75rem 1.8rem',
                              borderRadius: 'var(--radius-full)'
                            }}
                          >
                            <span>{localized(banner.buttonText) || localized(banner.ctaText)}</span>
                            <ArrowRight size={15} className="rtl-flip" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {banners.length > 1 && (
                <div style={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: '0.75rem',
                  marginTop: '1.5rem'
                }}>
                  <button
                    onClick={goToPrev}
                    className="btn btn-secondary"
                    style={{
                      padding: '0.5rem',
                      borderRadius: '50%',
                      minWidth: '44px',
                      minHeight: '44px'
                    }}
                    aria-label={t('carousel.previous') || 'Previous'}
                  >
                    <ChevronLeft size={20} className={isRtl ? 'rtl-flip' : ''} />
                  </button>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {banners.map((_, index) => (
                      <button
                        key={index}
                        onClick={() => setCurrentSlide(index)}
                        className={index === currentSlide ? 'active' : ''}
                        style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          border: 'none',
                          backgroundColor: index === currentSlide ? 'var(--color-espresso)' : 'rgba(255,255,255,0.4)',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                        aria-label={`${t('carousel.slide') || 'Slide'} ${index + 1}`}
                      />
                    ))}
                  </div>
                  <button
                    onClick={goToNext}
                    className="btn btn-secondary"
                    style={{
                      padding: '0.5rem',
                      borderRadius: '50%',
                      minWidth: '44px',
                      minHeight: '44px'
                    }}
                    aria-label={t('carousel.next') || 'Next'}
                  >
                    <ChevronRight size={20} className={isRtl ? 'rtl-flip' : ''} />
                  </button>
                </div>
              )}
              {banners.length > 1 && (
                <div style={{
                  position: 'absolute',
                  bottom: '1rem',
                  left: '0',
                  right: '0',
                  display: 'flex',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  pointerEvents: 'none'
                }}>
                  {banners.map((_, index) => (
                    <div
                      key={index}
                      className={index === currentSlide ? 'active' : ''}
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: index === currentSlide ? 'var(--color-espresso)' : 'rgba(255,255,255,0.4)',
                        transition: 'all 0.3s ease'
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 3. BEST SELLERS / NEW ARRIVALS */}
      <section style={{
        paddingTop: '3rem',
        paddingBottom: '5rem',
        backgroundColor: 'var(--color-bg-base)'
      }}>
        <div className="container">
          <div style={{ textAlign: 'center', maxWidth: '650px', margin: '0 auto 3rem auto' }}>
            <h2 className="heading-display" style={{ fontSize: 'clamp(1.8rem, 3vw, 2.6rem)', color: 'var(--color-espresso)' }}>
              {t('home.newArrivals')}
            </h2>
            <p style={{ fontSize: '0.95rem', color: '#666', marginTop: '0.5rem' }}>
              {t('home.newArrivalsSubtitle')}
            </p>
          </div>

          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '2rem' }}>
              {[1, 2, 3, 4].map(n => (
                <div key={n} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div className="skeleton" style={{ aspectRatio: '3/4', borderRadius: 'var(--radius-lg)' }} />
                  <div className="skeleton" style={{ height: '20px', width: '70%' }} />
                  <div className="skeleton" style={{ height: '16px', width: '40%' }} />
                </div>
              ))}
            </div>
          ) : bestSellers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: '#777' }}>
              <p style={{ fontSize: '0.95rem' }}>{t('shop.noProducts')}</p>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: '2.5rem 1.75rem'
            }}>
              {bestSellers.map(product => (
                <ProductCard
                  key={product._id}
                  product={product}
                  onSelect={handleProductClick}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 4. VALUE PROPOSITIONS BANNER */}
      <section style={{
        paddingTop: '4rem',
        paddingBottom: '4rem',
        backgroundColor: 'var(--color-bg-card)',
        borderTop: '1px solid var(--color-border)',
        borderBottom: '1px solid var(--color-border)'
      }}>
        <div className="container" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '2.5rem',
          textAlign: 'center'
        }}>
          <div style={{ padding: '1.5rem', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: '700', marginBottom: '0.5rem', color: 'var(--color-espresso)' }}>
              {t('home.features.qualityTitle')}
            </h3>
            <p style={{ fontSize: '0.88rem', color: '#666', lineHeight: 1.6 }}>
              {t('home.features.qualityDesc')}
            </p>
          </div>

          <div style={{ padding: '1.5rem', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: '700', marginBottom: '0.5rem', color: 'var(--color-espresso)' }}>
              {t('home.features.deliveryTitle')}
            </h3>
            <p style={{ fontSize: '0.88rem', color: '#666', lineHeight: 1.6 }}>
              {t('home.features.deliveryDesc')}
            </p>
          </div>

          <div style={{ padding: '1.5rem', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: '700', marginBottom: '0.5rem', color: 'var(--color-espresso)' }}>
              {t('home.features.codTitle')}
            </h3>
            <p style={{ fontSize: '0.88rem', color: '#666', lineHeight: 1.6 }}>
              {t('home.features.codDesc')}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
