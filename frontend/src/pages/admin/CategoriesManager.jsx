import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Archive, Upload, X, Loader2 } from 'lucide-react';
import { adminGetCategories, adminCreateCategory, adminUpdateCategory, adminArchiveCategory, adminUploadImage } from '../../services/api';

export default function CategoriesManager() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [displayOrder, setDisplayOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [modalLoading, setModalLoading] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [error, setError] = useState('');

  const loadCategories = async () => {
    setLoading(true);
    try {
      const res = await adminGetCategories();
      if (res.success) setCategories(res.categories || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCategories();
  }, []);

  const openCreateModal = () => {
    setEditingCategory(null);
    setName('');
    setImage('');
    setDisplayOrder(categories.length + 1);
    setIsActive(true);
    setError('');
    setModalOpen(true);
  };

  const openEditModal = (cat) => {
    setEditingCategory(cat);
    setName(cat.name);
    setImage(cat.image);
    setDisplayOrder(cat.displayOrder || 0);
    setIsActive(cat.isActive);
    setError('');
    setModalOpen(true);
  };

  const handleImageUpload = async (file) => {
    if (!file) return;
    setUploadingImage(true);
    setError('');
    try {
      const res = await adminUploadImage(file);
      if (res.success && res.url) {
        setImage(res.url);
      } else {
        setError('Failed to get image URL from upload response');
      }
    } catch (err) {
      setError('Upload failed: ' + (err.message || 'Error'));
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Please enter a category name');
    if (!image.trim()) return setError('Please upload an image for the category');

    setModalLoading(true);
    try {
      const payload = {
        name: name.trim(),
        image: image.trim(),
        displayOrder: Number(displayOrder),
        isActive
      };

      if (editingCategory) {
        await adminUpdateCategory(editingCategory._id, payload);
      } else {
        await adminCreateCategory(payload);
      }

      setModalOpen(false);
      loadCategories();
    } catch (err) {
      setError(err.message || 'Failed to save category');
    } finally {
      setModalLoading(false);
    }
  };

  const handleArchive = async (id) => {
    if (!window.confirm('Are you sure you want to archive this category? It will be safely preserved for historical orders.')) return;
    try {
      await adminArchiveCategory(id);
      loadCategories();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 className="heading-display" style={{ fontSize: '1.8rem', color: 'var(--color-espresso)' }}>
            CATEGORY MANAGEMENT
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.2rem' }}>
            Store collections appearing on the storefront and navigation.
          </p>
        </div>

        <button onClick={openCreateModal} className="btn btn-primary btn-sm">
          <Plus size={16} />
          <span>Add Category</span>
        </button>
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
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Image</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Category Name</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Slug</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Display Order</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Status</th>
                <th style={{ padding: '1rem', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c._id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '1rem' }}>
                    <img src={c.image} alt="" style={{ width: '50px', height: '65px', objectFit: 'cover', borderRadius: '4px' }} />
                  </td>
                  <td style={{ padding: '1rem', fontWeight: '700' }}>{c.name}</td>
                  <td style={{ padding: '1rem', color: '#666', fontFamily: 'monospace' }}>{c.slug}</td>
                  <td style={{ padding: '1rem' }}>{c.displayOrder}</td>
                  <td style={{ padding: '1rem' }}>
                    {c.isArchived ? (
                      <span className="badge badge-cancelled">Archived</span>
                    ) : c.isActive ? (
                      <span className="badge badge-delivered">Active</span>
                    ) : (
                      <span className="badge badge-pending">Hidden</span>
                    )}
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                      <button onClick={() => openEditModal(c)} className="btn btn-secondary btn-sm" style={{ padding: '0.35rem 0.7rem' }}>
                        <Edit2 size={13} />
                        <span>Edit</span>
                      </button>
                      {!c.isArchived && (
                        <button onClick={() => handleArchive(c._id)} className="btn btn-secondary btn-sm" style={{ padding: '0.35rem 0.7rem', color: 'var(--color-danger)' }}>
                          <Archive size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
            maxWidth: '500px',
            width: '100%',
            padding: '2rem',
            boxShadow: 'var(--shadow-lg)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: '800' }}>
                {editingCategory ? 'Edit Category' : 'New Category'}
              </h2>
              <button onClick={() => setModalOpen(false)}><X size={20} /></button>
            </div>

            {error && (
              <div style={{ backgroundColor: '#FFEBEE', color: 'var(--color-danger)', padding: '0.75rem', borderRadius: '4px', marginBottom: '1rem', fontSize: '0.85rem' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.3rem' }}>Category Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--color-border)' }}
                />
              </div>

              {/* Category Image Upload (No URL input) */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.5rem' }}>
                  Category Image *
                </label>
                {image ? (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1.25rem',
                    padding: '0.75rem',
                    backgroundColor: 'var(--color-bg-base)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)'
                  }}>
                    <img
                      src={image}
                      alt="Category Preview"
                      style={{
                        width: '80px',
                        height: '100px',
                        objectFit: 'cover',
                        borderRadius: '6px',
                        boxShadow: 'var(--shadow-sm)'
                      }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.8rem', color: '#555', fontWeight: '600' }}>Image uploaded successfully</span>
                      <label
                        className="btn btn-secondary btn-sm"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', width: 'fit-content' }}
                      >
                        <Upload size={13} />
                        <span>Change Image</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleImageUpload(e.target.files[0])}
                          style={{ display: 'none' }}
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    border: '2px dashed var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '2rem 1rem',
                    textAlign: 'center',
                    backgroundColor: 'var(--color-bg-base)',
                    transition: 'var(--transition-fast)'
                  }}>
                    {uploadingImage ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--color-primary-dark)' }} />
                        <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>Uploading image...</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{
                          backgroundColor: 'var(--color-surface)',
                          width: '44px',
                          height: '44px',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: 'var(--shadow-sm)',
                          color: 'var(--color-primary-dark)'
                        }}>
                          <Upload size={20} />
                        </div>
                        <div>
                          <div style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--color-espresso)' }}>
                            Upload Category Picture
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#777', marginTop: '0.2rem' }}>
                            PNG, JPG, or WEBP up to 5MB
                          </div>
                        </div>
                        <label
                          className="btn btn-primary btn-sm"
                          style={{ cursor: 'pointer', marginTop: '0.25rem' }}
                        >
                          Select Image File
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleImageUpload(e.target.files[0])}
                            style={{ display: 'none' }}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.3rem' }}>Display Order</label>
                  <input
                    type="number"
                    value={displayOrder}
                    onChange={(e) => setDisplayOrder(e.target.value)}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--color-border)' }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingTop: '1.2rem' }}>
                  <input
                    type="checkbox"
                    id="catActive"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                  />
                  <label htmlFor="catActive" style={{ fontSize: '0.85rem', fontWeight: '600' }}>Active</label>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" onClick={() => setModalOpen(false)} className="btn btn-secondary btn-sm">Cancel</button>
                <button type="submit" disabled={modalLoading} className="btn btn-primary btn-sm">
                  {modalLoading ? <Loader2 size={16} className="animate-spin" /> : null}
                  <span>Save</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
