import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Archive, Search, Check, X, Image as ImageIcon, Trash2, Upload, Loader2 } from 'lucide-react';
import { adminGetProducts, adminCreateProduct, adminUpdateProduct, adminArchiveProduct, adminGetCategories, adminUploadImage } from '../../services/api';

const AVAILABLE_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Standard'];

export default function ProductsManager() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');

  // Form fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sellingPrice, setSellingPrice] = useState(6000);
  const [costPrice, setCostPrice] = useState(3500);
  const [isBestSeller, setIsBestSeller] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [isPromotionActive, setIsPromotionActive] = useState(false);
  const [promotionalPrice, setPromotionalPrice] = useState('');

  // Color variants array
  const [colors, setColors] = useState([
    {
      colorName: 'Desert Taupe',
      colorCode: '#B89C82',
      images: ['https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?q=80&w=800&auto=format&fit=crop'],
      sizes: [
        { size: 'S', stock: 5 },
        { size: 'M', stock: 10 },
        { size: 'L', stock: 5 },
        { size: 'XL', stock: 2 }
      ]
    }
  ]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [prodRes, catRes] = await Promise.all([
        adminGetProducts({ search }),
        adminGetCategories()
      ]);
      if (prodRes.success) setProducts(prodRes.products || []);
      if (catRes.success) setCategories(catRes.categories || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(loadData, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const openCreateModal = () => {
    setEditingProduct(null);
    setName('');
    setDescription('');
    setCategoryId(categories[0]?._id || '');
    setSellingPrice(6500);
    setCostPrice(4000);
    setIsBestSeller(false);
    setIsActive(true);
    setIsPromotionActive(false);
    setPromotionalPrice('');
    setColors([
      {
        colorName: 'Champagne Taupe',
        colorCode: '#B89C82',
        images: ['https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?q=80&w=800&auto=format&fit=crop'],
        sizes: [
          { size: 'S', stock: 5 },
          { size: 'M', stock: 8 },
          { size: 'L', stock: 4 }
        ]
      }
    ]);
    setModalError('');
    setModalOpen(true);
  };

  const openEditModal = (prod) => {
    setEditingProduct(prod);
    setName(prod.name);
    setDescription(prod.description);
    setCategoryId(prod.category?._id || prod.category);
    setSellingPrice(prod.sellingPrice);
    setCostPrice(prod.costPrice);
    setIsBestSeller(!!prod.isBestSeller);
    setIsActive(prod.isActive);
    setIsPromotionActive(!!(prod.promotion && prod.promotion.active));
    setPromotionalPrice(prod.promotion?.promotionalPrice || '');
    setColors(prod.colors || []);
    setModalError('');
    setModalOpen(true);
  };

  const handleAddColor = () => {
    setColors([
      ...colors,
      {
        colorName: 'New Color',
        colorCode: '#222222',
        images: ['https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?q=80&w=800&auto=format&fit=crop'],
        sizes: [
          { size: 'S', stock: 5 },
          { size: 'M', stock: 5 },
          { size: 'L', stock: 5 }
        ]
      }
    ]);
  };

  const handleRemoveColor = (idx) => {
    if (colors.length <= 1) {
      alert('A product must have at least one color variant');
      return;
    }
    setColors(colors.filter((_, i) => i !== idx));
  };

  const handleColorChange = (index, field, value) => {
    const updated = [...colors];
    updated[index][field] = value;
    setColors(updated);
  };

  const handleStockChange = (colorIdx, sizeName, newStock) => {
    const updated = [...colors];
    const sizeObj = updated[colorIdx].sizes.find(s => s.size === sizeName);
    if (sizeObj) {
      sizeObj.stock = Math.max(0, parseInt(newStock, 10) || 0);
    } else {
      updated[colorIdx].sizes.push({ size: sizeName, stock: Math.max(0, parseInt(newStock, 10) || 0) });
    }
    setColors(updated);
  };

  const handleImageUpload = async (colorIdx, file) => {
    if (!file) return;
    try {
      const res = await adminUploadImage(file);
      if (res.success && res.url) {
        const updated = [...colors];
        updated[colorIdx].images.push(res.url);
        setColors(updated);
      }
    } catch (err) {
      alert(err.message || 'Image upload failed');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setModalError('');

    if (!name.trim()) return setModalError('Product name is required');
    if (!categoryId) return setModalError('Category is required');
    if (sellingPrice <= 0) return setModalError('Selling price must be greater than 0');
    if (costPrice < 0) return setModalError('Cost price cannot be negative');

    if (isPromotionActive) {
      if (!promotionalPrice || Number(promotionalPrice) <= 0) {
        return setModalError('Promotional price must be a positive integer in DZD');
      }
      if (Number(promotionalPrice) >= Number(sellingPrice)) {
        return setModalError('Promotional price must be strictly lower than selling price');
      }
    }

    setModalLoading(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        category: categoryId,
        sellingPrice: Number(sellingPrice),
        costPrice: Number(costPrice),
        promotion: {
          active: isPromotionActive,
          promotionalPrice: isPromotionActive ? Number(promotionalPrice) : null
        },
        isActive,
        isBestSeller,
        colors
      };

      if (editingProduct) {
        await adminUpdateProduct(editingProduct._id, payload);
      } else {
        await adminCreateProduct(payload);
      }

      setModalOpen(false);
      loadData();
    } catch (err) {
      setModalError(err.message || 'Failed to save product');
    } finally {
      setModalLoading(false);
    }
  };

  const handleDeleteProduct = async (product) => {
    if (!window.confirm(`Are you sure you want to permanently delete "${product.name}"? This action cannot be undone.`)) return;
    try {
      await adminArchiveProduct(product._id);
      loadData();
    } catch (err) {
      alert(err.message || 'Failed to delete product');
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 className="heading-display" style={{ fontSize: '1.8rem', color: 'var(--color-espresso)' }}>
            PRODUCTS & VARIANTS
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.2rem' }}>
            Catalog, variant colors, sizes matrix, and stock management.
          </p>
        </div>

        <button onClick={openCreateModal} className="btn btn-primary btn-sm">
          <Plus size={16} />
          <span>Add New Product</span>
        </button>
      </div>

      {/* Search Input */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '0.5rem 0.85rem',
        maxWidth: '380px',
        marginBottom: '1.5rem'
      }}>
        <Search size={18} color="#888" style={{ marginRight: '0.5rem' }} />
        <input
          type="text"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none' }}
        />
      </div>

      {/* Table */}
      <div style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-xl)',
        overflow: 'hidden',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)'
      }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center' }}>
            <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto', color: 'var(--color-espresso)' }} />
          </div>
        ) : products.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#777' }}>
            No products found. Click "Add New Product" to create one.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-card)', borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Product</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Category</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Selling Price</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Cost Price</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Variants & Stock</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Status</th>
                <th style={{ padding: '1rem', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p._id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '1rem' }}>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                      <img
                        src={p.colors?.[0]?.images?.[0] || 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?q=80&w=150&auto=format&fit=crop'}
                        alt=""
                        style={{ width: '40px', height: '52px', objectFit: 'cover', borderRadius: '4px' }}
                      />
                      <div>
                        <div style={{ fontWeight: '700' }}>{p.name}</div>
                        {p.isBestSeller && (
                          <span style={{ fontSize: '0.68rem', backgroundColor: 'var(--color-espresso)', color: '#FFF', padding: '0.15rem 0.45rem', borderRadius: '4px', textTransform: 'uppercase' }}>
                            Best Seller
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '1rem' }}>{p.category?.name || 'Uncategorized'}</td>
                  <td style={{ padding: '1rem' }}>
                    {p.promotion && p.promotion.active && p.promotion.promotionalPrice ? (
                      <div>
                        <div style={{ fontWeight: '700', color: '#DC2626' }}>
                          {p.promotion.promotionalPrice.toLocaleString()} DZD
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#888', textDecoration: 'line-through' }}>
                          {p.sellingPrice.toLocaleString()} DZD
                        </div>
                        <span style={{
                          fontSize: '0.65rem',
                          fontWeight: '700',
                          backgroundColor: '#FEE2E2',
                          color: '#DC2626',
                          padding: '0.1rem 0.35rem',
                          borderRadius: '3px',
                          display: 'inline-block',
                          marginTop: '2px'
                        }}>
                          PROMO -{Math.round(((p.sellingPrice - p.promotion.promotionalPrice) / p.sellingPrice) * 100)}%
                        </span>
                      </div>
                    ) : (
                      <div style={{ fontWeight: '700' }}>{p.sellingPrice.toLocaleString()} DZD</div>
                    )}
                  </td>
                  <td style={{ padding: '1rem', color: '#666' }}>{p.costPrice.toLocaleString()} DZD</td>
                  <td style={{ padding: '1rem' }}>
                    <div style={{ fontWeight: '700' }}>{p.totalStock} units in stock</div>
                    <div style={{ fontSize: '0.75rem', color: '#777' }}>{p.colors?.length} color variants</div>
                  </td>
                  <td style={{ padding: '1rem' }}>
                    {p.isActive ? (
                      <span className="badge badge-delivered">Active</span>
                    ) : (
                      <span className="badge badge-cancelled">Inactive</span>
                    )}
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                      <button onClick={() => openEditModal(p)} className="btn btn-secondary btn-sm" style={{ padding: '0.35rem 0.7rem' }}>
                        <Edit2 size={13} />
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={() => handleDeleteProduct(p)}
                        className="btn btn-secondary btn-sm"
                        style={{
                          padding: '0.35rem 0.7rem',
                          color: '#C62828',
                          borderColor: '#FFCDD2',
                          backgroundColor: '#FFF5F5'
                        }}
                        title="Delete product permanently"
                      >
                        <Trash2 size={13} />
                        <span>Delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Product Create/Edit Modal */}
      {modalOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div style={{
            backgroundColor: 'var(--color-surface)',
            borderRadius: 'var(--radius-xl)',
            maxWidth: '850px',
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '2rem',
            boxShadow: 'var(--shadow-lg)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.3rem', fontWeight: '800' }}>
                {editingProduct ? 'Edit Product' : 'Create New Product'}
              </h2>
              <button onClick={() => setModalOpen(false)}><X size={22} /></button>
            </div>

            {modalError && (
              <div style={{ backgroundColor: '#FFEBEE', color: 'var(--color-danger)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.25rem', fontSize: '0.85rem' }}>
                {modalError}
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.3rem' }}>Product Name *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--color-border)' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.3rem' }}>Category *</label>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--color-border)' }}
                  >
                    {categories.map(c => (
                      <option key={c._id} value={c._id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.3rem' }}>Description & Sizing Guide *</label>
                <textarea
                  rows={3}
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--color-border)' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.3rem' }}>Selling Price (DZD) *</label>
                  <input
                    type="number"
                    required
                    value={sellingPrice}
                    onChange={(e) => setSellingPrice(e.target.value)}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--color-border)' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.3rem' }}>Cost Price (DZD) *</label>
                  <input
                    type="number"
                    required
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--color-border)' }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingTop: '1.2rem' }}>
                  <input
                    type="checkbox"
                    id="bestSellerCheck"
                    checked={isBestSeller}
                    onChange={(e) => setIsBestSeller(e.target.checked)}
                  />
                  <label htmlFor="bestSellerCheck" style={{ fontSize: '0.85rem', fontWeight: '600' }}>Best Seller</label>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingTop: '1.2rem' }}>
                  <input
                    type="checkbox"
                    id="activeCheck"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                  />
                  <label htmlFor="activeCheck" style={{ fontSize: '0.85rem', fontWeight: '600' }}>Active in Store</label>
                </div>
              </div>

              {/* Promotion / Sale Price Section */}
              <div style={{
                backgroundColor: isPromotionActive ? '#FEF2F2' : 'var(--color-bg-card)',
                border: isPromotionActive ? '1px solid #FECACA' : '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '1rem',
                transition: 'var(--transition-fast)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isPromotionActive ? '0.75rem' : '0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      id="promoToggle"
                      checked={isPromotionActive}
                      onChange={(e) => setIsPromotionActive(e.target.checked)}
                      style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                    />
                    <label htmlFor="promoToggle" style={{ fontSize: '0.88rem', fontWeight: '700', cursor: 'pointer', color: isPromotionActive ? '#B91C1C' : 'inherit' }}>
                      🔥 Product on Promotion / Sale Price
                    </label>
                  </div>
                  {isPromotionActive && promotionalPrice && Number(promotionalPrice) > 0 && Number(promotionalPrice) < Number(sellingPrice) && (
                    <span style={{
                      backgroundColor: '#DC2626',
                      color: '#FFF',
                      fontSize: '0.72rem',
                      fontWeight: '800',
                      padding: '0.2rem 0.6rem',
                      borderRadius: '4px'
                    }}>
                      -{Math.round(((Number(sellingPrice) - Number(promotionalPrice)) / Number(sellingPrice)) * 100)}% DISCOUNT
                    </span>
                  )}
                </div>

                {isPromotionActive && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'center', paddingTop: '0.5rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#991B1B', marginBottom: '0.3rem' }}>
                        Promotional Price (DZD) *
                      </label>
                      <input
                        type="number"
                        min="1"
                        max={Number(sellingPrice) > 0 ? Number(sellingPrice) - 1 : undefined}
                        placeholder={`e.g. ${Math.round(Number(sellingPrice) * 0.75)}`}
                        value={promotionalPrice}
                        onChange={(e) => setPromotionalPrice(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.65rem',
                          borderRadius: '6px',
                          border: '1.5px solid #F87171',
                          backgroundColor: '#FFF'
                        }}
                      />
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#7F1D1D', lineHeight: 1.4 }}>
                      <div>Normal Price: <strong>{Number(sellingPrice).toLocaleString()} DZD</strong></div>
                      {promotionalPrice && Number(promotionalPrice) > 0 ? (
                        <div>Customer Pays: <strong style={{ color: '#DC2626' }}>{Number(promotionalPrice).toLocaleString()} DZD</strong></div>
                      ) : (
                        <div style={{ color: '#991B1B' }}>Enter promotional price lower than normal price</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Color Variants Section */}
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: '800', textTransform: 'uppercase' }}>
                    Color Variants & Stock Matrix
                  </h3>
                  <button type="button" onClick={handleAddColor} className="btn btn-secondary btn-sm">
                    <Plus size={14} />
                    <span>Add Color</span>
                  </button>
                </div>

                {editingProduct && (
                  <div style={{
                    backgroundColor: '#FFF8E1',
                    border: '1px solid #FFD54F',
                    borderRadius: 'var(--radius-md)',
                    padding: '0.65rem 1rem',
                    marginBottom: '1rem',
                    fontSize: '0.8rem',
                    color: '#6D4C00',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    <span style={{ fontSize: '1rem' }}>⚠️</span>
                    <span>
                      <strong>Stock is read-only here.</strong> To adjust live stock levels, use the{' '}
                      <strong>Inventory Manager</strong> tab — changes there are transactionally safe and fully audited.
                    </span>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {colors.map((color, cIdx) => (
                    <div
                      key={cIdx}
                      style={{
                        backgroundColor: 'var(--color-bg-base)',
                        padding: '1.25rem',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--color-border)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                          <input
                            type="text"
                            value={color.colorName}
                            onChange={(e) => handleColorChange(cIdx, 'colorName', e.target.value)}
                            placeholder="Color Name (e.g. Noir)"
                            style={{ padding: '0.45rem', borderRadius: '4px', border: '1px solid #CCC', fontWeight: '700' }}
                          />
                          <input
                            type="color"
                            value={color.colorCode}
                            onChange={(e) => handleColorChange(cIdx, 'colorCode', e.target.value)}
                            style={{ width: '36px', height: '36px', padding: '0', border: 'none', borderRadius: '50%', cursor: 'pointer' }}
                          />
                        </div>
                        <button type="button" onClick={() => handleRemoveColor(cIdx)} style={{ color: 'var(--color-danger)' }}>
                          <Trash2 size={16} />
                        </button>
                      </div>

                      {/* Sizes & Stock */}
                      <div style={{ marginBottom: '1rem' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: '700', marginBottom: '0.4rem', color: '#666' }}>
                          {editingProduct ? 'CURRENT STOCK PER SIZE (read-only — adjust in Inventory Manager):' : 'INITIAL STOCK PER SIZE:'}
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                          {AVAILABLE_SIZES.map(sz => {
                            const currentSzObj = color.sizes?.find(s => s.size === sz);
                            const currentStock = currentSzObj ? currentSzObj.stock : 0;
                            return (
                              <div key={sz} style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.3rem',
                                backgroundColor: editingProduct ? 'var(--color-bg-base)' : '#FFF',
                                padding: '0.3rem 0.6rem',
                                borderRadius: '4px',
                                border: '1px solid #DDD',
                                opacity: editingProduct ? 0.7 : 1
                              }}>
                                <span style={{ fontWeight: '700', fontSize: '0.8rem' }}>{sz}:</span>
                                <input
                                  type="number"
                                  min="0"
                                  value={currentStock}
                                  readOnly={!!editingProduct}
                                  onChange={editingProduct ? undefined : (e) => handleStockChange(cIdx, sz, e.target.value)}
                                  style={{
                                    width: '48px',
                                    padding: '0.2rem',
                                    textAlign: 'center',
                                    border: '1px solid #CCC',
                                    borderRadius: '3px',
                                    cursor: editingProduct ? 'not-allowed' : 'text',
                                    backgroundColor: editingProduct ? '#F5F5F5' : '#FFF'
                                  }}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Image URLs / Upload */}
                      <div>
                        <div style={{ fontSize: '0.78rem', fontWeight: '700', marginBottom: '0.4rem', color: '#666' }}>
                          IMAGES FOR THIS COLOR:
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          {color.images?.map((img, iIdx) => (
                            <div key={iIdx} style={{ position: 'relative' }}>
                              <img src={img} alt="" style={{ width: '50px', height: '65px', objectFit: 'cover', borderRadius: '4px' }} />
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = [...colors];
                                  updated[cIdx].images = updated[cIdx].images.filter((_, idx) => idx !== iIdx);
                                  setColors(updated);
                                }}
                                style={{
                                  position: 'absolute',
                                  top: '-5px',
                                  right: '-5px',
                                  backgroundColor: 'var(--color-danger)',
                                  color: '#FFF',
                                  borderRadius: '50%',
                                  width: '16px',
                                  height: '16px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '10px'
                                }}
                              >
                                ×
                              </button>
                            </div>
                          ))}

                          <label style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '50px',
                            height: '65px',
                            border: '1px dashed #AAA',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}>
                            <Upload size={16} color="#777" />
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              onChange={(e) => handleImageUpload(cIdx, e.target.files[0])}
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Submit Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" onClick={() => setModalOpen(false)} className="btn btn-secondary btn-sm">
                  Cancel
                </button>
                <button type="submit" disabled={modalLoading} className="btn btn-primary btn-sm">
                  {modalLoading ? <Loader2 size={16} className="animate-spin" /> : null}
                  <span>{editingProduct ? 'Save Changes' : 'Create Product'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
