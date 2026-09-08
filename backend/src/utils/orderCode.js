import crypto from 'crypto';

// Unambiguous character set (excluding 0, O, 1, I, L)
const CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * Generate a cryptographically secure, unpredictable order tracking code.
 * Example: MD-8K3N9P
 */
export function generateOrderCode() {
  const bytes = crypto.randomBytes(6);
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += CHARS[bytes[i] % CHARS.length];
  }
  return `MD-${result}`;
}
