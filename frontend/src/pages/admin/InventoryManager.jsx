import React, { useState, useEffect } from 'react';
import { Warehouse, Plus, Minus, Save, Check, AlertCircle, Loader2 } from 'lucide-react';
import { adminGetProducts, adminAdjustStock } from '../../services/api';

export default function InventoryManager() {
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
    const key = `${productId}-${colorName}-${size}`;
    setSavingKey(key);

    try {
      const res = await adminAdjustStock(productId, colorName, size, parseInt(newStock, 10));
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
            INVENTORY STOCK MANAGEMENT
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.2rem' }}>
            Direct atomic inventory tracking by Product → Color Variant → Size.
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
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-card)', borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Product</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Color</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Size</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Stock Status</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Available Units</th>
                <th style={{ padding: '1rem', textAlign: 'right' }}>Quick Adjust</th>
              </tr>
            </thead>
            <tbody>
              {flattenedVariants.map((v) => {
                const key = `${v.productId}-${v.colorName}-${v.size}`;
                const isSaving = savingKey === key;
                const isSuccess = successKey === key;

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
                        <span className="badge badge-cancelled">Out of Stock</span>
                      ) : v.stock <= 3 ? (
                        <span className="badge badge-pending">Low Stock ({v.stock})</span>
                      ) : (
                        <span className="badge badge-delivered">Healthy</span>
                      )}
                    </td>

                    <td style={{ padding: '1rem' }}>
                      <span style={{ fontSize: '1.1rem', fontWeight: '800' }}>
                        {v.stock}
                      </span>
                    </td>

                    <td style={{ padding: '1rem', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                        <button
                          onClick={() => handleStockUpdate(v.productId, v.colorName, v.size, Math.max(0, v.stock - 1))}
                          disabled={v.stock <= 0 || isSaving}
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '0.25rem 0.5rem' }}
                        >
                          <Minus size={12} />
                        </button>

                        <button
                          onClick={() => handleStockUpdate(v.productId, v.colorName, v.size, v.stock + 1)}
                          disabled={isSaving}
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '0.25rem 0.5rem' }}
                        >
                          <Plus size={12} />
                        </button>

                        {isSaving && <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-espresso)' }} />}
                        {isSuccess && <Check size={14} color="var(--color-success)" />}
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
