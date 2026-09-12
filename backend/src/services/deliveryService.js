import { DeliverySetting } from '../models/DeliverySetting.js';
import { DELIVERY_METHODS, ALGERIA_WILAYAS } from '../config/constants.js';

export const MAX_ITEM_QUANTITY = 20;

/**
 * Validates a cart line item's quantity and required variant coordinates.
 * Enforces:
 * - productId present non-empty string
 * - colorName present non-empty string
 * - size present non-empty string
 * - quantity present, number, safe integer, >= 1 and <= MAX_ITEM_QUANTITY (20)
 * Rejects fractional quantities (e.g. 1.5), NaN, strings, negative numbers, or quantities > 20.
 */
export function validateCartItem(item, index = 0, { maxQuantity = null } = {}) {
  const lineLabel = `Article #${index + 1}`;
  if (!item || typeof item !== 'object') {
    return { valid: false, issue: `${lineLabel} : données invalides.` };
  }

  const { productId, colorName, size, quantity } = item;

  if (!productId || (typeof productId !== 'string' && typeof productId !== 'object')) {
    return { valid: false, issue: `${lineLabel} : identifiant produit requis.` };
  }

  if (!colorName || typeof colorName !== 'string' || !colorName.trim()) {
    return { valid: false, issue: `${lineLabel} : couleur requise.` };
  }

  if (!size || typeof size !== 'string' || !size.trim()) {
    return { valid: false, issue: `${lineLabel} : taille requise.` };
  }

  if (
    typeof quantity !== 'number' ||
    !Number.isFinite(quantity) ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1
  ) {
    return {
      valid: false,
      issue: `${lineLabel} : quantité invalide (doit être un entier supérieur ou égal à 1).`
    };
  }

  if (maxQuantity !== null && quantity > maxQuantity) {
    return {
      valid: false,
      issue: `${lineLabel} : quantité maximale dépassée (${quantity} > ${maxQuantity}).`
    };
  }

  return { valid: true };
}

/**
 * Authoritative Delivery Resolution Helper.
 * Shared by both POST /orders/quote and final checkout (orderService.js).
 *
 * Strict Business Rules:
 * 1. Canonical Wilaya: code must be an integer between 1 and 58 matching ALGERIA_WILAYAS.
 * 2. Delivery Method: must be strictly 'agency' or 'home'.
 * 3. Delivery Setting: must exist in database with valid rates.
 * 4. Wilaya Availability: Wilaya must exist in delivery setting and isAvailable !== false.
 * 5. Method Fee: Rate for the selected method must be a valid non-negative integer.
 * 6. Free Delivery Threshold: if subtotal >= threshold (and threshold > 0), fee is 0 DZD.
 */
export async function resolveAuthoritativeDelivery({
  wilayaCode,
  deliveryMethod,
  subtotal = 0,
  deliverySetting = null,
  throwOnError = true
}) {
  const fail = (message, { code = 'DELIVERY_VALIDATION_FAILED', statusCode = 400 } = {}) => {
    const err = new Error(message);
    err.code = code;
    err.statusCode = statusCode;
    if (throwOnError) {
      throw err;
    }
    return { success: false, error: message, code, statusCode };
  };

  // 1. Wilaya Code Validation
  if (wilayaCode === undefined || wilayaCode === null || wilayaCode === '') {
    return fail('Customer Wilaya is required.', { code: 'WILAYA_REQUIRED' });
  }

  const codeNum = Number(wilayaCode);
  if (!Number.isInteger(codeNum) || codeNum < 1 || codeNum > 58) {
    return fail(`Invalid Wilaya code: ${wilayaCode}. Must be between 1 and 58.`, {
      code: 'INVALID_WILAYA_CODE'
    });
  }

  const canonicalWilaya = ALGERIA_WILAYAS.find(w => w.code === codeNum);
  if (!canonicalWilaya) {
    return fail(`Invalid Wilaya code: ${codeNum}. Must be between 1 and 58.`, {
      code: 'INVALID_WILAYA_CODE'
    });
  }

  // 2. Delivery Method Validation
  if (!deliveryMethod) {
    return fail('Delivery method is required (agency or home) / Mode de livraison requis.', {
      code: 'DELIVERY_METHOD_REQUIRED'
    });
  }

  const normMethod = String(deliveryMethod).toLowerCase().trim();
  if (normMethod !== DELIVERY_METHODS.AGENCY && normMethod !== DELIVERY_METHODS.HOME) {
    return fail(`Invalid delivery method "${deliveryMethod}". Mode de livraison invalide (doit être "agency" ou "home").`, {
      code: 'INVALID_DELIVERY_METHOD'
    });
  }

  // 3. Authoritative Delivery Setting lookup & verification
  let setting = deliverySetting;
  if (!setting) {
    setting = await DeliverySetting.findOne();
  }

  if (!setting || !Array.isArray(setting.wilayaRates) || setting.wilayaRates.length === 0) {
    return fail('Delivery configuration is not initialized. Please configure delivery settings before placing orders.', {
      code: 'DELIVERY_CONFIGURATION_MISSING',
      statusCode: 400
    });
  }

  // 4. Wilaya Rate & Availability check
  const wilayaRate = setting.wilayaRates.find(r => r.wilayaCode === codeNum);
  if (!wilayaRate) {
    return fail(`Delivery configuration missing for Wilaya ${codeNum} (${canonicalWilaya.name})`, {
      code: 'DELIVERY_CONFIGURATION_MISSING'
    });
  }

  if (wilayaRate.isAvailable === false) {
    return fail(`Wilaya ${codeNum} (${canonicalWilaya.name}) is currently unavailable for delivery.`, {
      code: 'WILAYA_UNAVAILABLE'
    });
  }

  // 5. Method Fee Validation
  const rawFee = normMethod === DELIVERY_METHODS.AGENCY ? wilayaRate.agencyFee : wilayaRate.homeFee;
  if (typeof rawFee !== 'number' || !Number.isInteger(rawFee) || rawFee < 0) {
    return fail(
      `Authoritative delivery fee is not configured for Wilaya ${codeNum} (${canonicalWilaya.name}) with method "${normMethod}".`,
      { code: 'DELIVERY_FEE_NOT_CONFIGURED' }
    );
  }

  // 6. Free Delivery Threshold calculation
  const threshold = (typeof setting.freeDeliveryThreshold === 'number' && Number.isFinite(setting.freeDeliveryThreshold) && setting.freeDeliveryThreshold > 0)
    ? setting.freeDeliveryThreshold
    : 0;

  const isFreeDelivery = threshold > 0 && typeof subtotal === 'number' && subtotal >= threshold;
  const deliveryFee = isFreeDelivery ? 0 : rawFee;
  const totalPrice = typeof subtotal === 'number' ? subtotal + deliveryFee : null;

  return {
    success: true,
    canonicalWilaya,
    wilayaRate,
    deliveryMethod: normMethod,
    rawFee,
    deliveryFee,
    isFreeDelivery,
    freeDeliveryThreshold: threshold,
    totalPrice
  };
}
