import React, { useState, useEffect } from 'react';
import { Settings, Building2, Home as HomeIcon, CheckCircle2, AlertCircle, Loader2, Search, Sliders } from 'lucide-react';
import { fetchDeliverySettings, adminUpdateDeliverySettings } from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';

export default function DeliverySettingsManager() {
  const { t, isRtl } = useLanguage();
  const [agencyFee, setAgencyFee] = useState(0);
  const [homeFee, setHomeFee] = useState(0);
  const [freeThreshold, setFreeThreshold] = useState(0);
  const [wilayaRates, setWilayaRates] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Bulk update tool
  const [bulkHome, setBulkHome] = useState('');
  const [bulkAgency, setBulkAgency] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetchDeliverySettings();
        if (res.success && res.settings) {
          setAgencyFee(res.settings.agencyDeliveryFee ?? 0);
          setHomeFee(res.settings.homeDeliveryFee ?? 0);
          setFreeThreshold(res.settings.freeDeliveryThreshold ?? 0);
          setWilayaRates(res.settings.wilayaRates || res.wilayas || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleWilayaPriceChange = (code, field, value) => {
    const num = Math.max(0, parseInt(value, 10) || 0);
    setWilayaRates(prev => prev.map(w => {
      if (w.wilayaCode === code) {
        return { ...w, [field]: num };
      }
      return w;
    }));
  };

  const handleApplyBulk = () => {
    if (!bulkHome && !bulkAgency) return;
    const h = bulkHome ? parseInt(bulkHome, 10) : null;
    const a = bulkAgency ? parseInt(bulkAgency, 10) : null;

    setWilayaRates(prev => prev.map(w => ({
      ...w,
      homeFee: h !== null ? h : w.homeFee,
      agencyFee: a !== null ? a : w.agencyFee
    })));

    setMessage(t('admin.delivery.settingsSaved'));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setMessage('');
    setError('');
    setSaving(true);

    try {
      const res = await adminUpdateDeliverySettings({
        agencyDeliveryFee: Number(agencyFee),
        homeDeliveryFee: Number(homeFee),
        freeDeliveryThreshold: Number(freeThreshold),
        wilayaRates: wilayaRates
      });

      if (res.success) {
        setMessage(t('admin.delivery.settingsSaved'));
        if (res.settings && res.settings.wilayaRates) {
          setWilayaRates(res.settings.wilayaRates);
        }
      }
    } catch (err) {
      setError(err.message || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const filteredWilayas = wilayaRates.filter(w => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      String(w.wilayaCode).includes(q) ||
      (w.wilayaName && w.wilayaName.toLowerCase().includes(q)) ||
      (w.wilayaNameAr && w.wilayaNameAr.includes(q))
    );
  });

  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto' }} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1000px' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 className="heading-display" style={{ fontSize: '1.8rem', color: 'var(--color-espresso)' }}>
          {t('admin.delivery.title').toUpperCase()}
        </h1>
        <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.2rem' }}>
          {t('checkout.subtitle')}
        </p>
      </div>

      {message && (
        <div style={{
          backgroundColor: '#E8F5E9',
          color: 'var(--color-success)',
          padding: '1rem 1.25rem',
          borderRadius: 'var(--radius-md)',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          fontSize: '0.88rem'
        }}>
          <CheckCircle2 size={18} />
          <span>{message}</span>
        </div>
      )}

      {error && (
        <div style={{
          backgroundColor: '#FFEBEE',
          color: 'var(--color-danger)',
          padding: '1rem 1.25rem',
          borderRadius: 'var(--radius-md)',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          fontSize: '0.88rem'
        }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSave}>
        {/* Bulk Pricing Quick Tool */}
        <div style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl)',
          padding: '1.5rem',
          border: '1px solid var(--color-border)',
          marginBottom: '2rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1.25rem',
          alignItems: 'flex-end',
          justifyContent: 'space-between'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: '700', fontSize: '0.9rem', color: 'var(--color-espresso)' }}>
              <Sliders size={16} />
              <span>{t('admin.delivery.saveSettings')}</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#666', marginTop: '0.2rem' }}>
              {t('admin.delivery.freeDeliveryThresholdHelp')}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: '#555' }}>{t('admin.delivery.homeFee')}</label>
              <input
                type="number"
                placeholder="800"
                value={bulkHome}
                onChange={e => setBulkHome(e.target.value)}
                style={{ width: '110px', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--color-border)', fontSize: '0.85rem' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: '#555' }}>{t('admin.delivery.agencyFee')}</label>
              <input
                type="number"
                placeholder="500"
                value={bulkAgency}
                onChange={e => setBulkAgency(e.target.value)}
                style={{ width: '110px', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--color-border)', fontSize: '0.85rem' }}
              />
            </div>
            <button
              type="button"
              onClick={handleApplyBulk}
              className="btn btn-secondary btn-sm"
              style={{ height: '36px', alignSelf: 'flex-end' }}
            >
              {t('common.confirm')}
            </button>
          </div>
        </div>

        {/* 58 Wilayas Pricing Table */}
        <div style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-sm)',
          marginBottom: '2rem'
        }}>
          <div style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem'
          }}>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--color-espresso)' }}>
                {t('admin.delivery.title')} ({filteredWilayas.length} / {wilayaRates.length})
              </h2>
            </div>

            {/* Search Filter */}
            <div style={{ position: 'relative', width: '280px' }}>
              <Search size={15} style={{ position: 'absolute', [isRtl ? 'right' : 'left']: '12px', top: '50%', transform: 'translateY(-50%)', color: '#888' }} />
              <input
                type="text"
                placeholder={t('common.searchPlaceholder')}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: isRtl ? '0.5rem 2.25rem 0.5rem 1rem' : '0.5rem 1rem 0.5rem 2.25rem',
                  borderRadius: 'var(--radius-full)',
                  border: '1px solid var(--color-border)',
                  fontSize: '0.85rem'
                }}
              />
            </div>
          </div>

          <div style={{ overflowX: 'auto', maxHeight: '550px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: isRtl ? 'right' : 'left' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, zIndex: 5 }}>
                  <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', width: '80px' }}>{t('admin.delivery.wilayaCode')}</th>
                  <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('admin.delivery.wilayaName')}</th>
                  <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', width: '200px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <HomeIcon size={14} color="var(--color-primary-dark)" />
                      <span>{t('admin.delivery.homeFee')}</span>
                    </div>
                  </th>
                  <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', width: '200px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Building2 size={14} color="var(--color-primary-dark)" />
                      <span>{t('admin.delivery.agencyFee')}</span>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredWilayas.map((w) => (
                  <tr key={w.wilayaCode} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '0.85rem 1.25rem', fontWeight: '700', color: 'var(--color-espresso)' }}>
                      {String(w.wilayaCode).padStart(2, '0')}
                    </td>
                    <td style={{ padding: '0.85rem 1.25rem' }}>
                      <div style={{ fontWeight: '700', fontSize: '0.9rem', color: 'var(--color-espresso)' }}>
                        {isRtl && w.wilayaNameAr ? w.wilayaNameAr : w.wilayaName}
                      </div>
                      {w.wilayaNameAr && (
                        <div style={{ fontSize: '0.78rem', color: '#888' }}>
                          {isRtl ? w.wilayaName : w.wilayaNameAr}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '0.85rem 1.25rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <input
                          type="number"
                          min="0"
                          value={w.homeFee}
                          onChange={(e) => handleWilayaPriceChange(w.wilayaCode, 'homeFee', e.target.value)}
                          style={{
                            width: '120px',
                            padding: '0.45rem 0.65rem',
                            borderRadius: '6px',
                            border: '1px solid var(--color-border)',
                            fontWeight: '700',
                            fontSize: '0.95rem'
                          }}
                        />
                        <span style={{ fontSize: '0.8rem', color: '#666', fontWeight: '600' }}>{t('common.dzd')}</span>
                      </div>
                    </td>
                    <td style={{ padding: '0.85rem 1.25rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <input
                          type="number"
                          min="0"
                          value={w.agencyFee}
                          onChange={(e) => handleWilayaPriceChange(w.wilayaCode, 'agencyFee', e.target.value)}
                          style={{
                            width: '120px',
                            padding: '0.45rem 0.65rem',
                            borderRadius: '6px',
                            border: '1px solid var(--color-border)',
                            fontWeight: '700',
                            fontSize: '0.95rem'
                          }}
                        />
                        <span style={{ fontSize: '0.8rem', color: '#666', fontWeight: '600' }}>{t('common.dzd')}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Global Save Button */}
        <div style={{
          position: 'sticky',
          bottom: '1rem',
          backgroundColor: 'var(--color-surface)',
          padding: '1.25rem 2rem',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 10
        }}>
          <div>
            <div style={{ fontWeight: '700', fontSize: '0.9rem', color: 'var(--color-espresso)' }}>
              {t('admin.delivery.saveSettings')}
            </div>
            <div style={{ fontSize: '0.78rem', color: '#666' }}>
              {t('admin.delivery.freeDeliveryThresholdHelp')}
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary"
            style={{ padding: '0.9rem 2.25rem' }}
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : null}
            <span>{t('common.save')}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
