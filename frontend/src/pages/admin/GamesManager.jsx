import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Upload, X, Loader2, Check, AlertTriangle } from 'lucide-react';
import { adminGetGames, adminCreateGame, adminUpdateGame, adminDeleteGame, adminUploadImage } from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';

const LANGS = [
  { code: 'fr', label: '🇫🇷 FR', dir: 'ltr' },
  { code: 'ar', label: '🇩🇿 AR', dir: 'rtl' },
  { code: 'en', label: '🇬🇧 EN', dir: 'ltr' }
];

const emptyLocalized = () => ({ fr: '', ar: '', en: '' });

function TranslationBadge({ field }) {
  if (!field || typeof field !== 'object') return null;
  return (
    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
      {LANGS.map(({ code, label }) => {
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
              padding: '0.6rem 1.2rem', fontSize: '0.85rem', fontWeight: '700',
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

const normalize = (f) => {
  if (!f) return emptyLocalized();
  if (typeof f === 'string') return { fr: f, ar: '', en: '' };
  return { fr: f.fr || '', ar: f.ar || '', en: f.en || '' };
};

export default function GamesManager() {
  const { t, isRtl } = useLanguage();
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingGame, setEditingGame] = useState(null);
  const [activeLang, setActiveLang] = useState('fr');

  const [title, setTitle] = useState(emptyLocalized());
  const [description, setDescription] = useState(emptyLocalized());
  const [rules, setRules] = useState(emptyLocalized());
  const [coverImage, setCoverImage] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [displayOrder, setDisplayOrder] = useState(1);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [error, setError] = useState('');

  const loadGames = async () => {
    setLoading(true);
    try {
      const res = await adminGetGames();
      if (res.success) setGames(res.games || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadGames(); }, []);

  const openCreate = () => {
    setEditingGame(null);
    setTitle(emptyLocalized());
    setDescription(emptyLocalized());
    setRules(emptyLocalized());
    setCoverImage('');
    setIsActive(true);
    setDisplayOrder(games.length + 1);
    setActiveLang('fr');
    setError('');
    setModalOpen(true);
  };

  const openEdit = (game) => {
    setEditingGame(game);
    setTitle(normalize(game.title));
    setDescription(normalize(game.description));
    setRules(normalize(game.rules));
    setCoverImage(game.coverImage || '');
    setIsActive(game.isActive);
    setDisplayOrder(game.displayOrder || 1);
    setActiveLang('fr');
    setError('');
    setModalOpen(true);
  };

  const handleImageUpload = async (file) => {
    if (!file) return;
    setUploadingImage(true);
    try {
      const res = await adminUploadImage(file);
      if (res.success && res.url) setCoverImage(res.url);
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
      return setError('Please enter a game title in at least one language');
    }
    setModalLoading(true);
    try {
      const payload = { title, description, rules, coverImage, isActive, displayOrder: Number(displayOrder) };
      if (editingGame) {
        await adminUpdateGame(editingGame._id, payload);
      } else {
        await adminCreateGame(payload);
      }
      setModalOpen(false);
      loadGames();
    } catch (err) {
      setError(err.message || 'Failed to save game');
    } finally {
      setModalLoading(false);
    }
  };

  const handleDelete = async (game) => {
    const displayTitle = typeof game.title === 'object' ? (game.title.fr || game.title.en || '') : (game.title || '');
    if (!window.confirm(`Delete game "${displayTitle}"? This cannot be undone.`)) return;
    try {
      await adminDeleteGame(game._id);
      loadGames();
    } catch (err) {
      alert(err.message);
    }
  };

  const getDisplayTitle = (g) => {
    const n = g.title;
    if (!n) return '—';
    if (typeof n === 'string') return n;
    return n.fr || n.en || n.ar || '—';
  };

  const activeLangDir = LANGS.find(l => l.code === activeLang)?.dir || 'ltr';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 className="heading-display" style={{ fontSize: '1.8rem', color: 'var(--color-espresso)' }}>
            GAMES MANAGER
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.2rem' }}>
            Manage customer-facing games and activities (multilingual)
          </p>
        </div>
        <button onClick={openCreate} className="btn btn-primary btn-sm">
          <Plus size={16} className="rtl-flip" />
          <span>Add Game</span>
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
        ) : games.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#777' }}>
            <p>No games yet. Click "Add Game" to create one.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: isRtl ? 'right' : 'left', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-card)', borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Image</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Title</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Translations</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Slug</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Order</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Status</th>
                <th style={{ padding: '1rem', textAlign: isRtl ? 'left' : 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {games.map((game) => (
                <tr key={game._id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '1rem' }}>
                    {game.coverImage ? (
                      <img src={game.coverImage} alt="" style={{ width: '50px', height: '65px', objectFit: 'cover', borderRadius: '4px' }} />
                    ) : (
                      <div style={{ width: '50px', height: '65px', backgroundColor: 'var(--color-bg-card)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc' }}>
                        🎮
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '1rem', fontWeight: '700' }}>{getDisplayTitle(game)}</td>
                  <td style={{ padding: '1rem' }}><TranslationBadge field={game.title} /></td>
                  <td style={{ padding: '1rem', color: '#666', fontFamily: 'monospace', fontSize: '0.82rem' }}>{game.slug}</td>
                  <td style={{ padding: '1rem' }}>{game.displayOrder}</td>
                  <td style={{ padding: '1rem' }}>
                    {game.isActive
                      ? <span className="badge badge-delivered">Active</span>
                      : <span className="badge badge-cancelled">Inactive</span>
                    }
                  </td>
                  <td style={{ padding: '1rem', textAlign: isRtl ? 'left' : 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                      <button onClick={() => openEdit(game)} className="btn btn-secondary btn-sm" style={{ padding: '0.35rem 0.7rem' }}>
                        <Edit2 size={13} />
                        <span>Edit</span>
                      </button>
                      <button onClick={() => handleDelete(game)} className="btn btn-secondary btn-sm" style={{ padding: '0.35rem 0.7rem', color: 'var(--color-danger)' }}>
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

      {modalOpen && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 1000, padding: '1rem'
        }}>
          <div style={{
            backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-xl)',
            maxWidth: '600px', width: '100%', maxHeight: '90vh',
            overflowY: 'auto', padding: '2rem', boxShadow: 'var(--shadow-lg)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: '800' }}>
                {editingGame ? 'Edit Game' : 'Add New Game'}
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

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.3rem' }}>
                    Title ({activeLang.toUpperCase()})
                    {activeLang === 'fr' && <span style={{ color: 'var(--color-danger)' }}> *</span>}
                  </label>
                  <input
                    type="text"
                    value={title[activeLang]}
                    onChange={(e) => setTitle(prev => ({ ...prev, [activeLang]: e.target.value }))}
                    dir={activeLangDir}
                    placeholder={activeLang === 'ar' ? 'عنوان اللعبة' : activeLang === 'en' ? 'Game title in English' : 'Titre du jeu en français'}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--color-border)', textAlign: activeLang === 'ar' ? 'right' : 'left', marginBottom: '0.75rem' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.3rem' }}>
                    Description ({activeLang.toUpperCase()})
                  </label>
                  <textarea
                    rows={3}
                    value={description[activeLang]}
                    onChange={(e) => setDescription(prev => ({ ...prev, [activeLang]: e.target.value }))}
                    dir={activeLangDir}
                    placeholder={activeLang === 'ar' ? 'وصف اللعبة' : activeLang === 'en' ? 'Game description' : 'Description du jeu'}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--color-border)', resize: 'vertical', textAlign: activeLang === 'ar' ? 'right' : 'left', marginBottom: '0.75rem' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.3rem' }}>
                    Rules / How to Play ({activeLang.toUpperCase()})
                  </label>
                  <textarea
                    rows={4}
                    value={rules[activeLang]}
                    onChange={(e) => setRules(prev => ({ ...prev, [activeLang]: e.target.value }))}
                    dir={activeLangDir}
                    placeholder={activeLang === 'ar' ? 'قواعد اللعبة' : activeLang === 'en' ? 'Rules / how to play' : 'Règles du jeu'}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--color-border)', resize: 'vertical', textAlign: activeLang === 'ar' ? 'right' : 'left' }}
                  />
                </div>
              </div>

              {/* Cover Image */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.5rem' }}>
                  Cover Image
                </label>
                {coverImage ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem', backgroundColor: 'var(--color-bg-base)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                    <img src={coverImage} alt="" style={{ width: '70px', height: '90px', objectFit: 'cover', borderRadius: '6px' }} />
                    <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                      <Upload size={13} /> Change
                      <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e.target.files[0])} style={{ display: 'none' }} />
                    </label>
                  </div>
                ) : (
                  <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                    {uploadingImage ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    {uploadingImage ? 'Uploading...' : 'Upload Cover Image'}
                    <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e.target.files[0])} style={{ display: 'none' }} />
                  </label>
                )}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingTop: '1.2rem' }}>
                  <input type="checkbox" id="gameActive" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                  <label htmlFor="gameActive" style={{ fontSize: '0.85rem', fontWeight: '600' }}>Active (visible to customers)</label>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setModalOpen(false)} className="btn btn-secondary btn-sm">Cancel</button>
                <button type="submit" disabled={modalLoading} className="btn btn-primary btn-sm">
                  {modalLoading ? <Loader2 size={16} className="animate-spin" /> : null}
                  <span>Save Game</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
