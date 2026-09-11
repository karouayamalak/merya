/**
 * Canonical Algerian phone number normalization.
 * Handles:
 * - 05XXXXXXXX, 06XXXXXXXX, 07XXXXXXXX (10 digits)
 * - +2135XXXXXXXX, +2136XXXXXXXX, +2137XXXXXXXX
 * - 002135XXXXXXXX, 002136XXXXXXXX, 002137XXXXXXXX
 * - 2135XXXXXXXX, 2136XXXXXXXX, 2137XXXXXXXX
 * - Spaces, dashes, dots, brackets
 * 
 * Returns canonical 10-digit format (e.g. '0555123456') or throws Error if invalid.
 */
export function normalizeAlgerianPhone(phone) {
  if (!phone || typeof phone !== 'string') {
    throw new Error('Phone number must be a valid non-empty string');
  }

  // Strip all whitespace, hyphens, dots, parentheses
  let cleaned = phone.trim().replace(/[\s\-\.\(\)]/g, '');

  // Strip international prefixes
  if (cleaned.startsWith('+213')) {
    cleaned = '0' + cleaned.slice(4);
  } else if (cleaned.startsWith('00213')) {
    cleaned = '0' + cleaned.slice(5);
  } else if (cleaned.startsWith('213') && cleaned.length >= 11) {
    cleaned = '0' + cleaned.slice(3);
  }

  // Algerian mobile and landline validation:
  // Mobile prefixes: 05, 06, 07 (10 digits total)
  // Landline prefixes: 02, 03, 04 (9-10 digits total)
  const isAlgerian = /^0[2-9]\d{7,8}$/.test(cleaned);
  if (!isAlgerian) {
    throw new Error('Invalid Algerian phone number format. Must be a valid 10-digit number starting with 0.');
  }

  return cleaned;
}
