import fr from './fr.js';
import ar from './ar.js';
import en from './en.js';

export const SUPPORTED_LANGUAGES = [
  {
    code: 'fr',
    name: 'Français',
    nativeName: 'Français',
    dir: 'ltr',
    currencySuffix: 'DA'
  },
  {
    code: 'ar',
    name: 'Arabic',
    nativeName: 'العربية',
    dir: 'rtl',
    currencySuffix: 'د.ج'
  },
  {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    dir: 'ltr',
    currencySuffix: 'DZD'
  }
];

export const DEFAULT_LANGUAGE = 'fr';

export const translations = {
  fr,
  ar,
  en
};

/**
 * Safe deep dot-notation property getter
 */
function getNestedValue(obj, path) {
  if (!obj || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

/**
 * Resolves a translation key with safe fallback to French, and parameter interpolation.
 */
export function resolveTranslation(lang, key, params = {}) {
  const currentDict = translations[lang] || translations[DEFAULT_LANGUAGE];
  const fallbackDict = translations[DEFAULT_LANGUAGE];

  let raw = getNestedValue(currentDict, key);
  if (raw === undefined || raw === null) {
    raw = getNestedValue(fallbackDict, key);
  }

  // If still missing, return the key safely instead of crashing or showing undefined
  if (raw === undefined || raw === null) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[i18n] Missing translation for key: "${key}" in language: "${lang}"`);
    }
    return key;
  }

  if (typeof raw !== 'string') {
    return raw;
  }

  // Interpolate {param} placeholders
  if (params && typeof params === 'object') {
    return raw.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? params[k] : `{${k}}`));
  }

  return raw;
}
