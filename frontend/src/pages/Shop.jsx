import React, { useState, useEffect } from 'react';
import { Search, ArrowUpDown } from 'lucide-react';
import ProductCard from '../components/ProductCard';
import { fetchProducts, fetchCategories, fetchBanners } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { isSafeUrl, sanitizeUrl } from '../utils/safeUrl';

export default function Shop({ selectedCategory, setSelectedCategory, onSelectProduct }) {
  const { t, localized } = useLanguage();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [shopBanner, setShopBanner] = useState(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [catRes, bannerRes] = await Promise.allSettled([
          fetchCategories(),
          fetchBanners({ isActive: 'true', placement: 'shop-top' })
        ]);
        if (catRes.status === 'fulfilled' && catRes.value?.success) {
          setCategories(catRes.value.categories || []);
        }
        if (bannerRes.status === 'fulfilled' && bannerRes.value?.success) {
          const list = bannerRes.value.banners || [];
          if (list.length > 0) {
            setShopBanner(list[0]);
          }
        }
      } catch (err) {
        console.error('Failed to load shop initial data:', err);
      }
    }
    loadData();
  }, []);

  useEffect(() => {
    async function loadProducts() {
      setLoading(true);
      try {
        const params = {
          limit: 50,
          sort: sortBy
        };
        if (selectedCategory && selectedCategory !== 'all') {
          params.category = selectedCategory;
        }
        if (search.trim()) {
          params.search = search.trim();
        }

        const res = await fetchProducts(params);
        if (res.success) {
          setProducts(res.products || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    const timer = setTimeout(loadProducts, 250);
    return () => clearTimeout(timer);
  }, [selectedCategory, search, sortBy]);

  return (
    <div style={{ paddingTop: '2.5rem', paddingBottom: '5rem' }}>
      <div className="container">
        {/* Title Header */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <h1 className="heading-display" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', color: 'var(--color-espresso)' }}>
            {t('shop.title')}
          </h1>
          <p style={{ fontSize: '1rem', color: '#666', marginTop: '0.5rem' }}>
            {t('shop.subtitle')}
          </p>
        </div>

        {/* SHOP-TOP BANNER (placement: 'shop-top') */}
        {shopBanner && (
          <div style={{
            position: 'relative',
            borderRadius: 'var(--radius-lg, 12px)',
            overflow: 'hidden',
            marginBottom: '2.5rem',
            minHeight: '200px',
            display: 'flex',
            alignItems: 'center',
            background: shopBanner.image
              ? `linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.6)), url(${shopBanner.image}) center/cover no-repeat`
              : 'var(--color-primary-dark)',
            color: '#FFFFFF',
            padding: '2.5rem 2rem'
          }}>
            <div style={{ maxWidth: '650px', zIndex: 2 }}>
              {shopBanner.title && (
                <h2 style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'clamp(1.4rem, 2.8vw, 2.1rem)',
                  fontWeight: '700',
                  color: '#FFFFFF',
                  marginBottom: '0.5rem',
                  lineHeight: 1.2
                }}>
                  {localized(shopBanner.title)}
                </h2>
              )}
              {shopBanner.subtitle && (
                <p style={{
                  fontSize: '0.95rem',
                  color: 'rgba(255,255,255,0.9)',
                  marginBottom: (shopBanner.ctaLink && shopBanner.ctaText) ? '1.25rem' : '0',
                  maxWidth: '520px'
                }}>
                  {localized(shopBanner.subtitle)}
                </p>
              )}
              {shopBanner.ctaLink && shopBanner.ctaText && isSafeUrl(shopBanner.ctaLink) && (
                <a
                  href={sanitizeUrl(shopBanner.ctaLink)}
                  target={shopBanner.ctaLink.trim().startsWith('http') ? '_blank' : undefined}
                  rel={shopBanner.ctaLink.trim().startsWith('http') ? 'noopener noreferrer' : undefined}
                  style={{
                    display: 'inline-block',
                    padding: '0.6rem 1.4rem',
                    backgroundColor: '#FFFFFF',
                    color: 'var(--color-espresso)',
                    borderRadius: 'var(--radius-full)',
                    fontWeight: '600',
                    fontSize: '0.82rem',
                    textDecoration: 'none',
                    boxShadow: 'var(--shadow-sm)'
                  }}
                >
                  {localized(shopBanner.ctaText)}
                </a>
              )}
            </div>
          </div>
        )}

        {/* Filter Bar */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
          marginBottom: '3rem'
        }}>
          {/* Category Filter Pills */}
          <div style={{
            display: 'flex',
            gap: '0.6rem',
            overflowX: 'auto',
            paddingBottom: '0.5rem',
            scrollbarWidth: 'none'
          }}>
            <button
              onClick={() => setSelectedCategory('all')}
              style={{
                padding: '0.6rem 1.4rem',
                borderRadius: 'var(--radius-full)',
                fontSize: '0.82rem',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                whiteSpace: 'nowrap',
                backgroundColor: !selectedCategory || selectedCategory === 'all' ? 'var(--color-espresso)' : 'var(--color-bg-card)',
                color: !selectedCategory || selectedCategory === 'all' ? '#FFFFFF' : 'var(--color-espresso)',
                transition: 'var(--transition-fast)'
              }}
            >
              {t('shop.allPieces')}
            </button>

            {categories.map((cat) => (
              <button
                key={cat._id}
                onClick={() => setSelectedCategory(cat.slug)}
                style={{
                  padding: '0.6rem 1.4rem',
                  borderRadius: 'var(--radius-full)',
                  fontSize: '0.82rem',
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  whiteSpace: 'nowrap',
                  backgroundColor: selectedCategory === cat.slug ? 'var(--color-espresso)' : 'var(--color-bg-card)',
                  color: selectedCategory === cat.slug ? '#FFFFFF' : 'var(--color-espresso)',
                  transition: 'var(--transition-fast)'
                }}
              >
                {localized(cat.name)}
              </button>
            ))}
          </div>

          {/* Search and Sort controls */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            flexWrap: 'wrap'
          }}>
            {/* Search Input */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-full)',
              padding: '0.5rem 1rem',
              flex: 1,
              maxWidth: '380px'
            }}>
              <Search size={18} color="#888" style={{ marginInlineEnd: '0.5rem' }} />
              <input
                type="text"
                placeholder={t('shop.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', textAlign: 'start' }}
              />
            </div>

            {/* Sort Dropdown */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ArrowUpDown size={16} color="#666" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.55rem 1rem',
                  outline: 'none',
                  fontSize: '0.85rem'
                }}
              >
                <option value="newest">{t('shop.newestFirst')}</option>
                <option value="price-asc">{t('shop.priceLowHigh')}</option>
                <option value="price-desc">{t('shop.priceHighLow')}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Product Grid */}
        {loading ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: '2.5rem 1.75rem'
          }}>
            {[1, 2, 3, 4, 5, 6].map(n => (
              <div key={n} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="skeleton" style={{ aspectRatio: '3/4', borderRadius: 'var(--radius-lg)' }} />
                <div className="skeleton" style={{ height: '20px', width: '70%' }} />
                <div className="skeleton" style={{ height: '16px', width: '40%' }} />
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '5rem 1rem',
            backgroundColor: 'var(--color-bg-card)',
            borderRadius: 'var(--radius-xl)',
            marginTop: '2rem'
          }}>
            <h3 style={{ fontSize: '1.3rem', fontWeight: '700', marginBottom: '0.5rem' }}>{t('shop.noProducts')}</h3>
            <p style={{ color: '#666', marginBottom: '1.5rem' }}>{t('shop.noProductsDesc')}</p>
            <button
              onClick={() => { setSearch(''); setSelectedCategory('all'); }}
              className="btn btn-primary"
            >
              {t('shop.resetFilters')}
            </button>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: '2.5rem 1.75rem'
          }}>
            {products.map(product => (
              <ProductCard
                key={product._id}
                product={product}
                onSelect={onSelectProduct}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
