import React, { useState, useEffect } from 'react';
import { Warehouse, Plus, Minus, Save, Check, AlertCircle, Loader2 } from 'lucide-react';
import { adminGetProducts, adminAdjustStock } from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';

export default function InventoryManager() {
  const { t, isRtl } = useLanguage();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [successKey, setSuccessKey] = useState(null);

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

  // Flatten all variants for the table
  const flattenedVariants = [];
  products.forEach(p => {
    p.colors?.forEach(c => {
      c.sizes?.forEach(s => {
        flattenedVariants.push({
          productId: p._id,
          productName: p.name,
          categoryName: p.category?.name,
          sellingPrice: p.sellingPrice,
          colorName: c.colorName,
          colorCode: c.colorCode,
          image: c.images?.[0] || '',
          size: s.size,
          stock: s.stock
        });
      });
    });
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 className="heading-display" style={{ fontSize: '1.8rem', color: 'var(--color-espresso)' }}>
            {t('admin.inventory.title').toUpperCase()}
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.2rem' }}>
            {t('admin.nav.inventory')}
          </p>
        </div>
      </div>

      <div style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-xl)',
        overflow: 'hidden',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)'
      }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center' }}>
            <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto' }} />
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: isRtl ? 'right' : 'left', fontSize: '0.88rem' }}>
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
                          <div style={{ fontWeight: '700' }}>{v.productName}</div>
                          <div style={{ fontSize: '0.75rem', color: '#777' }}>{v.categoryName}</div>
                        </div>
                      </div>
                    </td>

                    <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ width: '14px', height: '14px', borderRadius: '50%', backgroundColor: v.colorCode, border: '1px solid #CCC' }} />
                        <span style={{ fontWeight: '600' }}>{v.colorName}</span>
                      </div>
                    </td>

                    <td style={{ padding: '1rem', fontWeight: '700' }}>
                      {v.size}
                    </td>

                    <td style={{ padding: '1rem' }}>
                      {v.stock <= 0 ? (
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
                          disabled={isSaving || (!hasChanged && !isSuccess)}
                          className="btn btn-primary btn-sm"
                          style={{
                            padding: '0.4rem 0.75rem',
                            fontSize: '0.75rem',
                            backgroundColor: hasChanged ? 'var(--color-espresso)' : '#888',
                            opacity: (hasChanged || isSaving) ? 1 : 0.6
                          }}
                          title={t('common.save')}
                        >
                          {isSaving ? <Loader2 size={13} className="animate-spin" /> : isSuccess ? <Check size={13} /> : <Save size={13} />}
                          <span style={{ marginInlineStart: '0.25rem' }}>{isSaving ? t('common.saving') : isSuccess ? t('common.save') : t('common.save')}</span>
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
                          disabled={v.stock <= 0 || isSaving}
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
                          disabled={isSaving}
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
    </div>
  );
}
