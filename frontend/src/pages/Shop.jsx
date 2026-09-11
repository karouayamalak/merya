import React, { useState, useEffect } from 'react';
import { Search, SlidersHorizontal, ArrowUpDown } from 'lucide-react';
import ProductCard from '../components/ProductCard';
import { fetchProducts, fetchCategories } from '../services/api';

export default function Shop({ selectedCategory, setSelectedCategory, onSelectProduct }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    async function loadProducts() {
      setLoading(true);
      try {
        const params = {};
        if (selectedCategory && selectedCategory !== 'all') {
          params.category = selectedCategory;
        }
        if (search.trim()) {
          params.search = search.trim();
        }

        const res = await fetchProducts(params);
        if (res.success) {
          let list = res.products || [];
          const getEffectivePrice = (p) => (
            p.promotion &&
            p.promotion.active &&
            typeof p.promotion.promotionalPrice === 'number' &&
            p.promotion.promotionalPrice > 0 &&
            p.promotion.promotionalPrice < p.sellingPrice
          ) ? p.promotion.promotionalPrice : p.sellingPrice;

          if (sortBy === 'price-asc') {
            list = [...list].sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b));
          } else if (sortBy === 'price-desc') {
            list = [...list].sort((a, b) => getEffectivePrice(b) - getEffectivePrice(a));
          }
          setProducts(list);
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
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <h1 className="heading-display" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', color: 'var(--color-espresso)' }}>
            OUR MODEST COLLECTION
          </h1>
          <p style={{ fontSize: '1rem', color: '#666', marginTop: '0.5rem' }}>
            Graceful, modest silhouettes tailored for everyday elegance and special occasions.
          </p>
        </div>

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
              All Pieces
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
                {cat.name}
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
              <Search size={18} color="#888" style={{ marginRight: '0.5rem' }} />
              <input
                type="text"
                placeholder="Search abayas, khimars, sets..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%' }}
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
                <option value="newest">Sort: Newest First</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
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
            <h3 style={{ fontSize: '1.3rem', fontWeight: '700', marginBottom: '0.5rem' }}>No products found</h3>
            <p style={{ color: '#666', marginBottom: '1.5rem' }}>Try clearing your search query or selecting a different category.</p>
            <button
              onClick={() => { setSearch(''); setSelectedCategory('all'); }}
              className="btn btn-primary"
            >
              Reset Filters
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
