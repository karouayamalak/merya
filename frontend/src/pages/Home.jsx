import React, { useState, useEffect, useCallback } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, X } from 'lucide-react';
import CategoryTile from '../components/CategoryTile';
import ProductCard from '../components/ProductCard';
import { fetchCategories, fetchProducts, fetchBanners } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { handleSafeBannerClick } from '../utils/safeUrl';

export default function Home({ setCurrentView, setSelectedProduct, setSelectedCategory }) {
  const { t, isRtl, localized } = useLanguage();
  const [categories, setCategories] = useState([]);
  const [bestSellers, setBestSellers] = useState([]);

  // Multi-placement banner state
  const [heroBanners, setHeroBanners] = useState([]);
  const [stripBanners, setStripBanners] = useState([]);
  const [sidebarBanners, setSidebarBanners] = useState([]);
  const [popupBanners, setPopupBanners] = useState([]);
  const [announcementBanners, setAnnouncementBanners] = useState([]);
  const [showPopup, setShowPopup] = useState(false);

  const [loading, setLoading] = useState(true);
  const [currentSlide, setCurrentSlide] = useState(0);

  const goToNext = useCallback(() => {
    if (heroBanners.length > 0) {
      setCurrentSlide((prev) => (prev + 1) % heroBanners.length);
    }
  }, [heroBanners.length]);

  const goToPrev = useCallback(() => {
    if (heroBanners.length > 0) {
      setCurrentSlide((prev) => (prev - 1 + heroBanners.length) % heroBanners.length);
    }
  }, [heroBanners.length]);

  // Reset to first slide when hero banners change
  useEffect(() => {
    setCurrentSlide(0);
  }, [heroBanners.length]);

  // Auto-play hero slider if multiple hero banners exist
  useEffect(() => {
    if (heroBanners.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % heroBanners.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [heroBanners.length]);

  useEffect(() => {
    async function loadData() {
      try {
        const [catRes, prodRes, bannerRes] = await Promise.allSettled([
          fetchCategories(),
          fetchProducts({ isBestSeller: 'true', limit: 8 }),
          fetchBanners({ isActive: 'true' })
        ]);

        if (catRes.status === 'fulfilled' && catRes.value?.success) {
          setCategories(catRes.value.categories || []);
        } else {
          setCategories([]);
        }

        if (prodRes.status === 'fulfilled' && prodRes.value?.success) {
          setBestSellers(prodRes.value.products || []);
        } else {
          setBestSellers([]);
        }

        let allBanners = [];
        if (bannerRes.status === 'fulfilled' && bannerRes.value?.success) {
          allBanners = bannerRes.value.banners || [];
        } else if (bannerRes.status === 'fulfilled' && bannerRes.value?.banners) {
          allBanners = bannerRes.value.banners || [];
        }

        const hero = allBanners.filter(b => b.placement === 'hero' || b.placement === 'home_hero');
        const strip = allBanners.filter(b => b.placement === 'homepage-strip' || b.placement === 'home_middle');
        const sidebar = allBanners.filter(b => b.placement === 'sidebar');
        const popup = allBanners.filter(b => b.placement === 'popup');
        const announcement = allBanners.filter(b => b.placement === 'top_announcement' || b.placement === 'promo_bar');

        setHeroBanners(hero);
        setStripBanners(strip);
        setSidebarBanners(sidebar);
        setPopupBanners(popup);
        setAnnouncementBanners(announcement);

        // Show popup modal once per session if configured
        if (popup.length > 0) {
          const firstPopup = popup[0];
          const isDismissed = sessionStorage.getItem(`merya_dismissed_popup_${firstPopup._id}`);
          if (!isDismissed) {
            setShowPopup(true);
          }
        }

      } catch (err) {
        console.error('Unexpected error loading homepage data:', err);
        setCategories([]);
        setBestSellers([]);
        setHeroBanners([]);
        setStripBanners([]);
        setSidebarBanners([]);
        setPopupBanners([]);
        setAnnouncementBanners([]);
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

  // Active hero banner image with default fallback
  const activeHeroBanner = heroBanners.length > 0 ? heroBanners[currentSlide] : null;
  const heroImageSrc = (activeHeroBanner && activeHeroBanner.image)
    ? activeHeroBanner.image
    : '/products/merya_dress_blue_1.jpg';

  return (
    <>
      {/* TOP ANNOUNCEMENT BAR (placement: 'top_announcement') */}
      {announcementBanners && announcementBanners.length > 0 && (
        <section style={{
          backgroundColor: 'var(--color-primary-dark)',
          color: '#FFFFFF',
          padding: '0.75rem 0',
          overflow: 'hidden'
        }}>
          <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2rem' }}>
            {announcementBanners.map((banner, index) => (
              <div key={banner._id || index} style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, justifyContent: 'center' }}>
                {localized(banner.title) && (
                  <span style={{ fontSize: '0.9rem', fontWeight: '500' }}>
                    {localized(banner.title)}
                  </span>
                )}
                {(localized(banner.buttonText) || localized(banner.ctaText)) && (
                  <button
                    onClick={() => {
                      const linkUrl = banner.link || banner.ctaLink;
                      handleSafeBannerClick(linkUrl, setCurrentView, 'shop');
                    }}
                    className="btn btn-secondary"
                    style={{
                      padding: '0.4rem 1rem',
                      fontSize: '0.8rem',
                      borderRadius: 'var(--radius-full)',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {localized(banner.buttonText) || localized(banner.ctaText)}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 1. HERO SECTION - Dynamic Owner Banner Image with Default Fallback */}
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
          key={heroImageSrc}
          src={heroImageSrc}
          alt="MERYA DZ Haute Modest Couture Campaign"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center 22%',
            display: 'block',
            transition: 'opacity 0.6s ease'
          }}
        />

        {/* Centered gradient overlay */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.18) 0%, rgba(0, 0, 0, 0.3) 50%, rgba(0, 0, 0, 0.62) 100%)',
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
          maxWidth: '560px',
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

          {/* Optional banner title & subtitle if configured by owner */}
          {activeHeroBanner && localized(activeHeroBanner.title) && (
            <h2 style={{
              fontFamily: "var(--font-serif, 'Cormorant Garamond', Georgia, serif)",
              fontSize: 'clamp(1.3rem, 2.4vw, 2rem)',
              color: '#FFFFFF',
              marginTop: '1.2rem',
              fontWeight: '600',
              textShadow: '0 2px 12px rgba(0,0,0,0.7)',
              letterSpacing: '0.04em'
            }}>
              {localized(activeHeroBanner.title)}
            </h2>
          )}
          {activeHeroBanner && localized(activeHeroBanner.subtitle) && (
            <p style={{
              fontSize: 'clamp(0.85rem, 1.2vw, 1.05rem)',
              color: 'rgba(255,255,255,0.92)',
              marginTop: '0.4rem',
              textShadow: '0 1px 8px rgba(0,0,0,0.65)'
            }}>
              {localized(activeHeroBanner.subtitle)}
            </p>
          )}
        </div>

        {/* SHOP NOW BUTTON IN THE BOTTOM MIDDLE */}
        <div style={{
          position: 'absolute',
          bottom: 'clamp(1.5rem, 5vh, 3.5rem)',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          textAlign: 'center',
          width: 'max-content',
          maxWidth: '90vw'
        }}>
          <button
            onClick={() => {
              const linkUrl = activeHeroBanner?.link || activeHeroBanner?.ctaLink;
              handleSafeBannerClick(linkUrl, setCurrentView, 'shop');
            }}
            style={{
              backgroundColor: '#FFFFFF',
              color: 'var(--color-espresso)',
              padding: 'clamp(0.6rem, 1.8vw, 0.85rem) clamp(1.5rem, 4vw, 2.5rem)',
              fontSize: 'clamp(0.78rem, 1.8vw, 0.88rem)',
              fontWeight: '700',
              letterSpacing: isRtl ? '0' : '0.12em',
              textTransform: isRtl ? 'none' : 'uppercase',
              borderRadius: 'var(--radius-full)',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
              border: '1.5px solid rgba(255, 255, 255, 0.95)',
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              whiteSpace: 'nowrap',
              maxWidth: '100%'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--color-espresso)';
              e.currentTarget.style.color = '#FFFFFF';
              e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
              e.currentTarget.style.boxShadow = '0 12px 28px rgba(0, 0, 0, 0.38)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#FFFFFF';
              e.currentTarget.style.color = 'var(--color-espresso)';
              e.currentTarget.style.transform = 'translateY(0) scale(1)';
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.3)';
            }}
          >
            {(activeHeroBanner && (localized(activeHeroBanner.buttonText) || localized(activeHeroBanner.ctaText)))
              ? (localized(activeHeroBanner.buttonText) || localized(activeHeroBanner.ctaText))
              : t('home.heroCta')}
          </button>
        </div>

        {/* Multi-hero slider controls if owner has multiple active hero banners */}
        {heroBanners.length > 1 && (
          <>
            <button
              onClick={goToPrev}
              style={{
                position: 'absolute',
                left: isRtl ? 'auto' : '1.5rem',
                right: isRtl ? '1.5rem' : 'auto',
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 12,
                backgroundColor: 'rgba(255, 255, 255, 0.3)',
                backdropFilter: 'blur(8px)',
                color: '#FFFFFF',
                border: '1px solid rgba(255, 255, 255, 0.4)',
                borderRadius: '50%',
                width: '44px',
                height: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              aria-label={t('carousel.previous') || 'Previous'}
            >
              <ChevronLeft size={22} className={isRtl ? 'rtl-flip' : ''} />
            </button>
            <button
              onClick={goToNext}
              style={{
                position: 'absolute',
                right: isRtl ? 'auto' : '1.5rem',
                left: isRtl ? '1.5rem' : 'auto',
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 12,
                backgroundColor: 'rgba(255, 255, 255, 0.3)',
                backdropFilter: 'blur(8px)',
                color: '#FFFFFF',
                border: '1px solid rgba(255, 255, 255, 0.4)',
                borderRadius: '50%',
                width: '44px',
                height: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              aria-label={t('carousel.next') || 'Next'}
            >
              <ChevronRight size={22} className={isRtl ? 'rtl-flip' : ''} />
            </button>
            <div style={{
              position: 'absolute',
              bottom: '1rem',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 12,
              display: 'flex',
              gap: '0.5rem'
            }}>
              {heroBanners.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentSlide(idx)}
                  style={{
                    width: idx === currentSlide ? '24px' : '8px',
                    height: '8px',
                    borderRadius: '4px',
                    border: 'none',
                    backgroundColor: idx === currentSlide ? '#FFFFFF' : 'rgba(255,255,255,0.45)',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease'
                  }}
                  aria-label={`Slide ${idx + 1}`}
                />
              ))}
            </div>
          </>
        )}
      </section>

      {/* 2. CATEGORIES SECTION */}
      <section style={{
        paddingTop: '3rem',
        paddingBottom: '3.5rem',
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

      {/* HOMEPAGE STRIP BANNER (placement: 'homepage-strip') */}
      {stripBanners && stripBanners.length > 0 && stripBanners.map((strip) => (
        <section
          key={strip._id}
          style={{
            margin: '2rem 0',
            backgroundColor: 'var(--color-bg-base)'
          }}
        >
          <div className="container">
            <div style={{
              position: 'relative',
              borderRadius: 'var(--radius-xl)',
              overflow: 'hidden',
              minHeight: '280px',
              display: 'flex',
              alignItems: 'center',
              boxShadow: 'var(--shadow-md)',
              background: strip.image ? `url(${strip.image}) center/cover no-repeat` : 'linear-gradient(135deg, #2A241F 0%, #4A3B32 100%)',
              color: '#FFFFFF',
              padding: '3.5rem 3rem'
            }}>
              {strip.image && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'linear-gradient(to right, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.35) 100%)',
                  pointerEvents: 'none'
                }} />
              )}
              <div style={{ position: 'relative', zIndex: 2, maxWidth: '620px' }}>
                {localized(strip.title) && (
                  <h3 style={{
                    fontFamily: "var(--font-serif, 'Cormorant Garamond', Georgia, serif)",
                    fontSize: 'clamp(1.8rem, 3.2vw, 2.6rem)',
                    fontWeight: '700',
                    color: '#FFFFFF',
                    marginBottom: '0.6rem',
                    lineHeight: '1.2'
                  }}>
                    {localized(strip.title)}
                  </h3>
                )}
                {localized(strip.subtitle) && (
                  <p style={{
                    fontSize: '1.05rem',
                    color: 'rgba(255,255,255,0.9)',
                    marginBottom: '1.75rem',
                    lineHeight: '1.6'
                  }}>
                    {localized(strip.subtitle)}
                  </p>
                )}
                <button
                  onClick={() => {
                    const linkUrl = strip.link || strip.ctaLink;
                    handleSafeBannerClick(linkUrl, setCurrentView, 'shop');
                  }}
                  className="btn btn-primary"
                  style={{
                    backgroundColor: '#FFFFFF',
                    color: 'var(--color-espresso)',
                    border: 'none',
                    fontWeight: '700',
                    padding: '0.85rem 2.2rem',
                    borderRadius: 'var(--radius-full)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.25)'
                  }}
                >
                  <span>{localized(strip.buttonText) || localized(strip.ctaText) || t('home.viewCollection')}</span>
                  <ArrowRight size={16} className="rtl-flip" />
                </button>
              </div>
            </div>
          </div>
        </section>
      ))}

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

      {/* SIDEBAR / SPOTLIGHT BANNER (placement: 'sidebar') */}
      {sidebarBanners && sidebarBanners.length > 0 && sidebarBanners.map((sb) => (
        <section
          key={sb._id}
          style={{
            margin: '2rem 0 3.5rem 0',
            backgroundColor: 'var(--color-bg-base)'
          }}
        >
          <div className="container">
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '2rem',
              backgroundColor: 'var(--color-surface)',
              borderRadius: 'var(--radius-xl)',
              overflow: 'hidden',
              boxShadow: 'var(--shadow-sm)',
              border: '1px solid var(--color-border)'
            }}>
              <div style={{ minHeight: '300px', position: 'relative' }}>
                <img
                  src={sb.image}
                  alt={localized(sb.title) || 'Spotlight'}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block'
                  }}
                />
              </div>
              <div style={{
                padding: '3rem 2.5rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'flex-start'
              }}>
                <span style={{
                  fontSize: '0.75rem',
                  fontWeight: '700',
                  textTransform: 'uppercase',
                  letterSpacing: '0.12em',
                  color: 'var(--color-primary-dark)',
                  marginBottom: '0.5rem'
                }}>
                  {localized(sb.badgeText) || 'MERYA COUTURE'}
                </span>
                <h3 style={{
                  fontFamily: "var(--font-serif, 'Cormorant Garamond', Georgia, serif)",
                  fontSize: 'clamp(1.6rem, 2.5vw, 2.2rem)',
                  fontWeight: '700',
                  color: 'var(--color-espresso)',
                  marginBottom: '0.75rem',
                  lineHeight: '1.25'
                }}>
                  {localized(sb.title)}
                </h3>
                {localized(sb.subtitle) && (
                  <p style={{ fontSize: '0.95rem', color: '#666', lineHeight: '1.6', marginBottom: '1.75rem' }}>
                    {localized(sb.subtitle)}
                  </p>
                )}
                <button
                  onClick={() => {
                    const linkUrl = sb.link || sb.ctaLink;
                    handleSafeBannerClick(linkUrl, setCurrentView, 'shop');
                  }}
                  className="btn btn-primary"
                  style={{
                    backgroundColor: 'var(--color-espresso)',
                    color: '#FFFFFF',
                    padding: '0.85rem 2.2rem',
                    borderRadius: 'var(--radius-full)'
                  }}
                >
                  <span>{localized(sb.buttonText) || localized(sb.ctaText) || t('home.viewCollection')}</span>
                  <ArrowRight size={16} className="rtl-flip" />
                </button>
              </div>
            </div>
          </div>
        </section>
      ))}

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

      {/* PROMOTIONAL POPUP MODAL (placement: 'popup') */}
      {showPopup && popupBanners.length > 0 && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            position: 'relative',
            width: '100%',
            maxWidth: '520px',
            backgroundColor: '#FFFFFF',
            borderRadius: 'var(--radius-xl)',
            overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
            border: '1px solid var(--color-border)'
          }}>
            {/* Close X button */}
            <button
              onClick={() => {
                setShowPopup(false);
                sessionStorage.setItem(`merya_dismissed_popup_${popupBanners[0]._id}`, 'true');
              }}
              style={{
                position: 'absolute',
                top: '1rem',
                right: isRtl ? 'auto' : '1rem',
                left: isRtl ? '1rem' : 'auto',
                zIndex: 10,
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                border: 'none',
                borderRadius: '50%',
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: 'var(--shadow-sm)',
                color: 'var(--color-espresso)'
              }}
              aria-label="Close"
            >
              <X size={20} />
            </button>

            {popupBanners[0].image && (
              <div style={{ height: '240px', position: 'relative' }}>
                <img
                  src={popupBanners[0].image}
                  alt={localized(popupBanners[0].title) || 'Promotion'}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </div>
            )}

            <div style={{ padding: '2rem', textAlign: 'center' }}>
              {localized(popupBanners[0].title) && (
                <h3 style={{
                  fontFamily: "var(--font-serif, 'Cormorant Garamond', Georgia, serif)",
                  fontSize: '1.8rem',
                  fontWeight: '700',
                  color: 'var(--color-espresso)',
                  marginBottom: '0.5rem'
                }}>
                  {localized(popupBanners[0].title)}
                </h3>
              )}
              {localized(popupBanners[0].subtitle) && (
                <p style={{ fontSize: '0.95rem', color: '#666', lineHeight: '1.6', marginBottom: '1.5rem' }}>
                  {localized(popupBanners[0].subtitle)}
                </p>
              )}
              <button
                onClick={() => {
                  setShowPopup(false);
                  sessionStorage.setItem(`merya_dismissed_popup_${popupBanners[0]._id}`, 'true');
                  const linkUrl = popupBanners[0].link || popupBanners[0].ctaLink;
                  handleSafeBannerClick(linkUrl, setCurrentView, 'shop');
                }}
                className="btn btn-primary"
                style={{
                  width: '100%',
                  padding: '1rem',
                  borderRadius: 'var(--radius-full)',
                  fontWeight: '700',
                  fontSize: '0.95rem'
                }}
              >
                <span>{localized(popupBanners[0].buttonText) || localized(popupBanners[0].ctaText) || t('home.viewCollection')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}