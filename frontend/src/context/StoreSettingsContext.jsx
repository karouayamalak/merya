import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { fetchStoreSettings, adminUpdateStoreSettings } from '../services/api';

const DEFAULT_SETTINGS = {
  logoVariant: 'white',
  deliveryNoticeDays: 3,
  socialLinks: {
    facebook: '',
    instagram: '',
    tiktok: ''
  }
};

const StoreSettingsContext = createContext({
  settings: DEFAULT_SETTINGS,
  loading: false,
  error: null,
  updateSettings: async () => {},
  refreshSettings: async () => {}
});

export function StoreSettingsProvider({ children }) {
  // Start with localStorage cache if available for instant paint, then revalidate from database
  const [settings, setSettings] = useState(() => {
    try {
      const cached = localStorage.getItem('merya_store_settings_cache');
      if (cached) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(cached) };
      }
      // Also check legacy keys if present
      const legacyVariant = localStorage.getItem('merya_logo_variant');
      const legacySocial = localStorage.getItem('merya_social_links');
      if (legacyVariant || legacySocial) {
        return {
          ...DEFAULT_SETTINGS,
          logoVariant: legacyVariant || 'white',
          socialLinks: legacySocial ? { ...DEFAULT_SETTINGS.socialLinks, ...JSON.parse(legacySocial) } : DEFAULT_SETTINGS.socialLinks
        };
      }
    } catch {}
    return DEFAULT_SETTINGS;
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refreshSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchStoreSettings();
      if (res && res.success && res.settings) {
        const fresh = {
          logoVariant: res.settings.logoVariant || 'white',
          deliveryNoticeDays: res.settings.deliveryNoticeDays ?? 3,
          socialLinks: {
            facebook: res.settings.socialLinks?.facebook || '',
            instagram: res.settings.socialLinks?.instagram || '',
            tiktok: res.settings.socialLinks?.tiktok || ''
          }
        };
        setSettings(fresh);
        try {
          localStorage.setItem('merya_store_settings_cache', JSON.stringify(fresh));
          // Keep legacy keys updated for backwards compatibility
          localStorage.setItem('merya_logo_variant', fresh.logoVariant);
          localStorage.setItem('merya_social_links', JSON.stringify(fresh.socialLinks));
        } catch {}
      }
    } catch (err) {
      console.warn('[StoreSettings] Failed to fetch settings from server, using cached settings:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  const updateSettings = useCallback(async (newSettings) => {
    const res = await adminUpdateStoreSettings(newSettings);
    if (res && res.success && res.settings) {
      const updated = {
        logoVariant: res.settings.logoVariant || 'white',
        deliveryNoticeDays: res.settings.deliveryNoticeDays ?? 3,
        socialLinks: {
          facebook: res.settings.socialLinks?.facebook || '',
          instagram: res.settings.socialLinks?.instagram || '',
          tiktok: res.settings.socialLinks?.tiktok || ''
        }
      };
      setSettings(updated);
      try {
        localStorage.setItem('merya_store_settings_cache', JSON.stringify(updated));
        localStorage.setItem('merya_logo_variant', updated.logoVariant);
        localStorage.setItem('merya_social_links', JSON.stringify(updated.socialLinks));
        window.dispatchEvent(new Event('merya_logo_variant_changed'));
      } catch {}
      return res;
    }
    throw new Error(res?.message || 'Failed to update store settings');
  }, []);

  return (
    <StoreSettingsContext.Provider value={{ settings, loading, error, updateSettings, refreshSettings }}>
      {children}
    </StoreSettingsContext.Provider>
  );
}

export function useStoreSettings() {
  return useContext(StoreSettingsContext);
}
