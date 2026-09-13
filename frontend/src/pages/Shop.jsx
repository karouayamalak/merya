import React, { useState, useEffect } from 'react';
import { Search, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import ProductCard from '../components/ProductCard';
import { fetchProducts, fetchCategories } from '../services/api';
import { useLanguage } from '../context/LanguageContext';

export default function Shop({ selectedCategory, setSelectedCategory, onSelectProduct }) {
  const { t, isRtl, localized } = useLanguage();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 12, total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);

  // Load categories on mount
  useEffect(() => {
    async function loadCategories() {
      try {
        const res = await fetchCategories();
        if (res.success) setCategories(res.categories || []);
      } catch (err) {
        console.error(err);
      }
    }
    loadCategories();
  }, []);

  // Reset to page 1 on category, search, or sort change
  const handleCategoryChange = (slug) => {
    setSelectedCategory(slug);
    setPage(1);
  };

  const handleSearchChange = (val) => {
    setSearch(val);
    setPage(1);
  };

  const handleSortChange = (val) => {
    setSortBy(val);
    setPage(1);
  };

  // Fetch products
  useEffect(() => {
    async function loadProducts() {
      setLoading(true);
      try {
        const params = {
          page,
          limit: 12,
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
          if (res.pagination) {
            setPagination(res.pagination);
          } else {
            setPagination({
              page,
              limit: 12,
              total: (res.products || []).length,
              pages: 1
            });
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    const timer = setTimeout(loadProducts, 250);
    return () => clearTimeout(timer);
  }, [selectedCategory, search, sortBy, page]);

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= pagination.pages && newPage !== page) {
      setPage(newPage);
      window.scrollTo({ top: 100, behavior: 'smooth' });
    }
  };

  // Build page numbers array with ellipses
  const getPageNumbers = () => {
    const totalPages = pagination.pages || 1;
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages = [];
    if (page <= 3) {
      pages.push(1, 2, 3, 4, '...', totalPages);
    } else if (page >= totalPages - 2) {
      pages.push(1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
    } else {
      pages.push(1, '...', page - 1, page, page + 1, '...', totalPages);
    }
    return pages;
  };

  const PrevIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;

  return (
    <div style={{ paddingTop: '2.5rem', paddingBottom: '5rem' }}>
      <div className="container">
        {/* Title Header */}
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <h1 className="heading-display" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', color: 'var(--color-espresso)' }}>
            {t('shop.title')}
          </h1>
          <p style={{ fontSize: '1rem', color: '#666', marginTop: '0.5rem' }}>
            {t('shop.subtitle')}
          </p>
        </div>

        {/* Filter Bar */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
          marginBottom: '2rem'
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
              onClick={() => handleCategoryChange('all')}
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
                transition: 'var(--transition-fast)',
                cursor: 'pointer',
                border: 'none'
              }}
            >
              {t('shop.allPieces')}
            </button>

            {categories.map((cat) => (
              <button
                key={cat._id}
                onClick={() => handleCategoryChange(cat.slug)}
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
                  transition: 'var(--transition-fast)',
                  cursor: 'pointer',
                  border: 'none'
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
                onChange={(e) => handleSearchChange(e.target.value)}
                style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', textAlign: 'start' }}
              />
            </div>

            {/* Total items indicator and Sort */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.85rem', color: '#777' }}>
                {t('shop.itemsCount', { count: pagination.total ?? products.length })}
              </span>

              {/* Sort Dropdown */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ArrowUpDown size={16} color="#666" />
                <select
                  value={sortBy}
                  onChange={(e) => handleSortChange(e.target.value)}
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '0.55rem 1rem',
                    outline: 'none',
                    fontSize: '0.85rem',
                    cursor: 'pointer'
                  }}
                >
                  <option value="newest">{t('shop.newestFirst')}</option>
                  <option value="price-asc">{t('shop.priceLowHigh')}</option>
                  <option value="price-desc">{t('shop.priceHighLow')}</option>
                </select>
              </div>
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
              onClick={() => { setSearch(''); setSelectedCategory('all'); setPage(1); }}
              className="btn btn-primary"
            >
              {t('shop.resetFilters')}
            </button>
          </div>
        ) : (
          <>
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

            {/* Pagination Controls */}
            {pagination.pages > 1 && (
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '0.5rem',
                marginTop: '3.5rem',
                flexWrap: 'wrap'
              }}>
                <button
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page <= 1}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '40px',
                    height: '40px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surface)',
                    color: page <= 1 ? '#bbb' : 'var(--color-espresso)',
                    cursor: page <= 1 ? 'not-allowed' : 'pointer',
                    transition: 'var(--transition-fast)'
                  }}
                  aria-label={t('common.previous')}
                >
                  <PrevIcon size={18} />
                </button>

                {getPageNumbers().map((p, idx) => {
                  if (p === '...') {
                    return (
                      <span key={`dots-${idx}`} style={{ padding: '0 0.5rem', color: '#999', userSelect: 'none' }}>
                        ...
                      </span>
                    );
                  }
                  const isCurrent = p === page;
                  return (
                    <button
                      key={p}
                      onClick={() => handlePageChange(p)}
                      style={{
                        minWidth: '40px',
                        height: '40px',
                        padding: '0 0.5rem',
                        borderRadius: 'var(--radius-md)',
                        border: isCurrent ? '1px solid var(--color-espresso)' : '1px solid var(--color-border)',
                        backgroundColor: isCurrent ? 'var(--color-espresso)' : 'var(--color-surface)',
                        color: isCurrent ? '#FFFFFF' : 'var(--color-espresso)',
                        fontWeight: isCurrent ? '700' : '500',
                        fontSize: '0.9rem',
                        cursor: 'pointer',
                        transition: 'var(--transition-fast)'
                      }}
                      aria-current={isCurrent ? 'page' : undefined}
                    >
                      {p}
                    </button>
                  );
                })}

                <button
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= pagination.pages}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '40px',
                    height: '40px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surface)',
                    color: page >= pagination.pages ? '#bbb' : 'var(--color-espresso)',
                    cursor: page >= pagination.pages ? 'not-allowed' : 'pointer',
                    transition: 'var(--transition-fast)'
                  }}
                  aria-label={t('common.next')}
                >
                  <NextIcon size={18} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
