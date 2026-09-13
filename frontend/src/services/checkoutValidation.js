import { quoteOrder } from './api.js';

/**
 * Strictly validates the server's 58-Wilaya delivery configuration.
 * - Exactly 58 Wilayas required (canonical codes 1–58).
 * - Delivery fees MUST be actual non-negative integer numbers (typeof === 'number', isFinite, isInteger, >= 0).
 * - No coercion (e.g. Number("800")) allowed.
 */
export function validateDeliverySettingsResponse(data) {
  if (!data || !data.success) {
    return { valid: false, error: data?.message || 'Impossible de récupérer les paramètres de livraison du serveur.' };
  }

  const rawWilayas = data.wilayas || data.settings?.wilayaRates;
  if (!Array.isArray(rawWilayas)) {
    return { valid: false, error: 'Format de réponse invalide : liste des wilayas manquante.' };
  }

  if (rawWilayas.length !== 58) {
    return {
      valid: false,
      error: `Configuration des tarifs invalide : exactement 58 wilayas requises (${rawWilayas.length} reçues).`
    };
  }

  const seenCodes = new Set();
  const validatedWilayas = [];

  for (let i = 0; i < rawWilayas.length; i++) {
    const w = rawWilayas[i];
    if (!w || typeof w !== 'object') {
      return { valid: false, error: `Données de wilaya invalides à l'index ${i}.` };
    }

    const rawCode = w.wilayaCode !== undefined ? w.wilayaCode : w.code;
    if (typeof rawCode !== 'number' || !Number.isInteger(rawCode) || rawCode < 1 || rawCode > 58) {
      return { valid: false, error: `Code de wilaya invalide : ${rawCode} (attendu : entier entre 1 et 58).` };
    }
    const code = rawCode;

    if (seenCodes.has(code)) {
      return { valid: false, error: `Code de wilaya dupliqué : ${code}. Chaque wilaya doit être unique.` };
    }
    seenCodes.add(code);

    const name = String(w.wilayaName || w.name || '').trim();
    if (!name) {
      return { valid: false, error: `Nom canonique manquant pour la wilaya ${code}.` };
    }

    if (typeof w.homeFee !== 'number' || !Number.isFinite(w.homeFee) || !Number.isInteger(w.homeFee) || w.homeFee < 0) {
      return { valid: false, error: `Tarif de livraison à domicile invalide pour la wilaya ${code} (${name}).` };
    }
    const homeFee = w.homeFee;

    if (typeof w.agencyFee !== 'number' || !Number.isFinite(w.agencyFee) || !Number.isInteger(w.agencyFee) || w.agencyFee < 0) {
      return { valid: false, error: `Tarif de livraison en bureau / stopdesk invalide pour la wilaya ${code} (${name}).` };
    }
    const agencyFee = w.agencyFee;

    validatedWilayas.push({
      code,
      wilayaCode: code,
      name,
      wilayaName: name,
      nameAr: String(w.wilayaNameAr || w.nameAr || '').trim(),
      wilayaNameAr: String(w.wilayaNameAr || w.nameAr || '').trim(),
      nameEn: String(w.wilayaNameEn || w.nameEn || '').trim(),
      wilayaNameEn: String(w.wilayaNameEn || w.nameEn || '').trim(),
      homeFee,
      agencyFee,
      isAvailable: w.isAvailable !== false
    });
  }

  // Ensure all codes 1–58 are present
  for (let c = 1; c <= 58; c++) {
    if (!seenCodes.has(c)) {
      return { valid: false, error: `Wilaya manquante : code ${c} absent de la configuration.` };
    }
  }

  validatedWilayas.sort((a, b) => a.code - b.code);

  const rawSettings = data.settings || {};
  const validatedSettings = {
    agencyDeliveryFee: typeof rawSettings.agencyDeliveryFee === 'number' ? rawSettings.agencyDeliveryFee : 500,
    homeDeliveryFee: typeof rawSettings.homeDeliveryFee === 'number' ? rawSettings.homeDeliveryFee : 800,
    freeDeliveryThreshold: (typeof rawSettings.freeDeliveryThreshold === 'number' && Number.isFinite(rawSettings.freeDeliveryThreshold) && rawSettings.freeDeliveryThreshold >= 0)
      ? rawSettings.freeDeliveryThreshold
      : 0,
    wilayaRates: Array.isArray(rawSettings.wilayaRates) ? rawSettings.wilayaRates : []
  };

  return {
    valid: true,
    wilayas: validatedWilayas,
    settings: validatedSettings
  };
}

/**
 * Authoritative business rule for delivery fee (mirrors backend orderService.js exactly):
 * - if threshold is disabled (0, null, undefined, <= 0), use normal delivery fee
 * - if subtotal is below threshold, use selected Wilaya's delivery fee
 * - if subtotal reaches/exceeds threshold, delivery fee is 0
 */
export function calculateDeliveryFee({ subtotal, rawDeliveryFee, freeDeliveryThreshold }) {
  if (typeof rawDeliveryFee !== 'number' || !Number.isFinite(rawDeliveryFee) || rawDeliveryFee < 0) {
    return null;
  }
  const threshold = (typeof freeDeliveryThreshold === 'number' && Number.isFinite(freeDeliveryThreshold) && freeDeliveryThreshold > 0)
    ? freeDeliveryThreshold
    : 0;

  if (threshold > 0 && typeof subtotal === 'number' && subtotal >= threshold) {
    return 0;
  }
  return rawDeliveryFee;
}

/**
 * Server-Authoritative Cart Validation:
 * - Uses ONLY the server-authoritative quote endpoint POST /orders/quote
 * - Sends only productId, colorName, size, quantity, and optional wilayaCode/deliveryMethod
 * - NEVER sends client-calculated prices, fees, or subtotals
 * - Trusts only server quote for availability, stock, and live prices
 * - FAILS CLOSED on any error, 500, network failure, or malformed data
 * - NO full-catalog or /products fallback
 */
export async function revalidateCartWithServer(
  cartItems,
  optionsOrQuoteFn = {},
  customQuoteOrder = quoteOrder
) {
  let options = {};
  let quoteFn = customQuoteOrder;

  if (typeof optionsOrQuoteFn === 'function') {
    quoteFn = optionsOrQuoteFn;
  } else if (optionsOrQuoteFn && typeof optionsOrQuoteFn === 'object') {
    options = optionsOrQuoteFn;
  }

  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    return {
      success: true,
      issues: [],
      pricesChanged: false,
      updatedItems: [],
      subtotal: 0,
      deliveryFee: null,
      freeDeliveryThreshold: 0,
      isFreeDelivery: false,
      totalPrice: 0
    };
  }

  try {
    // 1. Send only productId, colorName, size, quantity, wilayaCode, deliveryMethod
    // Client-calculated financial values (unitPrice, subtotal, deliveryFee, totalPrice) are NEVER sent.
    const quotePayload = {
      items: cartItems.map(item => ({
        productId: item.productId,
        colorName: item.colorName,
        size: item.size,
        quantity: item.quantity
      }))
    };

    if (options.wilayaCode !== undefined && options.wilayaCode !== null) {
      quotePayload.wilayaCode = options.wilayaCode;
    }
    if (options.deliveryMethod) {
      quotePayload.deliveryMethod = options.deliveryMethod;
    }

    const quoteRes = await quoteFn(quotePayload);

    const failClosed = (reason) => ({
      success: false,
      isValid: false,
      issues: [reason || 'Impossible de vérifier votre panier. Veuillez réessayer.'],
      pricesChanged: false,
      updatedItems: [],
      subtotal: null,
      deliveryFee: null,
      freeDeliveryThreshold: 0,
      isFreeDelivery: false,
      totalPrice: null
    });

    // 2. Strict response structure validation (fail closed if malformed or invalid)
    if (
      !quoteRes ||
      typeof quoteRes !== 'object' ||
      quoteRes.success !== true ||
      !Array.isArray(quoteRes.items) ||
      typeof quoteRes.subtotal !== 'number' ||
      !Number.isFinite(quoteRes.subtotal) ||
      quoteRes.subtotal < 0
    ) {
      return failClosed('Réponse du serveur invalide ou corrompue.');
    }

    if (quoteRes.freeDeliveryThreshold !== undefined && quoteRes.freeDeliveryThreshold !== null) {
      if (
        typeof quoteRes.freeDeliveryThreshold !== 'number' ||
        !Number.isFinite(quoteRes.freeDeliveryThreshold) ||
        quoteRes.freeDeliveryThreshold < 0
      ) {
        return failClosed('Seuil de livraison offerte retourné par le serveur invalide.');
      }
    }

    if (quoteRes.isFreeDelivery !== undefined && typeof quoteRes.isFreeDelivery !== 'boolean') {
      return failClosed('Statut de livraison offerte retourné par le serveur invalide.');
    }

    const deliverySupplied = (options.wilayaCode !== undefined && options.wilayaCode !== null) || Boolean(options.deliveryMethod);
    if (deliverySupplied && quoteRes.isValid === true) {
      if (
        typeof quoteRes.deliveryFee !== 'number' ||
        !Number.isFinite(quoteRes.deliveryFee) ||
        quoteRes.deliveryFee < 0
      ) {
        return failClosed('Frais de livraison retournés par le serveur invalides pour la wilaya spécifiée.');
      }
      if (
        typeof quoteRes.totalPrice !== 'number' ||
        !Number.isFinite(quoteRes.totalPrice) ||
        quoteRes.totalPrice < quoteRes.subtotal
      ) {
        return failClosed('Total commande retourné par le serveur invalide.');
      }
    }

    const issues = Array.isArray(quoteRes.issues) ? quoteRes.issues : [];

    // If server authoritatively reported cart issues or isValid: false, return server issues
    if (quoteRes.isValid === false || issues.length > 0) {
      return {
        success: false,
        isValid: false,
        issues: issues.length > 0 ? issues : ['Le panier contient des articles non valides.'],
        pricesChanged: false,
        updatedItems: [],
        subtotal: quoteRes.subtotal,
        deliveryFee: typeof quoteRes.deliveryFee === 'number' && Number.isFinite(quoteRes.deliveryFee) ? quoteRes.deliveryFee : null,
        freeDeliveryThreshold: (typeof quoteRes.freeDeliveryThreshold === 'number' && Number.isFinite(quoteRes.freeDeliveryThreshold)) ? quoteRes.freeDeliveryThreshold : 0,
        isFreeDelivery: Boolean(quoteRes.isFreeDelivery),
        totalPrice: typeof quoteRes.totalPrice === 'number' && Number.isFinite(quoteRes.totalPrice) ? quoteRes.totalPrice : quoteRes.subtotal
      };
    }

    // Ensure 1-to-1 line matching between requested cart items and quoted items
    if (quoteRes.items.length !== cartItems.length) {
      return failClosed('Nombre d\'articles retournés par le serveur incorrect.');
    }

    const matchedQuoteIndices = new Set();
    const updatedItems = [];
    let pricesChanged = false;

    for (const item of cartItems) {
      const matchingIndices = [];
      quoteRes.items.forEach((q, idx) => {
        if (
          q &&
          String(q.productId) === String(item.productId) &&
          q.colorName === item.colorName &&
          q.size === item.size
        ) {
          matchingIndices.push(idx);
        }
      });

      if (matchingIndices.length !== 1) {
        return failClosed(
          matchingIndices.length === 0
            ? `Article manquant dans la réponse du serveur : ${item.productName || item.productId}.`
            : `Article dupliqué dans la réponse du serveur : ${item.productName || item.productId}.`
        );
      }

      const matchIdx = matchingIndices[0];
      if (matchedQuoteIndices.has(matchIdx)) {
        return failClosed('Article serveur associé plusieurs fois.');
      }
      matchedQuoteIndices.add(matchIdx);

      const quoted = quoteRes.items[matchIdx];

      if (typeof quoted.isAvailable !== 'boolean' || typeof quoted.inStock !== 'boolean') {
        return failClosed('Disponibilité d\'article invalide dans la réponse du serveur.');
      }

      if (quoted.isAvailable) {
        if (
          typeof quoted.unitPrice !== 'number' ||
          !Number.isFinite(quoted.unitPrice) ||
          quoted.unitPrice < 0 ||
          typeof quoted.originalPrice !== 'number' ||
          !Number.isFinite(quoted.originalPrice) ||
          quoted.originalPrice < 0
        ) {
          return failClosed('Tarification unitaire invalide dans la réponse du serveur.');
        }
      }

      if (!quoted.isAvailable || !quoted.inStock) {
        continue;
      }

      if (item.unitPrice !== quoted.unitPrice || item.originalPrice !== quoted.originalPrice) {
        pricesChanged = true;
      }

      updatedItems.push({
        ...item,
        productName: quoted.productName || item.productName,
        unitPrice: quoted.unitPrice,
        originalPrice: quoted.originalPrice,
        image: quoted.image || item.image
      });
    }

    const isCartValid = Boolean(quoteRes.isValid) && issues.length === 0;

    return {
      success: isCartValid,
      isValid: isCartValid,
      issues,
      pricesChanged,
      updatedItems,
      subtotal: quoteRes.subtotal,
      deliveryFee: typeof quoteRes.deliveryFee === 'number' && Number.isFinite(quoteRes.deliveryFee) ? quoteRes.deliveryFee : null,
      freeDeliveryThreshold: (typeof quoteRes.freeDeliveryThreshold === 'number' && Number.isFinite(quoteRes.freeDeliveryThreshold)) ? quoteRes.freeDeliveryThreshold : 0,
      isFreeDelivery: Boolean(quoteRes.isFreeDelivery),
      totalPrice: typeof quoteRes.totalPrice === 'number' && Number.isFinite(quoteRes.totalPrice)
        ? quoteRes.totalPrice
        : (typeof quoteRes.deliveryFee === 'number' ? quoteRes.subtotal + quoteRes.deliveryFee : quoteRes.subtotal)
    };
  } catch (err) {
    console.warn('[Cart Quote Error]:', err?.message || err);
    // FAIL CLOSED: Network errors, HTTP 500, or unusable responses must NEVER allow checkout
    return {
      success: false,
      isValid: false,
      issues: ['Impossible de vérifier votre panier. Veuillez réessayer.'],
      pricesChanged: false,
      updatedItems: [],
      subtotal: null,
      deliveryFee: null,
      freeDeliveryThreshold: 0,
      isFreeDelivery: false,
      totalPrice: null
    };
  }
}
