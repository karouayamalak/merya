/**
 * Utility to extract localized content safely with fallback.
 * Order of fallback:
 * 1. Selected language (e.g. 'ar', 'en')
 * 2. Default language ('fr')
 * 3. Any available non-empty language ('en', 'ar')
 * 4. Safe fallback string or empty string (never returns undefined, null, or [object Object])
 */
export function getLocalizedContent(field, lang = 'fr', fallback = 'fr') {
  if (field === null || field === undefined) {
    return '';
  }

  // If already a plain string, return it trimmed
  if (typeof field === 'string') {
    return field;
  }

  if (typeof field === 'number' || typeof field === 'boolean') {
    return String(field);
  }

  if (typeof field === 'object') {
    // Check target language
    const currentVal = field[lang];
    if (typeof currentVal === 'string' && currentVal.trim().length > 0) {
      return currentVal;
    }

    // Check default fallback (French)
    const fallbackVal = field[fallback];
    if (typeof fallbackVal === 'string' && fallbackVal.trim().length > 0) {
      return fallbackVal;
    }

    // Fall back to any non-empty string in the object
    for (const key of ['fr', 'en', 'ar']) {
      if (typeof field[key] === 'string' && field[key].trim().length > 0) {
        return field[key];
      }
    }
  }

  return '';
}

/**
 * Checks translation status for a localized field
 * @param {Object|string} field
 * @returns {{ fr: boolean, ar: boolean, en: boolean, isComplete: boolean, missing: string[] }}
 */
export function checkFieldCompleteness(field) {
  if (!field) {
    return { fr: false, ar: false, en: false, isComplete: false, missing: ['fr', 'ar', 'en'] };
  }
  if (typeof field === 'string') {
    const hasStr = field.trim().length > 0;
    return {
      fr: hasStr,
      ar: false,
      en: false,
      isComplete: false,
      missing: ['ar', 'en']
    };
  }

  const hasFr = Boolean(field.fr && field.fr.trim().length > 0);
  const hasAr = Boolean(field.ar && field.ar.trim().length > 0);
  const hasEn = Boolean(field.en && field.en.trim().length > 0);

  const missing = [];
  if (!hasFr) missing.push('fr');
  if (!hasAr) missing.push('ar');
  if (!hasEn) missing.push('en');

  return {
    fr: hasFr,
    ar: hasAr,
    en: hasEn,
    isComplete: hasFr && hasAr && hasEn,
    missing
  };
}
