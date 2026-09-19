import React, { useState, useEffect } from 'react';
import { Plus, Minus, Save, Check, Loader2, Search, X } from 'lucide-react';
import { adminGetProducts, adminAdjustStock } from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';

export default function InventoryManager() {
  const { t, isRtl, localized } = useLanguage();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [successKey, setSuccessKey] = useState(null);
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState('all'); // 'all' | 'low' | 'out'

  const loadProducts = async () => {
    setLoading(true);
    try {
      const res = await adminGetProducts({ limit: 100 });
      if (res.success) {
        setProducts(res.products || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  const handleStockUpdate = async (productId, colorName, size, newStock) => {
    const num = Number(newStock);
    if (!Number.isInteger(num) || !Number.isSafeInteger(num) || num < 0) {
      alert('Stock must be a non-negative whole integer');
      return;
    }

    const key = `${productId}-${colorName}-${size}`;
    setSavingKey(key);

    try {
      const res = await adminAdjustStock(productId, colorName, size, num);
      if (res.success) {
        // Update local state
        setProducts(prev => prev.map(p => {
          if (p._id === productId) {
            return res.product;
          }
          return p;
        }));

        setSuccessKey(key);
        setTimeout(() => setSuccessKey(null), 2000);
      }
    } catch (err) {
      alert(err.message || 'Failed to update stock');
    } finally {
      setSavingKey(null);
    }
  };

  // Local edit values for stock inputs
  const [stockInputs, setStockInputs] = useState({});

  const handleInputChange = (key, val) => {
    setStockInputs(prev => ({ ...prev, [key]: val }));
  };

  const handleDirectSave = (productId, colorName, size) => {
    const key = `${productId}-${colorName}-${size}`;
    const rawVal = stockInputs[key];
    const rawStr = String(rawVal ?? '').trim();
    if (rawStr === '') {
      alert('Please enter a stock value');
      return;
    }
    // Reject invalid strings (e.g. 50abc, 1.5, 1e3, -5)
    if (!/^\d+$/.test(rawStr)) {
      alert('Stock must be a non-negative whole number (digits only, no decimals or characters)');
      return;
    }
    const num = Number(rawStr);
    if (!Number.isInteger(num) || num < 0 || !Number.isSafeInteger(num)) {
      alert('Stock must be a valid non-negative integer');
      return;
    }
    handleStockUpdate(productId, colorName, size, num);
  };

  // All supported sizes — always show every size row for each color,
  // even if the product was created before a size was introduced.
  const AVAILABLE_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Standard', 'One Size'];

  // Flatten all variants for the table (one row per product × color × size)
  const flattenedVariants = [];
  products.forEach(p => {
    p.colors?.forEach(c => {
      AVAILABLE_SIZES.forEach(sz => {
        const existing = c.sizes?.find(s => s.size === sz);
        flattenedVariants.push({
          productId: p._id,
          productName: p.name,
          categoryName: p.category?.name,
          sellingPrice: p.sellingPrice,
          colorName: c.colorName,
          colorDisplayName: c.colorDisplayName,
          colorCode: c.colorCode,
          image: c.images?.[0] || '',
          size: sz,
          stock: existing ? existing.stock : 0,
          isNewSize: !existing  // brand-new size not yet in the DB
        });
      });
    });
  });

  const filteredVariants = flattenedVariants.filter(v => {
    const pName = typeof v.productName === 'object' ? (v.productName.fr || v.productName.en || v.productName.ar || '') : (v.productName || '');
    const cName = v.colorDisplayName ? (v.colorDisplayName.fr || v.colorDisplayName.en || v.colorDisplayName.ar || v.colorName) : v.colorName;
    const matchSearch = !search.trim() || pName.toLowerCase().includes(search.toLowerCase()) || cName.toLowerCase().includes(search.toLowerCase()) || v.size.toLowerCase().includes(search.toLowerCase());

    if (!matchSearch) return false;
    if (stockFilter === 'out') return v.stock <= 0;
    if (stockFilter === 'low') return v.stock > 0 && v.stock <= 3;
    return true;
  });

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="heading-display" style={{ fontSize: '1.8rem', color: 'var(--color-espresso)' }}>
            {t('admin.inventory.title').toUpperCase()}
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.2rem' }}>
            {t('admin.nav.inventory')} ({filteredVariants.length} / {flattenedVariants.length})
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div style={{
        display: 'flex',
        gap: '0.75rem',
        marginBottom: '1.5rem',
        flexWrap: 'wrap'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: '0.55rem 0.85rem',
          flex: '1 1 240px',
          maxWidth: '400px',
          minHeight: '44px'
        }}>
          <Search size={18} color="#888" style={{ [isRtl ? 'marginLeft' : 'marginRight']: '0.5rem', flexShrink: 0 }} />
          <input
            type="text"
            placeholder={t('common.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none', fontSize: '0.92rem' }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0.25rem', color: '#888' }}>
              <X size={16} />
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={() => setStockFilter('all')}
            className="btn btn-sm"
            style={{
              padding: '0.5rem 0.85rem',
              minHeight: '42px',
              fontSize: '0.8rem',
              fontWeight: stockFilter === 'all' ? '800' : '600',
              backgroundColor: stockFilter === 'all' ? 'var(--color-espresso)' : 'var(--color-surface)',
              color: stockFilter === 'all' ? '#FFF' : 'var(--color-text-main)',
              border: '1px solid var(--color-border)'
            }}
          >
            Tous
          </button>
          <button
            onClick={() => setStockFilter('low')}
            className="btn btn-sm"
            style={{
              padding: '0.5rem 0.85rem',
              minHeight: '42px',
              fontSize: '0.8rem',
              fontWeight: stockFilter === 'low' ? '800' : '600',
              backgroundColor: stockFilter === 'low' ? '#FFF3E0' : 'var(--color-surface)',
              color: stockFilter === 'low' ? '#E65100' : 'var(--color-text-main)',
              border: stockFilter === 'low' ? '1px solid #FFE0B2' : '1px solid var(--color-border)'
            }}
          >
            ⚠️ {t('admin.inventory.lowStockAlert')}
          </button>
          <button
            onClick={() => setStockFilter('out')}
            className="btn btn-sm"
            style={{
              padding: '0.5rem 0.85rem',
              minHeight: '42px',
              fontSize: '0.8rem',
              fontWeight: stockFilter === 'out' ? '800' : '600',
              backgroundColor: stockFilter === 'out' ? '#FFEBEE' : 'var(--color-surface)',
              color: stockFilter === 'out' ? '#C62828' : 'var(--color-text-main)',
              border: stockFilter === 'out' ? '1px solid #FFCDD2' : '1px solid var(--color-border)'
            }}
          >
            ❌ {t('product.soldOut')}
          </button>
        </div>
      </div>

      {/* Desktop Table View (> 768px) */}
      <div className="admin-desktop-only-table" style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-xl)',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)'
      }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center' }}>
            <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto' }} />
          </div>
        ) : filteredVariants.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#777' }}>
            Aucun article trouvé.
          </div>
        ) : (
          <table style={{ width: '100%', minWidth: '660px', borderCollapse: 'collapse', textAlign: isRtl ? 'right' : 'left', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-card)', borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('admin.products.productName')}</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('cart.color')}</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('cart.size')}</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('admin.products.status')}</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('admin.inventory.currentStock')}</th>
                <th style={{ padding: '1rem', textAlign: isRtl ? 'left' : 'right' }}>{t('admin.inventory.quickAdjust')}</th>
              </tr>
            </thead>
            <tbody>
              {flattenedVariants.map((v) => {
                const key = `${v.productId}-${v.colorName}-${v.size}`;
                const isSaving = savingKey === key;
                const isSuccess = successKey === key;
                const inputValue = stockInputs[key] !== undefined ? stockInputs[key] : v.stock;
                const hasChanged = Number(inputValue) !== v.stock;

                return (
                  <tr key={key} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        <img src={v.image} alt="" style={{ width: '36px', height: '48px', objectFit: 'cover', borderRadius: '4px' }} />
                        <div>
                          <div style={{ fontWeight: '700' }}>
                            {typeof v.productName === 'object' ? (localized(v.productName) || v.productName?.fr || v.productName?.en || '—') : (v.productName || '—')}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#777' }}>
                            {typeof v.categoryName === 'object' ? (localized(v.categoryName) || v.categoryName?.fr || v.categoryName?.en || '—') : (v.categoryName || '—')}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ width: '14px', height: '14px', borderRadius: '50%', backgroundColor: v.colorCode, border: '1px solid #CCC' }} />
                        <span style={{ fontWeight: '600' }}>
                          {v.colorDisplayName ? (localized(v.colorDisplayName) || v.colorName) : v.colorName}
                        </span>
                      </div>
                    </td>

                    <td style={{ padding: '1rem', fontWeight: '700' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        {v.size}
                        {v.isNewSize && (
                          <span style={{
                            fontSize: '0.62rem',
                            fontWeight: '800',
                            backgroundColor: '#EDE9FE',
                            color: '#6D28D9',
                            padding: '0.1rem 0.4rem',
                            borderRadius: '4px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em'
                          }}>NEW</span>
                        )}
                      </div>
                    </td>

                    <td style={{ padding: '1rem' }}>
                      {v.isNewSize ? (
                        <span style={{
                          fontSize: '0.72rem',
                          fontWeight: '700',
                          backgroundColor: '#F3F4F6',
                          color: '#9CA3AF',
                          padding: '0.2rem 0.55rem',
                          borderRadius: '4px',
                          display: 'inline-block'
                        }}>Not Added</span>
                      ) : v.stock <= 0 ? (
                        <span className="badge badge-cancelled">{t('product.soldOut')}</span>
                      ) : v.stock <= 3 ? (
                        <span className="badge badge-pending">{t('admin.inventory.lowStockAlert')} ({v.stock})</span>
                      ) : (
                        <span className="badge badge-delivered">{t('product.inStock').replace('{count}', v.stock)}</span>
                      )}
                    </td>

                    <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="number"
                          min="0"
                          value={inputValue}
                          onChange={(e) => handleInputChange(key, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleDirectSave(v.productId, v.colorName, v.size);
                          }}
                          disabled={isSaving}
                          style={{
                            width: '80px',
                            padding: '0.4rem 0.6rem',
                            borderRadius: '6px',
                            border: hasChanged ? '2px solid var(--color-espresso)' : '1px solid var(--color-border)',
                            backgroundColor: hasChanged ? '#FFFDF9' : 'var(--color-surface)',
                            fontWeight: '800',
                            fontSize: '1rem',
                            textAlign: 'center'
                          }}
                        />

                        <button
                          onClick={() => handleDirectSave(v.productId, v.colorName, v.size)}
                          disabled={isSaving || (!hasChanged && !isSuccess && !v.isNewSize)}
                          className="btn btn-primary btn-sm"
                          style={{
                            padding: '0.4rem 0.75rem',
                            fontSize: '0.75rem',
                            backgroundColor: (hasChanged || v.isNewSize) ? 'var(--color-espresso)' : '#888',
                            opacity: (hasChanged || isSaving || v.isNewSize) ? 1 : 0.6
                          }}
                          title={v.isNewSize ? 'Add this size to the product' : t('common.save')}
                        >
                          {isSaving ? <Loader2 size={13} className="animate-spin" /> : isSuccess ? <Check size={13} /> : <Save size={13} />}
                          <span style={{ marginInlineStart: '0.25rem' }}>
                            {isSaving ? t('common.saving') : isSuccess ? t('common.save') : v.isNewSize ? 'Add' : t('common.save')}
                          </span>
                        </button>
                      </div>
                    </td>

                    <td style={{ padding: '1rem', textAlign: isRtl ? 'left' : 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                        <button
                          onClick={() => {
                            const next = Math.max(0, v.stock - 1);
                            handleInputChange(key, next);
                            handleStockUpdate(v.productId, v.colorName, v.size, next);
                          }}
                          disabled={v.stock <= 0 || isSaving || v.isNewSize}
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '0.3rem 0.6rem' }}
                          title="-1"
                        >
                          <Minus size={13} />
                        </button>

                        <button
                          onClick={() => {
                            const next = v.stock + 1;
                            handleInputChange(key, next);
                            handleStockUpdate(v.productId, v.colorName, v.size, next);
                          }}
                          disabled={isSaving || v.isNewSize}
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '0.3rem 0.6rem' }}
                          title="+1"
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Mobile Inventory Cards (<= 768px) */}
      <div className="admin-mobile-only-cards">
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center' }}>
            <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto' }} />
          </div>
        ) : filteredVariants.length === 0 ? (
          <div style={{ padding: '3rem 1rem', textAlign: 'center', color: '#777', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
            Aucun article trouvé.
          </div>
        ) : (
          filteredVariants.map((v) => {
            const key = `${v.productId}-${v.colorName}-${v.size}`;
            const isSaving = savingKey === key;
            const isSuccess = successKey === key;
            const inputValue = stockInputs[key] !== undefined ? stockInputs[key] : v.stock;
            const hasChanged = Number(inputValue) !== v.stock;

            return (
              <div key={key} className="admin-card-item">
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <img src={v.image} alt="" style={{ width: '48px', height: '62px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: '800', fontSize: '0.92rem', color: 'var(--color-espresso)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {typeof v.productName === 'object' ? (localized(v.productName) || v.productName?.fr || v.productName?.en || '—') : (v.productName || '—')}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem', fontSize: '0.8rem', color: '#666' }}>
                      <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: v.colorCode, border: '1px solid #CCC', display: 'inline-block' }} />
                      <span>{v.colorDisplayName ? (localized(v.colorDisplayName) || v.colorName) : v.colorName}</span>
                      <span>•</span>
                      <span style={{ fontWeight: '700', color: 'var(--color-espresso)' }}>{t('cart.size')} {v.size}</span>
                      {v.isNewSize && (
                        <span style={{ fontSize: '0.6rem', fontWeight: '800', backgroundColor: '#EDE9FE', color: '#6D28D9', padding: '0.1rem 0.35rem', borderRadius: '3px' }}>NEW</span>
                      )}
                    </div>
                    <div style={{ marginTop: '0.25rem' }}>
                      {v.isNewSize ? (
                        <span style={{ fontSize: '0.7rem', fontWeight: '700', color: '#9CA3AF' }}>Not Added</span>
                      ) : v.stock <= 0 ? (
                        <span className="badge badge-cancelled" style={{ fontSize: '0.68rem', padding: '0.15rem 0.45rem' }}>{t('product.soldOut')}</span>
                      ) : v.stock <= 3 ? (
                        <span className="badge badge-pending" style={{ fontSize: '0.68rem', padding: '0.15rem 0.45rem' }}>{t('admin.inventory.lowStockAlert')} ({v.stock})</span>
                      ) : (
                        <span className="badge badge-delivered" style={{ fontSize: '0.68rem', padding: '0.15rem 0.45rem' }}>{t('product.inStock').replace('{count}', v.stock)}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Stock Controls Stepper */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: 'var(--color-bg-base)',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-md)'
                }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#666' }}>
                    {t('admin.inventory.currentStock')}:
                  </span>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <button
                      onClick={() => {
                        const next = Math.max(0, v.stock - 1);
                        handleInputChange(key, next);
                        handleStockUpdate(v.productId, v.colorName, v.size, next);
                      }}
                      disabled={v.stock <= 0 || isSaving || v.isNewSize}
                      className="admin-stepper-btn"
                      title="-1"
                    >
                      <Minus size={15} />
                    </button>

                    <input
                      type="number"
                      min="0"
                      value={inputValue}
                      onChange={(e) => handleInputChange(key, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleDirectSave(v.productId, v.colorName, v.size);
                      }}
                      disabled={isSaving}
                      style={{
                        width: '60px',
                        height: '38px',
                        padding: '0 0.4rem',
                        borderRadius: '6px',
                        border: hasChanged ? '2px solid var(--color-espresso)' : '1px solid var(--color-border)',
                        backgroundColor: hasChanged ? '#FFFDF9' : 'var(--color-surface)',
                        fontWeight: '800',
                        fontSize: '1rem',
                        textAlign: 'center'
                      }}
                    />

                    <button
                      onClick={() => {
                        const next = v.stock + 1;
                        handleInputChange(key, next);
                        handleStockUpdate(v.productId, v.colorName, v.size, next);
                      }}
                      disabled={isSaving || v.isNewSize}
                      className="admin-stepper-btn"
                      title="+1"
                    >
                      <Plus size={15} />
                    </button>

                    <button
                      onClick={() => handleDirectSave(v.productId, v.colorName, v.size)}
                      disabled={isSaving || (!hasChanged && !isSuccess && !v.isNewSize)}
                      className="btn btn-primary btn-sm"
                      style={{
                        height: '38px',
                        padding: '0 0.75rem',
                        fontSize: '0.78rem',
                        backgroundColor: (hasChanged || v.isNewSize) ? 'var(--color-espresso)' : '#888',
                        opacity: (hasChanged || isSaving || v.isNewSize) ? 1 : 0.6
                      }}
                    >
                      {isSaving ? <Loader2 size={13} className="animate-spin" /> : isSuccess ? <Check size={13} /> : <Save size={13} />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
