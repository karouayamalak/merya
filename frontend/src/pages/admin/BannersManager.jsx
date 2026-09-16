import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Upload, X, Loader2, Check, AlertTriangle, ExternalLink } from 'lucide-react';
import { adminGetBanners, adminCreateBanner, adminUpdateBanner, adminDeleteBanner, adminUploadImage } from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';

const LANGS = [
  { code: 'fr', label: '🇫🇷 FR', dir: 'ltr' },
  { code: 'ar', label: '🇩🇿 AR', dir: 'rtl' },
  { code: 'en', label: '🇬🇧 EN', dir: 'ltr' }
];

const emptyLocalized = () => ({ fr: '', ar: '', en: '' });

const normalize = (f) => {
  if (!f) return emptyLocalized();
  if (typeof f === 'string') return { fr: f, ar: '', en: '' };
  return { fr: f.fr || '', ar: f.ar || '', en: f.en || '' };
};

function LangTabs({ activeLang, onChange, field }) {
  return (
    <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--color-border)', marginBottom: '0.75rem' }}>
      {LANGS.map((lang) => {
        const hasVal = field && field[lang.code] && field[lang.code].trim().length > 0;
        return (
          <button
            key={lang.code}
            type="button"
            onClick={() => onChange(lang.code)}
            style={{
              padding: '0.55rem 1.1rem', fontSize: '0.85rem', fontWeight: '700',
              border: 'none', borderBottom: activeLang === lang.code ? '2px solid var(--color-espresso)' : '2px solid transparent',
              marginBottom: '-2px', backgroundColor: 'transparent', cursor: 'pointer',
              color: activeLang === lang.code ? 'var(--color-espresso)' : '#888',
              display: 'flex', alignItems: 'center', gap: '0.4rem'
            }}
          >
            {lang.label}
            {hasVal ? <Check size={11} strokeWidth={3} color="#059669" /> : <AlertTriangle size={11} strokeWidth={2.5} color="#D97706" />}
          </button>
        );
      })}
    </div>
  );
}

function TranslationBadge({ field }) {
  if (!field || typeof field !== 'object') return null;
  return (
    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
      {LANGS.map(({ code }) => {
        const has = Boolean(field[code] && field[code].trim());
        return (
          <span key={code} style={{
            fontSize: '0.68rem', fontWeight: '700', padding: '0.15rem 0.45rem', borderRadius: '4px',
            backgroundColor: has ? '#D1FAE5' : '#FEF3C7',
            color: has ? '#065F46' : '#92400E',
            display: 'inline-flex', alignItems: 'center', gap: '0.2rem'
          }}>
            {has ? <Check size={9} strokeWidth={3} /> : <AlertTriangle size={9} strokeWidth={2.5} />}
            {code.toUpperCase()}
          </span>
        );
      })}
    </div>
  );
}

export default function BannersManager() {
  const { t, isRtl } = useLanguage();
  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingBanner, setEditingBanner] = useState(null);
  const [activeLang, setActiveLang] = useState('fr');

  // Multilingual fields
  const [title, setTitle] = useState(emptyLocalized());
  const [subtitle, setSubtitle] = useState(emptyLocalized());
  const [ctaText, setCtaText] = useState(emptyLocalized());

  // Scalar fields
  const [image, setImage] = useState('');
  const [ctaLink, setCtaLink] = useState('');
  const [placement, setPlacement] = useState('hero');
  const [displayOrder, setDisplayOrder] = useState(1);
  const [isActive, setIsActive] = useState(true);

  const [uploadingImage, setUploadingImage] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [error, setError] = useState('');

  const loadBanners = async () => {
    setLoading(true);
    try {
      const res = await adminGetBanners();
      if (res.success) setBanners(res.banners || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadBanners(); }, []);

  const openCreate = () => {
    setEditingBanner(null);
    setTitle(emptyLocalized());
    setSubtitle(emptyLocalized());
    setCtaText(emptyLocalized());
    setImage('');
    setCtaLink('');
    setPlacement('hero');
    setDisplayOrder(banners.length + 1);
    setIsActive(true);
    setActiveLang('fr');
    setError('');
    setModalOpen(true);
  };

  const openEdit = (banner) => {
    setEditingBanner(banner);
    setTitle(normalize(banner.title));
    setSubtitle(normalize(banner.subtitle));
    setCtaText(normalize(banner.ctaText || banner.buttonText));
    setImage(banner.image || '');
    setCtaLink(banner.ctaLink || banner.link || '');
    setPlacement(banner.placement || 'hero');
    setDisplayOrder(banner.displayOrder || 1);
    setIsActive(banner.isActive);
    setActiveLang('fr');
    setError('');
    setModalOpen(true);
  };

  const handleImageUpload = async (file) => {
    if (!file) return;
    setUploadingImage(true);
    try {
      const res = await adminUploadImage(file);
      if (res.success && res.url) setImage(res.url);
      else setError('Upload failed: no URL returned');
    } catch (err) {
      setError('Upload failed: ' + (err.message || 'Error'));
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.fr.trim() && !title.ar.trim() && !title.en.trim()) {
      return setError('Please enter a banner title in at least one language');
    }

    const isTitleComplete = Boolean(title.fr?.trim() && title.ar?.trim() && title.en?.trim());
    if (isActive && !isTitleComplete) {
      return setError('Cannot publish banner: complete French, Arabic, and English translations are required before publishing. Please complete all translations or uncheck "Active" to save as a draft.');
    }

    if (!image.trim()) return setError('Please upload a banner image');

    setModalLoading(true);
    try {
      const payload = {
        title,
        subtitle,
        buttonText: ctaText,
        ctaText,
        link: ctaLink,
        ctaLink,
        image,
        placement,
        displayOrder: Number(displayOrder),
        isActive
      };
      if (editingBanner) {
        await adminUpdateBanner(editingBanner._id, payload);
      } else {
        await adminCreateBanner(payload);
      }
      setModalOpen(false);
      loadBanners();
    } catch (err) {
      setError(err.message || 'Failed to save banner');
    } finally {
      setModalLoading(false);
    }
  };

  const handleDelete = async (banner) => {
    const displayTitle = typeof banner.title === 'object' ? (banner.title.fr || banner.title.en || '') : (banner.title || '');
    if (!window.confirm(`Delete banner "${displayTitle}"? This cannot be undone.`)) return;
    try {
      await adminDeleteBanner(banner._id);
      loadBanners();
    } catch (err) {
      alert(err.message);
    }
  };

  const getDisplayTitle = (b) => {
    const n = b.title;
    if (!n) return '—';
    if (typeof n === 'string') return n;
    return n.fr || n.en || n.ar || '—';
  };

  const activeLangDir = LANGS.find(l => l.code === activeLang)?.dir || 'ltr';

  const PLACEMENTS = ['hero', 'homepage-strip', 'shop-top', 'sidebar', 'popup'];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 className="heading-display" style={{ fontSize: '1.8rem', color: 'var(--color-espresso)' }}>
            {t('admin.banners.title')}
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.2rem' }}>
            {t('admin.banners.subtitle')}
          </p>
        </div>
        <button onClick={openCreate} className="btn btn-primary btn-sm">
          <Plus size={16} className="rtl-flip" />
          <span>{t('admin.banners.addBanner')}</span>
        </button>
      </div>

      {/* Banner Preview Grid */}
      {!loading && banners.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: '1.5rem',
          marginBottom: '2rem'
        }}>
          {banners.filter(b => b.isActive).map(b => (
            <div key={b._id} style={{
              position: 'relative',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              aspectRatio: '16 / 7',
              boxShadow: 'var(--shadow-sm)'
            }}>
              <img src={b.image} alt={getDisplayTitle(b)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(to right, rgba(0,0,0,0.55) 0%, transparent 60%)',
                display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '1rem'
              }}>
                <div style={{ color: '#fff', fontWeight: '800', fontSize: '0.95rem', textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
                  {getDisplayTitle(b)}
                </div>
                <span style={{
                  marginTop: '0.4rem', fontSize: '0.68rem', fontWeight: '700', padding: '0.2rem 0.5rem',
                  borderRadius: '4px', backgroundColor: 'rgba(255,255,255,0.25)', color: '#fff',
                  display: 'inline-block', width: 'fit-content'
                }}>
                  {b.placement}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full Table */}
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
        ) : banners.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#777' }}>
            <p>{t('admin.banners.noBanners')}</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: isRtl ? 'right' : 'left', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-card)', borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('admin.banners.image')}</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('admin.banners.bannerTitle')}</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('admin.products.translations')}</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('admin.banners.placement')}</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('admin.banners.ctaLink')}</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('admin.banners.order')}</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('admin.banners.status')}</th>
                <th style={{ padding: '1rem', textAlign: isRtl ? 'left' : 'right' }}>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {banners.map((b) => (
                <tr key={b._id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '1rem' }}>
                    {b.image
                      ? <img src={b.image} alt="" style={{ width: '80px', height: '36px', objectFit: 'cover', borderRadius: '4px' }} />
                      : <div style={{ width: '80px', height: '36px', backgroundColor: 'var(--color-bg-card)', borderRadius: '4px' }} />
                    }
                  </td>
                  <td style={{ padding: '1rem', fontWeight: '700', maxWidth: '180px' }}>{getDisplayTitle(b)}</td>
                  <td style={{ padding: '1rem' }}><TranslationBadge field={b.title} /></td>
                  <td style={{ padding: '1rem' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: '700', backgroundColor: 'var(--color-bg-card)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                      {b.placement}
                    </span>
                  </td>
                  <td style={{ padding: '1rem', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.ctaLink
                      ? <a href={b.ctaLink} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary-dark)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem' }}>
                          {b.ctaLink} <ExternalLink size={11} />
                        </a>
                      : <span style={{ color: '#aaa' }}>—</span>
                    }
                  </td>
                  <td style={{ padding: '1rem' }}>{b.displayOrder}</td>
                  <td style={{ padding: '1rem' }}>
                    {b.isActive
                      ? <span className="badge badge-delivered">{t('admin.products.active')}</span>
                      : <span className="badge badge-cancelled">{t('admin.products.inactive')}</span>
                    }
                  </td>
                  <td style={{ padding: '1rem', textAlign: isRtl ? 'left' : 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                      <button onClick={() => openEdit(b)} className="btn btn-secondary btn-sm" style={{ padding: '0.35rem 0.7rem' }}>
                        <Edit2 size={13} />
                        <span>{t('common.edit')}</span>
                      </button>
                      <button onClick={() => handleDelete(b)} className="btn btn-secondary btn-sm" style={{ padding: '0.35rem 0.7rem', color: 'var(--color-danger)' }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 1000, padding: '1rem'
        }}>
          <div style={{
            backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-xl)',
            maxWidth: '620px', width: '100%', maxHeight: '90vh',
            overflowY: 'auto', padding: '2rem', boxShadow: 'var(--shadow-lg)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: '800' }}>
                {editingBanner ? t('admin.banners.editBanner') : t('admin.banners.createBanner')}
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
                <LangTabs activeLang={activeLang} onChange={setActiveLang} field={title} />

                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.3rem' }}>
                    Title ({activeLang.toUpperCase()})
                    {activeLang === 'fr' && <span style={{ color: 'var(--color-danger)' }}> *</span>}
                  </label>
                  <input
                    type="text"
                    value={title[activeLang]}
                    onChange={(e) => setTitle(prev => ({ ...prev, [activeLang]: e.target.value }))}
                    dir={activeLangDir}
                    placeholder={activeLang === 'ar' ? 'عنوان البانر' : activeLang === 'en' ? 'Banner title' : 'Titre du banner'}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--color-border)', textAlign: activeLang === 'ar' ? 'right' : 'left' }}
                  />
                </div>

                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.3rem' }}>
                    Subtitle ({activeLang.toUpperCase()}) <span style={{ fontWeight: '400', color: '#888' }}>(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={subtitle[activeLang]}
                    onChange={(e) => setSubtitle(prev => ({ ...prev, [activeLang]: e.target.value }))}
                    dir={activeLangDir}
                    placeholder={activeLang === 'ar' ? 'وصف قصير' : activeLang === 'en' ? 'Short subtitle' : 'Sous-titre'}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--color-border)', textAlign: activeLang === 'ar' ? 'right' : 'left' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.3rem' }}>
                    CTA Button Text ({activeLang.toUpperCase()}) <span style={{ fontWeight: '400', color: '#888' }}>(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={ctaText[activeLang]}
                    onChange={(e) => setCtaText(prev => ({ ...prev, [activeLang]: e.target.value }))}
                    dir={activeLangDir}
                    placeholder={activeLang === 'ar' ? 'نص زر الدعوة' : activeLang === 'en' ? 'Shop Now' : 'Découvrir'}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--color-border)', textAlign: activeLang === 'ar' ? 'right' : 'left' }}
                  />
                </div>
              </div>

              {/* Banner Image */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.5rem' }}>
                  {t('admin.banners.image')} *
                </label>
                {image ? (
                  <div style={{ position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'hidden', aspectRatio: '16 / 6', marginBottom: '0.5rem' }}>
                    <img src={image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <div style={{ position: 'absolute', bottom: '0.5rem', right: '0.5rem' }}>
                      <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
                        <Upload size={13} /> {t('admin.banners.replaceImage')}
                        <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e.target.files[0])} style={{ display: 'none' }} />
                      </label>
                    </div>
                  </div>
                ) : (
                  <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                    {uploadingImage ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    {uploadingImage ? t('common.loading') : t('admin.banners.uploadImage')}
                    <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e.target.files[0])} style={{ display: 'none' }} />
                  </label>
                )}
              </div>

              {/* CTA Link & Placement */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.3rem' }}>
                    CTA Link URL <span style={{ fontWeight: '400', color: '#888' }}>(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={ctaLink}
                    onChange={(e) => setCtaLink(e.target.value)}
                    placeholder="/shop or https://..."
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--color-border)' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.3rem' }}>Placement *</label>
                  <select
                    value={placement}
                    onChange={(e) => setPlacement(e.target.value)}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--color-border)' }}
                  >
                    {PLACEMENTS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.3rem' }}>Display Order</label>
                  <input
                    type="number" min="1"
                    value={displayOrder}
                    onChange={(e) => setDisplayOrder(e.target.value)}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--color-border)' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', paddingTop: '1.2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input type="checkbox" id="bannerActive" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                    <label htmlFor="bannerActive" style={{ fontSize: '0.85rem', fontWeight: '600' }}>{t('admin.products.activePublished')}</label>
                  </div>
                  {(!title.fr?.trim() || !title.ar?.trim() || !title.en?.trim()) && (
                    <span style={{ fontSize: '0.72rem', color: '#b45309', fontWeight: '500' }}>
                      Requires complete FR, AR & EN titles to publish. Otherwise save as draft.
                    </span>
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
