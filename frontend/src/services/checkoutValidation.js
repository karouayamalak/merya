import { fetchProducts, quoteOrder } from './api.js';

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
 * Revalidates all cart items against live server product database:
 * - Uses preferred server-authoritative quote endpoint POST /orders/quote
 * - Detects deactivated/archived/deleted products
 * - Detects removed color or size variants
 * - Detects stock shortage
 * - Computes live effective price (promotional price if active, else selling price)
 * - Returns updated items and change detection flags
 */
export async function revalidateCartWithServer(
  cartItems,
  customQuoteOrder = quoteOrder,
  customFetchProducts = fetchProducts
) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    return { success: true, issues: [], pricesChanged: false, updatedItems: [] };
  }

  // 1. Attempt primary server-authoritative quote endpoint
  try {
    const quoteRes = await customQuoteOrder({
      items: cartItems.map(item => ({
        productId: item.productId,
        productName: item.productName,
        colorName: item.colorName,
        size: item.size,
        quantity: item.quantity
      }))
    });

    if (quoteRes && quoteRes.success && Array.isArray(quoteRes.items)) {
      let pricesChanged = false;
      const updatedItems = [];

      for (const item of cartItems) {
        const quoted = quoteRes.items.find(q =>
          String(q.productId) === String(item.productId) &&
          q.colorName === item.colorName &&
          q.size === item.size
        );

        if (!quoted || !quoted.isAvailable) {
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

      const issues = Array.isArray(quoteRes.issues) ? quoteRes.issues : [];

      return {
        success: Boolean(quoteRes.isValid) && issues.length === 0,
        issues,
        pricesChanged,
        updatedItems
      };
    }
  } catch (quoteErr) {
    console.warn('[Cart Quote Fallback] Using products catalog:', quoteErr?.message || quoteErr);
  }

  // 2. Resilient fallback via product catalog
  try {
    const firstRes = await customFetchProducts({ limit: 50, page: 1 });
    let allProducts = Array.isArray(firstRes?.products) ? firstRes.products : [];
    // Products API returns total under pagination.total, not top-level total
    const total = Number(firstRes?.pagination?.total) || allProducts.length;

    if (total > 50) {
      const totalPages = Math.ceil(total / 50);
      const pagePromises = [];
      for (let p = 2; p <= totalPages; p++) {
        pagePromises.push(customFetchProducts({ limit: 50, page: p }));
      }
      const extraPages = await Promise.all(pagePromises);
      for (const ep of extraPages) {
        if (Array.isArray(ep?.products)) {
          allProducts = allProducts.concat(ep.products);
        }
      }
    }

    const productMap = new Map();
    for (const p of allProducts) {
      if (p && p._id) {
        productMap.set(String(p._id), p);
      }
    }

    const issues = [];
    let pricesChanged = false;
    const updatedItems = [];

    for (const item of cartItems) {
      const serverProduct = productMap.get(String(item.productId));

      // Product missing or inactive/archived
      if (!serverProduct) {
        issues.push(`L'article "${item.productName || 'Sélectionné'}" n'est plus disponible.`);
        continue;
      }

      // Color variant check
      const colorVariant = Array.isArray(serverProduct.colors)
        ? serverProduct.colors.find(c => c.colorName === item.colorName)
        : null;
      if (!colorVariant) {
        issues.push(`La couleur "${item.colorName}" n'est plus disponible pour "${serverProduct.name}".`);
        continue;
      }

      // Size variant check
      const sizeVariant = Array.isArray(colorVariant.sizes)
        ? colorVariant.sizes.find(s => s.size === item.size)
        : null;
      if (!sizeVariant) {
        issues.push(`La taille "${item.size}" n'est plus disponible pour "${serverProduct.name}" (${item.colorName}).`);
        continue;
      }

      // Stock check
      if (typeof sizeVariant.stock === 'number' && sizeVariant.stock < item.quantity) {
        if (sizeVariant.stock <= 0) {
          issues.push(`"${serverProduct.name}" (${item.colorName}, ${item.size}) est actuellement en rupture de stock.`);
        } else {
          issues.push(`Stock insuffisant pour "${serverProduct.name}" (${item.colorName}, ${item.size}) : seulement ${sizeVariant.stock} disponible(s).`);
        }
        continue;
      }

      // Live authoritative price calculation
      const livePromotionActive = Boolean(
        serverProduct.promotion &&
        serverProduct.promotion.active &&
        typeof serverProduct.promotion.promotionalPrice === 'number' &&
        serverProduct.promotion.promotionalPrice > 0 &&
        serverProduct.promotion.promotionalPrice < serverProduct.sellingPrice
      );

      const effectiveUnitPrice = livePromotionActive
        ? serverProduct.promotion.promotionalPrice
        : serverProduct.sellingPrice;

      const effectiveOriginalPrice = serverProduct.sellingPrice;

      if (item.unitPrice !== effectiveUnitPrice || item.originalPrice !== effectiveOriginalPrice) {
        pricesChanged = true;
      }

      updatedItems.push({
        ...item,
        productName: serverProduct.name,
        unitPrice: effectiveUnitPrice,
        originalPrice: effectiveOriginalPrice,
        image: (Array.isArray(colorVariant.images) && colorVariant.images[0]) || item.image
      });
    }

    return {
      success: issues.length === 0,
      issues,
      pricesChanged,
      updatedItems
    };
  } catch (err) {
    console.warn('[Cart Revalidation Error]:', err);
    // FAIL-CLOSED: A network or server error during validation must NEVER be treated
    // as a successful validation. Return failure so checkout remains disabled.
    return {
      success: false,
      issues: ['Impossible de vérifier votre panier. Veuillez réessayer.'],
      pricesChanged: false,
      updatedItems: []
    };
  }
}
