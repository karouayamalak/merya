import { DeliverySetting } from '../models/DeliverySetting.js';
import { DELIVERY_METHODS, ALGERIA_WILAYAS } from '../config/constants.js';

export const MAX_ITEM_QUANTITY = 20;

/**
 * Strict Wilaya Code Parser & Validator.
 * Enforces canonical Algerian Wilayas 1–58.
 * Rejects malformed representations such as:
 * - '1.0' (decimal string)
 * - '01' (leading zero string)
 * - '1e0' (scientific notation)
 * - 1.5, NaN, negative numbers, floats, or numbers outside 1..58
 */
export function parseAuthoritativeWilayaCode(wilayaCode) {
  if (wilayaCode === undefined || wilayaCode === null || wilayaCode === '') {
    return { valid: false, error: 'Customer Wilaya is required.', code: 'WILAYA_REQUIRED' };
  }

  // If number: must be finite safe integer between 1 and 58
  if (typeof wilayaCode === 'number') {
    if (!Number.isFinite(wilayaCode) || !Number.isInteger(wilayaCode) || wilayaCode < 1 || wilayaCode > 58) {
      return {
        valid: false,
        error: `Invalid Wilaya code: ${wilayaCode}. Must be an integer between 1 and 58.`,
        code: 'INVALID_WILAYA_CODE'
      };
    }
    return { valid: true, codeNum: wilayaCode };
  }

  // If string: must strictly match canonical decimal integer representation (1-58 without decimals, leading zeros, or exponent)
  if (typeof wilayaCode === 'string') {
    const trimmed = wilayaCode.trim();
    if (!/^(?:[1-9]|[1-4][0-9]|5[0-8])$/.test(trimmed)) {
      return {
        valid: false,
        error: `Invalid Wilaya code: ${wilayaCode}. Must be an integer between 1 and 58.`,
        code: 'INVALID_WILAYA_CODE'
      };
    }
    return { valid: true, codeNum: parseInt(trimmed, 10) };
  }

  return {
    valid: false,
    error: `Invalid Wilaya code: ${wilayaCode}. Must be an integer between 1 and 58.`,
    code: 'INVALID_WILAYA_CODE'
  };
}

/**
 * Strict Authoritative Delivery Configuration Validator.
 * Self-validating rules:
 * - exactly 58 wilayaRates
 * - codes 1 through 58 each exist exactly once
 * - every code is an integer 1–58
 * - every Wilaya matches the canonical ALGERIA_WILAYAS entry
 * - agencyFee is a non-negative integer
 * - homeFee is a non-negative integer
 * - isAvailable is a boolean
 * - no duplicate Wilaya codes
 * - no missing Wilaya codes
 * - freeDeliveryThreshold (if present) is a finite non-negative integer
 */
export function validateAuthoritativeDeliverySetting(setting) {
  if (!setting || typeof setting !== 'object') {
    return {
      valid: false,
      error: 'Delivery configuration is not initialized. Please configure delivery settings before placing orders.',
      code: 'DELIVERY_CONFIGURATION_MISSING',
      statusCode: 400
    };
  }

  if (!Array.isArray(setting.wilayaRates) || setting.wilayaRates.length !== 58) {
    return {
      valid: false,
      error: `Delivery configuration missing or incomplete: expected exactly 58 Algerian Wilayas, but found ${Array.isArray(setting.wilayaRates) ? setting.wilayaRates.length : 0}.`,
      code: 'DELIVERY_CONFIGURATION_MISSING',
      statusCode: 400
    };
  }

  const canonicalByCode = new Map(ALGERIA_WILAYAS.map(w => [w.code, w]));
  const seenCodes = new Set();

  for (let i = 0; i < setting.wilayaRates.length; i++) {
    const r = setting.wilayaRates[i];
    if (!r || typeof r !== 'object') {
      return {
        valid: false,
        error: `Delivery configuration corrupted: invalid entry at index ${i}.`,
        code: 'DELIVERY_CONFIGURATION_INVALID',
        statusCode: 400
      };
    }

    const code = r.wilayaCode;
    if (typeof code !== 'number' || !Number.isInteger(code) || code < 1 || code > 58) {
      return {
        valid: false,
        error: `Delivery configuration corrupted: invalid wilayaCode ${code} (expected integer 1–58).`,
        code: 'DELIVERY_CONFIGURATION_INVALID',
        statusCode: 400
      };
    }

    if (seenCodes.has(code)) {
      return {
        valid: false,
        error: `Delivery configuration corrupted: duplicate wilayaCode ${code}. Each Wilaya must be unique.`,
        code: 'DELIVERY_CONFIGURATION_INVALID',
        statusCode: 400
      };
    }
    seenCodes.add(code);

    const canonical = canonicalByCode.get(code);
    if (!canonical) {
      return {
        valid: false,
        error: `Delivery configuration corrupted: unknown Wilaya code ${code}.`,
        code: 'DELIVERY_CONFIGURATION_INVALID',
        statusCode: 400
      };
    }

    const rawName = typeof r.wilayaName === 'string' ? r.wilayaName.trim() : '';
    const nameMatches = rawName === canonical.name || (code === 16 && (rawName.toLowerCase() === 'alger' || rawName.toLowerCase() === 'algiers'));
    if (!nameMatches) {
      return {
        valid: false,
        error: `Delivery configuration corrupted: Wilaya ${code} name "${rawName}" does not match canonical name "${canonical.name}".`,
        code: 'DELIVERY_CONFIGURATION_INVALID',
        statusCode: 400
      };
    }

    if (
      typeof r.homeFee !== 'number' ||
      !Number.isFinite(r.homeFee) ||
      !Number.isInteger(r.homeFee) ||
      r.homeFee < 0
    ) {
      return {
        valid: false,
        error: `Delivery configuration corrupted: homeFee for Wilaya ${code} must be a non-negative integer.`,
        code: 'DELIVERY_CONFIGURATION_INVALID',
        statusCode: 400
      };
    }

    if (
      typeof r.agencyFee !== 'number' ||
      !Number.isFinite(r.agencyFee) ||
      !Number.isInteger(r.agencyFee) ||
      r.agencyFee < 0
    ) {
      return {
        valid: false,
        error: `Delivery configuration corrupted: agencyFee for Wilaya ${code} must be a non-negative integer.`,
        code: 'DELIVERY_CONFIGURATION_INVALID',
        statusCode: 400
      };
    }

    if (typeof r.isAvailable !== 'boolean') {
      return {
        valid: false,
        error: `Delivery configuration corrupted: isAvailable for Wilaya ${code} must be a boolean.`,
        code: 'DELIVERY_CONFIGURATION_INVALID',
        statusCode: 400
      };
    }
  }

  // Ensure codes 1 through 58 each exist exactly once
  for (let c = 1; c <= 58; c++) {
    if (!seenCodes.has(c)) {
      return {
        valid: false,
        error: `Delivery configuration missing or incomplete: missing Wilaya code ${c}.`,
        code: 'DELIVERY_CONFIGURATION_MISSING',
        statusCode: 400
      };
    }
  }

  // Strict freeDeliveryThreshold validation
  if (setting.freeDeliveryThreshold !== undefined && setting.freeDeliveryThreshold !== null) {
    const thresh = setting.freeDeliveryThreshold;
    if (typeof thresh !== 'number' || !Number.isFinite(thresh) || !Number.isInteger(thresh) || thresh < 0) {
      return {
        valid: false,
        error: 'Delivery configuration corrupted: freeDeliveryThreshold must be a finite non-negative integer in DZD.',
        code: 'DELIVERY_CONFIGURATION_INVALID',
        statusCode: 400
      };
    }
  }

  return { valid: true };
}

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
 * 3. Delivery Setting: must exist in database with a complete and valid 58-Wilaya configuration.
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

  // 1. Wilaya Code Validation using parseAuthoritativeWilayaCode
  const parsedCode = parseAuthoritativeWilayaCode(wilayaCode);
  if (!parsedCode.valid) {
    return fail(parsedCode.error, { code: parsedCode.code });
  }
  const codeNum = parsedCode.codeNum;

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

  // 3. Authoritative Delivery Setting lookup & self-verification
  let setting = deliverySetting;
  if (!setting) {
    setting = await DeliverySetting.findOne();
  }

  const settingValidation = validateAuthoritativeDeliverySetting(setting);
  if (!settingValidation.valid) {
    return fail(settingValidation.error, {
      code: settingValidation.code,
      statusCode: settingValidation.statusCode
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
