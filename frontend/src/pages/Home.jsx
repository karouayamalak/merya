import React, { useState, useEffect } from 'react';
import { ArrowRight, Sparkles, CheckCircle2, ShieldCheck, Compass } from 'lucide-react';
import CategoryTile from '../components/CategoryTile';
import ProductCard from '../components/ProductCard';
import { fetchCategories, fetchProducts } from '../services/api';

export default function Home({ setCurrentView, setSelectedProduct, setSelectedCategory }) {
  const [categories, setCategories] = useState([]);
  const [bestSellers, setBestSellers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [catRes, prodRes] = await Promise.all([
          fetchCategories(),
          fetchProducts({ isBestSeller: 'true', limit: 8 })
        ]);
        if (catRes.success) setCategories(catRes.categories || []);
        if (prodRes.success) setBestSellers(prodRes.products || []);
      } catch (err) {
        console.error('Failed to load homepage data', err);
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
          src="/uploads/merya_dress_blue_1.jpg"
          alt="MERYA DZ Haute Modest Couture Campaign"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center 22%',
            display: 'block'
          }}
        />

        {/* Soft centered overlay to provide subtle contrast for the logo and button */}
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
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
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
            Shop Now
          </button>
        </div>
      </section>

      {/* 2. CATEGORIES SECTION - 4 Rounded tiles matching reference layout */}
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
              <span style={{ fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-primary-dark)' }}>
                Curated Selections
              </span>
              <h2 className="heading-display" style={{ fontSize: 'clamp(1.6rem, 3vw, 2.4rem)', color: 'var(--color-espresso)', marginTop: '0.25rem' }}>
                EXPLORE CATEGORIES
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
              View All Categories →
            </button>
          </div>

          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem' }}>
              {[1, 2, 3, 4].map(n => (
                <div key={n} className="skeleton" style={{ height: '360px', borderRadius: 'var(--radius-xl)' }} />
              ))}
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

      {/* 3. BEST SELLERS / NEW ARRIVALS - Inspired by reference grid */}
      <section style={{
        paddingTop: '3rem',
        paddingBottom: '5rem',
        backgroundColor: 'var(--color-bg-base)'
      }}>
        <div className="container">
          <div style={{ textAlign: 'center', maxWidth: '650px', margin: '0 auto 3rem auto' }}>
            <h2 className="heading-display" style={{ fontSize: 'clamp(1.8rem, 3vw, 2.6rem)', color: 'var(--color-espresso)' }}>
              NEW ARRIVALS
            </h2>
            <p style={{ fontSize: '0.95rem', color: '#666', marginTop: '0.5rem' }}>
              Timeless pieces crafted with premium fabrics. Designed to elevate your modest wardrobe every day.
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

      {/* 4. MID-PAGE EDITORIAL BANNER - "DESIGNED FOR EVERY SEASON" */}
      <section style={{
        paddingTop: '4rem',
        paddingBottom: '4rem',
        backgroundColor: 'var(--color-bg-card)'
      }}>
        <div className="container" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          alignItems: 'center',
          gap: '3rem'
        }}>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-primary-dark)' }}>
              MERYA Atelier
            </span>
            <h2 className="heading-display" style={{
              fontSize: 'clamp(2rem, 3.5vw, 3rem)',
              color: 'var(--color-espresso)',
              marginTop: '0.5rem',
              marginBottom: '1rem',
              lineHeight: 1.1
            }}>
              DESIGNED FOR <br />
              EVERY SEASON
            </h2>
            <p style={{ fontSize: '1rem', color: '#666', lineHeight: 1.6, marginBottom: '2rem', maxWidth: '440px' }}>
              Comfort meets modern aesthetics. Whether for university, professional meetings, or celebratory gatherings, our pieces offer modesty with refined contemporary ease.
            </p>
            <button
              onClick={() => { setCurrentView('shop'); window.scrollTo(0, 0); }}
              className="btn btn-primary"
            >
              Explore All Designs
            </button>
          </div>

          <div style={{
            borderRadius: 'var(--radius-xl)',
            overflow: 'hidden',
            aspectRatio: '16 / 10',
            boxShadow: 'var(--shadow-md)'
          }}>
            <img
              src="/uploads/merya_dress_brown_1.jpg"
              alt="Designed for Every Season"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
