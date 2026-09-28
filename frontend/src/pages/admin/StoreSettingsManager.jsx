import React, { useState, useEffect } from 'react';
import { Palette, Link2, Save, CheckCircle2, Truck, AlertCircle, Loader2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useStoreSettings } from '../../context/StoreSettingsContext';

export default function StoreSettingsManager() {
  const { isRtl } = useLanguage();
  const { settings, updateSettings, loading: initialLoading } = useStoreSettings();

  // Local form state
  const [logoVariant, setLogoVariant] = useState('white');
  const [deliveryNoticeDays, setDeliveryNoticeDays] = useState(3);
  const [facebook, setFacebook] = useState('');
  const [instagram, setInstagram] = useState('');
  const [tiktok, setTiktok] = useState('');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Populate form when database settings load or change
  useEffect(() => {
    if (settings) {
      setLogoVariant(settings.logoVariant || 'white');
      setDeliveryNoticeDays(settings.deliveryNoticeDays ?? 3);
      setFacebook(settings.socialLinks?.facebook || '');
      setInstagram(settings.socialLinks?.instagram || '');
      setTiktok(settings.socialLinks?.tiktok || '');
    }
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setErrorMessage('');

    try {
      await updateSettings({
        logoVariant,
        deliveryNoticeDays: parseInt(deliveryNoticeDays, 10) || 3,
        socialLinks: {
          facebook: facebook.trim(),
          instagram: instagram.trim(),
          tiktok: tiktok.trim()
        }
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      setErrorMessage(err.message || 'Failed to persist settings in database.');
    } finally {
      setSaving(false);
    }
  };

  // --- Styles ---
  const card = {
    backgroundColor: '#fff',
    borderRadius: '14px',
    border: '1px solid #e8e3dd',
    padding: '2rem',
    marginBottom: '1.75rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
  };

  const sectionTitle = {
    fontSize: '0.8rem',
    fontWeight: '800',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: '#2A241F',
    marginBottom: '1.25rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  };

  const inputStyle = {
    width: '100%',
    padding: '0.7rem 1rem',
    border: '1.5px solid #e0d9d0',
    borderRadius: '8px',
    fontSize: '0.9rem',
    color: '#333',
    outline: 'none',
    transition: 'border-color 0.2s',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  };

  const labelStyle = {
    display: 'block',
    fontSize: '0.8rem',
    fontWeight: '600',
    color: '#555',
    marginBottom: '0.4rem',
  };

  return (
    <div style={{ maxWidth: '680px', margin: '0 auto', padding: '2rem 1rem', direction: isRtl ? 'rtl' : 'ltr' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{
          fontFamily: "'Cormorant Garamond', Georgia, serif",
          fontSize: '1.8rem',
          fontWeight: '700',
          color: '#2A241F',
          margin: 0
        }}>
          Store Settings
        </h2>
        <span style={{
          fontSize: '0.72rem',
          backgroundColor: '#f4ede6',
          color: '#6e4e37',
          padding: '0.2rem 0.6rem',
          borderRadius: '20px',
          fontWeight: '600'
        }}>
          Database Synced
        </span>

      </div>
      <p style={{ fontSize: '0.85rem', color: '#888', marginBottom: '2rem' }}>
        Configure the hero logo appearance, delivery notice, and official social media accounts. All changes are stored in the database.
      </p>

      {/* LOGO VARIANT */}
      <div style={card}>
        <div style={sectionTitle}>
          <Palette size={15} />
          Hero Logo Color (Database Stored)
        </div>
        <p style={{ fontSize: '0.82rem', color: '#777', marginBottom: '1.25rem', lineHeight: 1.6 }}>
          Choose which logo version appears over the homepage hero banner.
          The <strong>White</strong> version works best on photography/dark backgrounds;
          the <strong>Original</strong> version showcases the brand colors.
        </p>

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {[
            { value: 'white', src: '/logo_white.png', label: 'White (Light on Dark)', bg: '#2A241F' },
            { value: 'original', src: '/logo.png', label: 'Original Colors (Header Logo)', bg: '#f7f4f0' },
          ].map(({ value, src, label, bg }) => (
            <button
              key={value}
              type="button"
              onClick={() => setLogoVariant(value)}
              style={{
                flex: '1 1 200px',
                minWidth: '180px',
                border: logoVariant === value
                  ? '2.5px solid var(--color-espresso, #2A241F)'
                  : '2px solid #e0d9d0',
                borderRadius: '12px',
                padding: '1rem',
                backgroundColor: bg,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                textAlign: 'center',
                position: 'relative',
                boxShadow: logoVariant === value ? '0 0 0 4px rgba(42,36,31,0.1)' : 'none',
              }}
            >
              {logoVariant === value && (
                <span style={{
                  position: 'absolute',
                  top: '0.5rem',
                  right: '0.5rem',
                  backgroundColor: '#2A241F',
                  color: '#fff',
                  borderRadius: '50%',
                  width: '22px',
                  height: '22px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.7rem',
                }}>✓</span>
              )}
              <img
                src={src}
                alt={label}
                style={{ height: '60px', width: 'auto', objectFit: 'contain', display: 'block', margin: '0 auto 0.6rem auto' }}
              />
              <span style={{
                fontSize: '0.78rem',
                fontWeight: '600',
                color: bg === '#2A241F' ? '#fff' : '#555',
              }}>
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* DELIVERY NOTICE */}
      <div style={card}>
        <div style={sectionTitle}>
          <Truck size={15} />
          Delivery Notice
        </div>
        <p style={{ fontSize: '0.82rem', color: '#777', marginBottom: '1.25rem', lineHeight: 1.6 }}>
          Set the estimated shipping duration displayed to customers in the homepage feature badge.
        </p>

        <div style={{ maxWidth: '240px' }}>
          <label style={labelStyle} htmlFor="ss-delivery-days">
            Estimated Delivery Days
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              id="ss-delivery-days"
              type="number"
              min="1"
              max="30"
              value={deliveryNoticeDays}
              onChange={e => setDeliveryNoticeDays(e.target.value)}
              style={{ ...inputStyle, width: '90px', textAlign: 'center', fontWeight: 'bold' }}
              onFocus={e => { e.target.style.borderColor = '#2A241F'; }}
              onBlur={e => { e.target.style.borderColor = '#e0d9d0'; }}
            />
            <span style={{ fontSize: '0.88rem', color: '#555', fontWeight: '500' }}>business days</span>
          </div>
        </div>
      </div>

      {/* SOCIAL LINKS */}
      <div style={card}>
        <div style={sectionTitle}>
          <Link2 size={15} />
          Social Media Links (Database Stored)
        </div>
        <p style={{ fontSize: '0.82rem', color: '#777', marginBottom: '1.25rem', lineHeight: 1.6 }}>
          Paste your full profile URLs below. They are saved in the database and appear as clickable icon buttons in the store footer.
          Leave any field empty to hide that icon.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Facebook */}
          <div>
            <label style={labelStyle} htmlFor="ss-facebook">
              Facebook Page URL
            </label>
            <input
              id="ss-facebook"
              type="url"
              value={facebook}
              onChange={e => setFacebook(e.target.value)}
              placeholder="https://www.facebook.com/meryaDZ"
              style={inputStyle}
              onFocus={e => { e.target.style.borderColor = '#2A241F'; }}
              onBlur={e => { e.target.style.borderColor = '#e0d9d0'; }}
            />
          </div>

          {/* Instagram */}
          <div>
            <label style={labelStyle} htmlFor="ss-instagram">
              Instagram Profile URL
            </label>
            <input
              id="ss-instagram"
              type="url"
              value={instagram}
              onChange={e => setInstagram(e.target.value)}
              placeholder="https://www.instagram.com/merya.dz"
              style={inputStyle}
              onFocus={e => { e.target.style.borderColor = '#2A241F'; }}
              onBlur={e => { e.target.style.borderColor = '#e0d9d0'; }}
            />
          </div>

          {/* TikTok */}
          <div>
            <label style={labelStyle} htmlFor="ss-tiktok">
              TikTok Profile URL
            </label>
            <input
              id="ss-tiktok"
              type="url"
              value={tiktok}
              onChange={e => setTiktok(e.target.value)}
              placeholder="https://www.tiktok.com/@merya.dz"
              style={inputStyle}
              onFocus={e => { e.target.style.borderColor = '#2A241F'; }}
              onBlur={e => { e.target.style.borderColor = '#e0d9d0'; }}
            />
          </div>
        </div>
      </div>

      {/* ERROR MESSAGE */}
      {errorMessage && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          backgroundColor: '#fde8e8',
          border: '1px solid #f8b4b4',
          color: '#9b1c1c',
          padding: '0.85rem 1.2rem',
          borderRadius: '10px',
          marginBottom: '1.25rem',
          fontSize: '0.85rem'
        }}>
          <AlertCircle size={18} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* SAVE BUTTON */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <button
          onClick={handleSave}
          disabled={saving || initialLoading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            backgroundColor: saved ? '#2e7d32' : '#2A241F',
            color: '#fff',
            border: 'none',
            borderRadius: '10px',
            padding: '0.85rem 2.2rem',
            fontSize: '0.9rem',
            fontWeight: '700',
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.7 : 1,
            transition: 'all 0.22s ease',
            letterSpacing: '0.04em',
            boxShadow: '0 4px 14px rgba(0,0,0,0.14)',
          }}
          onMouseEnter={e => { if (!saved && !saving) e.currentTarget.style.transform = 'translateY(-1px)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}
        >
          {saving ? <Loader2 size={17} className="animate-spin" /> : (saved ? <CheckCircle2 size={17} /> : <Save size={17} />)}
          {saving ? 'Saving to Database...' : (saved ? 'Saved to Database!' : 'Save Settings')}
        </button>

        {saved && (
          <span style={{ fontSize: '0.85rem', color: '#2e7d32', fontWeight: '600' }}>
            Database updated. Storefront reflects changes immediately!
          </span>
        )}
      </div>

    </div>
  );
}
