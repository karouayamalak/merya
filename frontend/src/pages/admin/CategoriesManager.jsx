import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Archive, Upload, X, Loader2, Check, AlertTriangle } from 'lucide-react';
import { adminGetCategories, adminCreateCategory, adminUpdateCategory, adminArchiveCategory, adminUploadImage } from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';

const LANGS = [
  { code: 'fr', label: '🇫🇷 FR', dir: 'ltr' },
  { code: 'ar', label: '🇩🇿 AR', dir: 'rtl' },
  { code: 'en', label: '🇬🇧 EN', dir: 'ltr' }
];

function TranslationBadge({ status }) {
  if (!status) return null;
  const langs = ['fr', 'ar', 'en'];
  return (
    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
      {langs.map((lang) => (
        <span
          key={lang}
          style={{
            fontSize: '0.68rem',
            fontWeight: '700',
            padding: '0.15rem 0.45rem',
            borderRadius: '4px',
            backgroundColor: status[lang] ? '#D1FAE5' : '#FEF3C7',
            color: status[lang] ? '#065F46' : '#92400E',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.2rem'
          }}
        >
          {status[lang] ? <Check size={9} strokeWidth={3} /> : <AlertTriangle size={9} strokeWidth={2.5} />}
          {lang.toUpperCase()}
        </span>
      ))}
    </div>
  );
}

const emptyLocalized = () => ({ fr: '', ar: '', en: '' });

export default function CategoriesManager() {
  const { t, isRtl } = useLanguage();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [activeLang, setActiveLang] = useState('fr');

  // Multilingual form fields
  const [name, setName] = useState(emptyLocalized());
  const [description, setDescription] = useState(emptyLocalized());

  // Scalar fields
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

  useEffect(() => { loadCategories(); }, []);

  const normalizeLocalized = (field) => {
    if (!field) return emptyLocalized();
    if (typeof field === 'string') return { fr: field, ar: '', en: '' };
    return { fr: field.fr || '', ar: field.ar || '', en: field.en || '' };
  };

  const openCreateModal = () => {
    setEditingCategory(null);
    setName(emptyLocalized());
    setDescription(emptyLocalized());
    setImage('');
    setDisplayOrder(categories.length + 1);
    setIsActive(true);
    setActiveLang('fr');
    setError('');
    setModalOpen(true);
  };

  const openEditModal = (cat) => {
    setEditingCategory(cat);
    setName(normalizeLocalized(cat.name));
    setDescription(normalizeLocalized(cat.description));
    setImage(cat.image || '');
    setDisplayOrder(cat.displayOrder || 0);
    setIsActive(cat.isActive);
    setActiveLang('fr');
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
    if (!name.fr.trim() && !name.ar.trim() && !name.en.trim()) {
      return setError('Please enter a category name in at least one language (French recommended)');
    }

    const isNameComplete = Boolean(name.fr?.trim() && name.ar?.trim() && name.en?.trim());
    const isDescComplete = Boolean(description.fr?.trim() && description.ar?.trim() && description.en?.trim());
    if (isActive && (!isNameComplete || !isDescComplete)) {
      return setError('Cannot publish category: Complete French, Arabic, and English translations are required for BOTH name and description before publishing. Please complete all translations or uncheck "Active" to save as a draft.');
    }

    if (!image.trim()) return setError('Please upload an image for the category');

    setModalLoading(true);
    try {
      const payload = {
        name,
        description,
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
    if (!window.confirm(t('admin.categories.archiveConfirm'))) return;
    try {
      await adminArchiveCategory(id);
      loadCategories();
    } catch (err) {
      alert(err.message);
    }
  };

  const getDisplayName = (cat) => {
    const n = cat.name;
    if (!n) return '—';
    if (typeof n === 'string') return n;
    return n.fr || n.en || n.ar || '—';
  };

  const updateNameLang = (lang, val) => setName((prev) => ({ ...prev, [lang]: val }));
  const updateDescLang = (lang, val) => setDescription((prev) => ({ ...prev, [lang]: val }));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 className="heading-display" style={{ fontSize: '1.8rem', color: 'var(--color-espresso)' }}>
            {t('admin.categories.title').toUpperCase()}
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.2rem' }}>
            {t('admin.nav.categories')}
          </p>
        </div>
        <button onClick={openCreateModal} className="btn btn-primary btn-sm">
          <Plus size={16} className="rtl-flip" />
          <span>{t('admin.categories.addCategory')}</span>
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
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: isRtl ? 'right' : 'left', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-card)', borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('admin.banners.image')}</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('admin.categories.categoryName')}</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('admin.products.translations')}</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('admin.categories.slug')}</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('admin.banners.order')}</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('admin.products.status')}</th>
                <th style={{ padding: '1rem', textAlign: isRtl ? 'left' : 'right' }}>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c._id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '1rem' }}>
                    <img src={c.image} alt="" style={{ width: '50px', height: '65px', objectFit: 'cover', borderRadius: '4px' }} />
                  </td>
                  <td style={{ padding: '1rem', fontWeight: '700' }}>{getDisplayName(c)}</td>
                  <td style={{ padding: '1rem' }}>
                    <TranslationBadge status={c.translationStatus} />
                  </td>
                  <td style={{ padding: '1rem', color: '#666', fontFamily: 'monospace' }}>{c.slug}</td>
                  <td style={{ padding: '1rem' }}>{c.displayOrder}</td>
                  <td style={{ padding: '1rem' }}>
                    {c.isArchived ? (
                      <span className="badge badge-cancelled">{t('admin.products.archived')}</span>
                    ) : c.isActive ? (
                      <span className="badge badge-delivered">{t('admin.products.active')}</span>
                    ) : (
                      <span className="badge badge-pending">{t('admin.products.inactive')}</span>
                    )}
                  </td>
                  <td style={{ padding: '1rem', textAlign: isRtl ? 'left' : 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                      <button onClick={() => openEditModal(c)} className="btn btn-secondary btn-sm" style={{ padding: '0.35rem 0.7rem' }}>
                        <Edit2 size={13} />
                        <span>{t('common.edit')}</span>
                      </button>
                      {!c.isArchived && (
                        <button onClick={() => handleArchive(c._id)} className="btn btn-secondary btn-sm" style={{ padding: '0.35rem 0.7rem', color: 'var(--color-danger)' }} title={t('admin.products.archiveProduct')}>
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
            maxWidth: '560px',
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '2rem',
            boxShadow: 'var(--shadow-lg)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: '800' }}>
                {editingCategory ? t('admin.categories.editCategory') : t('admin.categories.addCategory')}
              </h2>
              <button onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
            </div>

            {error && (
              <div style={{ backgroundColor: '#FFEBEE', color: 'var(--color-danger)', padding: '0.75rem', borderRadius: '4px', marginBottom: '1rem', fontSize: '0.85rem' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Language Tabs */}
              <div>
                <div style={{ display: 'flex', gap: '0', borderBottom: '2px solid var(--color-border)', marginBottom: '1rem' }}>
                  {LANGS.map((lang) => {
                    const hasName = name[lang.code] && name[lang.code].trim().length > 0;
                    return (
                      <button
                        key={lang.code}
                        type="button"
                        onClick={() => setActiveLang(lang.code)}
                        style={{
                          padding: '0.6rem 1.2rem',
                          fontSize: '0.85rem',
                          fontWeight: '700',
                          border: 'none',
                          borderBottom: activeLang === lang.code ? '2px solid var(--color-espresso)' : '2px solid transparent',
                          marginBottom: '-2px',
                          backgroundColor: 'transparent',
                          cursor: 'pointer',
                          color: activeLang === lang.code ? 'var(--color-espresso)' : '#888',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem'
                        }}
                      >
                        {lang.label}
                        {hasName
                          ? <Check size={11} strokeWidth={3} color="#059669" />
                          : <AlertTriangle size={11} strokeWidth={2.5} color="#D97706" />
                        }
                      </button>
                    );
                  })}
                </div>

                {/* Name field for active lang */}
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.3rem' }}>
                    {t('admin.categories.categoryName')} ({activeLang.toUpperCase()})
                    {activeLang === 'fr' && <span style={{ color: 'var(--color-danger)' }}> *</span>}
                  </label>
                  <input
                    type="text"
                    value={name[activeLang]}
                    onChange={(e) => updateNameLang(activeLang, e.target.value)}
                    dir={LANGS.find(l => l.code === activeLang)?.dir}
                    placeholder={activeLang === 'ar' ? 'اسم التصنيف بالعربية' : activeLang === 'en' ? 'Category name in English' : 'Nom de la catégorie en français'}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--color-border)', textAlign: activeLang === 'ar' ? 'right' : 'left' }}
                  />
                </div>

                {/* Description field for active lang */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.3rem' }}>
                    {t('admin.categories.description')} ({activeLang.toUpperCase()}) <span style={{ color: '#888', fontWeight: '400' }}>({t('common.optional')})</span>
                  </label>
                  <textarea
                    value={description[activeLang]}
                    onChange={(e) => updateDescLang(activeLang, e.target.value)}
                    dir={LANGS.find(l => l.code === activeLang)?.dir}
                    rows={3}
                    placeholder={activeLang === 'ar' ? 'وصف التصنيف' : activeLang === 'en' ? 'Category description' : 'Description de la catégorie'}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--color-border)', resize: 'vertical', textAlign: activeLang === 'ar' ? 'right' : 'left' }}
                  />
                </div>
              </div>

              {/* Category Image Upload */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.5rem' }}>
                  {t('admin.products.uploadImage')} *
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
                      style={{ width: '80px', height: '100px', objectFit: 'cover', borderRadius: '6px', boxShadow: 'var(--shadow-sm)' }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.8rem', color: '#555', fontWeight: '600' }}>{t('admin.categories.imageReady')}</span>
                      <label className="btn btn-secondary btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', width: 'fit-content' }}>
                        <Upload size={13} />
                        <span>{t('admin.categories.changeImage')}</span>
                        <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e.target.files[0])} style={{ display: 'none' }} />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    border: '2px dashed var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '2rem 1rem',
                    textAlign: 'center',
                    backgroundColor: 'var(--color-bg-base)'
                  }}>
                    {uploadingImage ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--color-primary-dark)' }} />
                        <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>{t('common.loading')}</span>
                      </div>
                    ) : (
                      <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
                        <Upload size={14} />
                        {t('admin.products.uploadImage')}
                        <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e.target.files[0])} style={{ display: 'none' }} />
                      </label>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.3rem' }}>{t('admin.banners.order')}</label>
                  <input
                    type="number"
                    value={displayOrder}
                    onChange={(e) => setDisplayOrder(e.target.value)}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--color-border)' }}
                  />
                </div>
                <div style={{ paddingTop: '1.2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      id="catActive"
                      checked={isActive}
                      onChange={(e) => {
                        const complete = Boolean(name.fr?.trim() && name.ar?.trim() && name.en?.trim());
                        if (e.target.checked && !complete) {
                          setError(t('admin.categories.cannotPublishMissingTranslations'));
                          setIsActive(false);
                        } else {
                          setError('');
                          setIsActive(e.target.checked);
                        }
                      }}
                    />
                    <label htmlFor="catActive" style={{ fontSize: '0.85rem', fontWeight: '600', cursor: 'pointer' }}>
                      {t('admin.products.activePublished')}
                    </label>
                  </div>
                  {(!name.fr?.trim() || !name.ar?.trim() || !name.en?.trim()) && (
                    <div style={{ fontSize: '0.74rem', color: '#D97706', marginTop: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <AlertTriangle size={12} />
                      <span>{t('admin.products.missingTranslationsDraft')}</span>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setModalOpen(false)} className="btn btn-secondary btn-sm">{t('common.cancel')}</button>
                <button type="submit" disabled={modalLoading} className="btn btn-primary btn-sm">
                  {modalLoading ? <Loader2 size={16} className="animate-spin" /> : null}
                  <span>{t('common.save')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
