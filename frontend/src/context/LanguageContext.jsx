import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  resolveTranslation
} from '../translations/index.js';
import { getLocalizedContent } from '../utils/i18nContent.js';

const STORAGE_KEY = 'merya_language';

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const getInitialLanguage = () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && SUPPORTED_LANGUAGES.some(l => l.code === stored)) {
        return stored;
      }
    } catch {
      // localStorage may be unavailable in restricted environments
    }
    return DEFAULT_LANGUAGE;
  };

  const [language, setLanguageState] = useState(getInitialLanguage);

  const setLanguage = useCallback((newLang) => {
    const valid = SUPPORTED_LANGUAGES.some(l => l.code === newLang) ? newLang : DEFAULT_LANGUAGE;
    setLanguageState(valid);
    try {
      localStorage.setItem(STORAGE_KEY, valid);
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Synchronize document dir, lang, and font class
  useEffect(() => {
    const isRtl = language === 'ar';
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
    if (isRtl) {
      document.documentElement.classList.add('rtl-mode');
      document.body.classList.add('rtl-mode');
    } else {
      document.documentElement.classList.remove('rtl-mode');
      document.body.classList.remove('rtl-mode');
    }
  }, [language]);

  const currentLangObj = useMemo(() => {
    return SUPPORTED_LANGUAGES.find(l => l.code === language) || SUPPORTED_LANGUAGES[0];
  }, [language]);

  const isRtl = currentLangObj.dir === 'rtl';

  const t = useCallback((key, params) => {
    return resolveTranslation(language, key, params);
  }, [language]);

  /**
   * `localized(field)` — extract the correct language version of dynamic DB content.
   * Falls back: selected language → French → any non-empty language.
   * Never returns undefined, null, or '[object Object]'.
   * @param {string|Object} field — e.g. product.name ({ fr, ar, en }) or a plain string
   */
  const localized = useCallback((field) => {
    return getLocalizedContent(field, language, 'fr');
  }, [language]);

  /**
   * Locale-aware monetary formatting strictly preserving authoritative DZD numbers
   */
  const formatCurrency = useCallback((amount) => {
    const num = Number(amount);
    if (!Number.isFinite(num)) return `0 ${currentLangObj.currencySuffix}`;

    if (language === 'ar') {
      // Standard Arabic Algerian Dinar format: 1 500 د.ج
      return `${num.toLocaleString('fr-DZ')} ${currentLangObj.currencySuffix}`;
    }
    if (language === 'en') {
      return `${num.toLocaleString('en-US')} ${currentLangObj.currencySuffix}`;
    }
    // French (default)
    return `${num.toLocaleString('fr-FR').replace(/\u202F/g, ' ')} ${currentLangObj.currencySuffix}`;
  }, [language, currentLangObj.currencySuffix]);

  /**
   * Locale-aware date formatting
   */
  const formatDate = useCallback((dateValue, options = { year: 'numeric', month: 'short', day: 'numeric' }) => {
    if (!dateValue) return '';
    try {
      const d = new Date(dateValue);
      if (Number.isNaN(d.getTime())) return String(dateValue);
      const locale = language === 'ar' ? 'ar-DZ' : (language === 'en' ? 'en-US' : 'fr-FR');
      return new Intl.DateTimeFormat(locale, options).format(d);
    } catch {
      return String(dateValue);
    }
  }, [language]);

  /**
   * Status label translation keeping database enums authoritative
   */
  const formatStatus = useCallback((status) => {
    if (!status) return '';
    const norm = String(status).trim().toLowerCase();
    switch (norm) {
      case 'pending':
        return t('status.pending');
      case 'confirmed':
        return t('status.confirmed');
      case 'on the way':
      case 'on_the_way':
        return t('status.onTheWay');
      case 'at agency':
      case 'at_agency':
        return t('status.atAgency');
      case 'delivered':
        return t('status.delivered');
      case 'returned':
        return t('status.returned');
      case 'cancelled':
        return t('status.cancelled');
      default:
        return status;
    }
  }, [t]);

  /**
   * Wilaya display helper showing localized Arabic/French name while code remains invariant
   */
  const getWilayaDisplayName = useCallback((wilaya) => {
    if (!wilaya) return '';
    const code = wilaya.code || wilaya.wilayaCode;
    const codeStr = String(code).padStart(2, '0');
    if (language === 'ar') {
      const arName = wilaya.nameAr || wilaya.wilayaNameAr;
      return `${codeStr} - ${arName || wilaya.name || wilaya.wilayaName || ''}`;
    }
    if (language === 'en') {
      const enName = wilaya.nameEn || wilaya.wilayaNameEn;
      return `${codeStr} - ${enName || wilaya.name || wilaya.wilayaName || ''}`;
    }
    const frName = wilaya.nameFr || wilaya.wilayaNameFr || wilaya.name || wilaya.wilayaName || '';
    return `${codeStr} - ${frName}`;
  }, [language]);

  const value = useMemo(() => ({
    language,
    setLanguage,
    t,
    localized,
    isRtl,
    dir: currentLangObj.dir,
    languages: SUPPORTED_LANGUAGES,
    currentLangObj,
    formatCurrency,
    formatDate,
    formatStatus,
    getWilayaDisplayName
  }), [
    language,
    setLanguage,
    t,
    localized,
    isRtl,
    currentLangObj,
    formatCurrency,
    formatDate,
    formatStatus,
    getWilayaDisplayName
  ]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
}
