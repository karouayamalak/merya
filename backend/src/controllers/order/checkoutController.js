import { Product } from '../../models/Product.js';
import { DeliverySetting } from '../../models/DeliverySetting.js';
import { placeOrder } from '../../services/orderService.js';
import { resolveAuthoritativeDelivery, validateCartItem, MAX_ITEM_QUANTITY } from '../../services/deliveryService.js';

// Public: Checkout order
export const checkout = async (req, res, next) => {
  try {
    const { customer, items, idempotencyKey } = req.body;

    const result = await placeOrder({
      customer,
      items,
      idempotencyKey
    });

    // Customer facing response - minimal sensitive data, clean confirmation
    res.status(201).json({
      success: true,
      orderCode: result.order.orderCode,
      status: result.order.status,
      customer: {
        fullName: result.order.customer.fullName,
        phone: result.order.customer.phone,
        wilaya: result.order.customer.wilaya,
        deliveryMethod: result.order.customer.deliveryMethod
      },
      items: result.order.items.map(item => ({
        productName: item.productName,
        colorName: item.colorName,
        size: item.size,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        image: item.image
      })),
      subtotal: result.order.subtotal,
      deliveryFee: result.order.deliveryFee,
      totalPrice: result.order.totalPrice,
      isDuplicate: result.isDuplicate,
      createdAt: result.order.createdAt
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }

    if (error.message && (error.message.startsWith('IDEMPOTENCY_KEY_INVALID') || error.message.startsWith('IDEMPOTENCY_KEY_REQUIRED'))) {
      return res.status(400).json({ success: false, message: error.message });
    }

    if (error.message && error.message.startsWith('IDEMPOTENCY_CONFLICT')) {
      return res.status(409).json({ success: false, message: error.message });
    }

    // Business logic errors
    const businessErrors = [
      'insufficient stock',
      'product not found',
      'no longer available',
      'not available',
      'invalid item',
      'invalid delivery method',
      'at least one item',
      'unavailable for delivery',
      'wilaya mismatch',
      'invalid wilaya',
      'delivery configuration',
      'delivery fee is not configured'
    ];
    const isBusinessError = businessErrors.some(phrase =>
      error.message?.toLowerCase().includes(phrase)
    );
    if (isBusinessError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
};

// Public: Server-authoritative cart quote & availability verification
export const getCartQuote = async (req, res, next) => {
  try {
    const { items, wilayaCode, deliveryMethod } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'La liste des articles est requise.' });
    }

    const issues = [];
    let subtotal = 0;
    const quotedItems = [];

    // Load delivery settings for threshold comparison and delivery validation
    const setting = await DeliverySetting.getSingleton();
    const freeDeliveryThreshold = (setting && typeof setting.freeDeliveryThreshold === 'number' && setting.freeDeliveryThreshold > 0)
      ? setting.freeDeliveryThreshold
      : 0;

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const validation = validateCartItem(item, idx, { maxQuantity: MAX_ITEM_QUANTITY });
      if (!validation.valid) {
        issues.push(validation.issue);
        quotedItems.push({
          productId: item?.productId,
          colorName: item?.colorName,
          size: item?.size,
          quantity: item?.quantity,
          isAvailable: false,
          inStock: false,
          error: validation.issue
        });
        continue;
      }

      const { productId, colorName, size, quantity } = item;

      const product = await Product.findOne({ _id: productId, isActive: true, isArchived: false });
      if (!product) {
        issues.push(`L'article "${item.productName || 'sélectionné'}" n'est plus disponible.`);
        quotedItems.push({
          productId,
          colorName,
          size,
          quantity,
          isAvailable: false,
          inStock: false,
          error: 'Product not found or inactive'
        });
        continue;
      }

      const colorVariant = (product.colors || []).find(c => c.colorName === colorName);
      if (!colorVariant) {
        issues.push(`La couleur "${colorName}" n'est plus disponible pour "${product.name}".`);
        quotedItems.push({
          productId,
          productName: product.name,
          colorName,
          size,
          quantity,
          isAvailable: false,
          inStock: false,
          error: 'Color not available'
        });
        continue;
      }

      const sizeVariant = (colorVariant.sizes || []).find(s => s.size === size);
      if (!sizeVariant) {
        issues.push(`La taille "${size}" n'est plus disponible pour "${product.name}" (${colorName}).`);
        quotedItems.push({
          productId,
          productName: product.name,
          colorName,
          size,
          quantity,
          isAvailable: false,
          inStock: false,
          error: 'Size not available'
        });
        continue;
      }

      const availableStock = typeof sizeVariant.stock === 'number' ? sizeVariant.stock : 0;
      if (availableStock < quantity) {
        if (availableStock <= 0) {
          issues.push(`"${product.name}" (${colorName}, ${size}) est en rupture de stock.`);
        } else {
          issues.push(`Stock insuffisant pour "${product.name}" (${colorName}, ${size}) : seulement ${availableStock} restant(s).`);
        }
      }

      // Live authoritative price calculation
      const isPromo = Boolean(
        product.promotion &&
        product.promotion.active &&
        typeof product.promotion.promotionalPrice === 'number' &&
        product.promotion.promotionalPrice > 0 &&
        product.promotion.promotionalPrice < product.sellingPrice
      );

      const effectiveUnitPrice = isPromo ? product.promotion.promotionalPrice : product.sellingPrice;
      const effectiveOriginalPrice = product.sellingPrice;
      const itemTotal = effectiveUnitPrice * quantity;
      subtotal += itemTotal;

      quotedItems.push({
        productId: product._id,
        productName: product.name,
        colorName: colorVariant.colorName,
        size: sizeVariant.size,
        quantity,
        unitPrice: effectiveUnitPrice,
        originalPrice: effectiveOriginalPrice,
        availableStock,
        inStock: availableStock >= quantity,
        isAvailable: true,
        image: (Array.isArray(colorVariant.images) && colorVariant.images[0]) || ''
      });
    }

    // Delivery fee validation and calculation
    let deliveryFee = null;
    let isFreeDelivery = false;
    let totalPrice = subtotal;

    const deliveryAttempted = wilayaCode !== undefined || deliveryMethod !== undefined;

    if (deliveryAttempted) {
      if (wilayaCode === undefined || wilayaCode === null || wilayaCode === '') {
        issues.push('Le code wilaya est requis lorsque le mode de livraison est spécifié.');
      }
      if (!deliveryMethod) {
        issues.push('Le mode de livraison (agency ou home) est requis lorsque la wilaya est spécifiée.');
      }

      if (wilayaCode !== undefined && wilayaCode !== null && wilayaCode !== '' && deliveryMethod) {
        const deliveryRes = await resolveAuthoritativeDelivery({
          wilayaCode,
          deliveryMethod,
          subtotal,
          deliverySetting: setting,
          throwOnError: false
        });

        if (!deliveryRes.success) {
          issues.push(deliveryRes.error);
          deliveryFee = null;
          isFreeDelivery = false;
        } else {
          deliveryFee = deliveryRes.deliveryFee;
          isFreeDelivery = deliveryRes.isFreeDelivery;
          totalPrice = subtotal + deliveryFee;
        }
      }
    }

    const isCartValid = issues.length === 0;

    res.json({
      success: true,
      isValid: isCartValid,
      subtotal,
      deliveryFee,
      freeDeliveryThreshold,
      isFreeDelivery,
      totalPrice,
      items: quotedItems,
      issues
    });
  } catch (error) {
    next(error);
  }
};
