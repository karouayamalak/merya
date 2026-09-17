import crypto from 'crypto';
import { normalizeAlgerianPhone } from '../../utils/phone.js';

/**
 * Deterministic fingerprint of order payload for strict idempotency checking.
 * Covers ALL fields that materially define the order so that the same
 * idempotency key + different payload → HTTP 409 conflict.
 */
export function computeOrderFingerprint({ customer, items }) {
  let normPhone = '';
  try {
    normPhone = normalizeAlgerianPhone(String(customer?.phone || ''));
  } catch {
    normPhone = String(customer?.phone || '').trim();
  }

  const wilayaCode = Number(
    typeof customer?.wilaya === 'object' ? customer?.wilaya?.code : customer?.wilaya
  );
  const deliveryMethod = String(customer?.deliveryMethod || '').trim().toLowerCase();
  const fullName = String(customer?.fullName || '').trim().toLowerCase();
  const address = String(customer?.address || '').trim().toLowerCase();
  const agencyName = String(customer?.agencyName || '').trim().toLowerCase();
  const notes = String(customer?.notes || '').trim().toLowerCase();

  const sortedItems = (items || []).map(i => ({
    productId: String(i.productId),
    colorName: String(i.colorName || '').trim().toLowerCase(),
    size: String(i.size || '').trim(),
    quantity: Number(i.quantity)
  })).sort((a, b) => {
    const keyA = `${a.productId}-${a.colorName}-${a.size}`;
    const keyB = `${b.productId}-${b.colorName}-${b.size}`;
    return keyA.localeCompare(keyB);
  });

  const payload = {
    phone: normPhone,
    fullName,
    wilayaCode,
    deliveryMethod,
    address,
    agencyName,
    notes,
    items: sortedItems
  };

  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
