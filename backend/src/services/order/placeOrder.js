import { Order } from '../../models/Order.js';
import { Product } from '../../models/Product.js';
import { DeliverySetting } from '../../models/DeliverySetting.js';
import { ORDER_STATUS, DELIVERY_METHODS, ALGERIA_WILAYAS } from '../../config/constants.js';
import { generateOrderCode } from '../../utils/orderCode.js';
import { deductStockAtomic } from '../inventoryService.js';
import { wsService } from '../websocketService.js';
import { withTransactionRetry } from '../../utils/transactionRetry.js';
import { resolveAuthoritativeDelivery, validateCartItem, parseAuthoritativeWilayaCode } from '../deliveryService.js';
import { computeOrderFingerprint } from './orderFingerprint.js';
import { sendTelegramOrderNotification } from '../telegramService.js';

/**
 * Place a new order with full database validation and atomic inventory deduction.
 */
export async function placeOrder({ customer, items, idempotencyKey }) {
  if (!items || items.length === 0) {
    throw new Error('Order must contain at least one item');
  }

  // 1. Enforce strict service-level idempotency contract
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(idempotencyKey)) {
    throw new Error('IDEMPOTENCY_KEY_REQUIRED: A valid idempotencyKey (8-128 alphanumeric characters, dashes, underscores) is strictly required.');
  }

  const currentFingerprint = computeOrderFingerprint({ customer, items });

  const existingOrder = await Order.findOne({ idempotencyKey });
  if (existingOrder) {
    if (existingOrder.idempotencyFingerprint && existingOrder.idempotencyFingerprint !== currentFingerprint) {
      throw new Error('IDEMPOTENCY_CONFLICT: Idempotency key reused with different request payload');
    }
    console.log(`[OrderService] Duplicate submission caught via idempotency key: ${idempotencyKey}`);
    return { order: existingOrder, isDuplicate: true };
  }

  // 2. Strict Canonical Wilaya Verification & Availability Check
  if (!customer || !customer.wilaya) {
    throw new Error('Customer Wilaya is required');
  }

  const rawCode = typeof customer.wilaya === 'object' ? customer.wilaya.code : customer.wilaya;
  const parsedCode = parseAuthoritativeWilayaCode(rawCode);
  if (!parsedCode.valid) {
    throw new Error(parsedCode.error);
  }
  const codeNum = parsedCode.codeNum;
  const name = typeof customer.wilaya === 'object' ? (customer.wilaya.name || '') : String(customer.wilaya);

  const canonicalWilaya = ALGERIA_WILAYAS.find(w => w.code === codeNum);
  if (!canonicalWilaya) {
    throw new Error(`Invalid Wilaya code: ${codeNum}. Must be between 1 and 58.`);
  }

  if (name && typeof name === 'string' && name.trim()) {
    const normEn = (s) => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const normAr = (s) => s.trim().replace(/[إأآا]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
    const normNameEn = normEn(name);
    const normCanonEn = normEn(canonicalWilaya.name);
    const matchesEn = normCanonEn === normNameEn || (codeNum === 16 && (normNameEn === 'alger' || normNameEn === 'algiers'));
    const matchesAr = canonicalWilaya.nameAr === name.trim() || normAr(canonicalWilaya.nameAr) === normAr(name);
    if (!matchesEn && !matchesAr) {
      throw new Error(`Wilaya mismatch: code ${codeNum} is "${canonicalWilaya.name}", but received "${name}".`);
    }
  }

  // Strict Delivery Method Validation
  if (!customer.deliveryMethod) {
    throw new Error('Delivery method is required (agency or home)');
  }

  const deliveryMethodNorm = String(customer.deliveryMethod).toLowerCase().trim();
  if (deliveryMethodNorm === DELIVERY_METHODS.AGENCY) {
    if (customer.agencyName && typeof customer.agencyName === 'string') {
      customer.agencyName = customer.agencyName.trim().slice(0, 100);
    } else {
      customer.agencyName = undefined;
    }
    customer.deliveryMethod = DELIVERY_METHODS.AGENCY;
  } else if (deliveryMethodNorm === DELIVERY_METHODS.HOME) {
    if (!customer.address || typeof customer.address !== 'string' || customer.address.trim().length === 0) {
      throw new Error('Detailed delivery address is required for home delivery');
    }
    const trimmedAddress = customer.address.trim();
    if (trimmedAddress.length < 4) {
      throw new Error('Detailed delivery address is required for home delivery (min 4 characters)');
    }
    if (trimmedAddress.length > 300) {
      throw new Error('Address cannot exceed 300 characters');
    }
    customer.address = trimmedAddress;
    customer.deliveryMethod = DELIVERY_METHODS.HOME;
  } else {
    throw new Error(`Invalid delivery method "${customer.deliveryMethod}". Must be "agency" or "home".`);
  }

  // ─── CHECKOUT TRANSACTION (WITH BOUNDED RETRY SAFETY) ───────────────────────
  let txResult;
  try {
    txResult = await withTransactionRetry(async (session, attempt) => {
      const sessionOpt = session ? { session } : {};

      // Re-check idempotency inside transaction for concurrency safety
      if (idempotencyKey) {
        const existingInTx = await Order.findOne({ idempotencyKey }, null, sessionOpt);
        if (existingInTx) {
          if (existingInTx.idempotencyFingerprint && existingInTx.idempotencyFingerprint !== currentFingerprint) {
            throw new Error('IDEMPOTENCY_CONFLICT: Idempotency key reused with different request payload');
          }
          console.log(`[OrderService] Duplicate submission caught inside transaction via idempotency key: ${idempotencyKey}`);
          return { order: existingInTx, isDuplicate: true };
        }
      }

      // 3. Authoritative Database Item Verification & Snapshots inside session
      const itemSnapshots = [];
      let subtotal = 0;

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const validation = validateCartItem(item, idx);
        if (!validation.valid) {
          throw new Error(`Invalid item parameters: ${validation.issue}`);
        }
        const { productId, colorName, size, quantity } = item;

        const product = await Product.findOne({ _id: productId, isActive: true, isArchived: false }, null, sessionOpt);
        if (!product) {
          throw new Error(`Product not found or is currently inactive: ${productId}`);
        }

        const colorVariant = product.colors.find(c => c.colorName === colorName);
        if (!colorVariant) {
          throw new Error(`Color "${colorName}" is no longer available for ${product.name}`);
        }

        const sizeVariant = colorVariant.sizes.find(s => s.size === size);
        if (!sizeVariant) {
          throw new Error(`Size "${size}" is not available for ${product.name} in ${colorName}`);
        }

        if (sizeVariant.stock < quantity) {
          throw new Error(`Only ${sizeVariant.stock} items remaining for ${product.name} (${colorName}, ${size})`);
        }

        // Effective selling price: promotion price takes precedence if active and valid
        const itemPrice = (product.promotion && product.promotion.active && typeof product.promotion.promotionalPrice === 'number' && product.promotion.promotionalPrice > 0 && product.promotion.promotionalPrice < product.sellingPrice)
          ? product.promotion.promotionalPrice
          : product.sellingPrice;

        const itemTotal = itemPrice * quantity;
        subtotal += itemTotal;

        const resolveSnapshotProductName = (name) => {
          if (!name) return 'Product';
          if (typeof name === 'string') return name;
          if (typeof name === 'object') {
            return name.fr || name.en || name.ar || 'Product';
          }
          return String(name);
        };

        itemSnapshots.push({
          productId: product._id,
          productName: resolveSnapshotProductName(product.name),
          colorName: colorVariant.colorName,
          colorCode: colorVariant.colorCode,
          size: sizeVariant.size,
          quantity,
          unitPrice: itemPrice,
          unitCost: product.costPrice,
          image: colorVariant.images[0] || ''
        });
      }

      // 4. Dynamic Delivery Fee calculation using authoritative DeliverySetting read inside transaction
      const deliverySettingInTx = await DeliverySetting.getSingleton(session);
      if (!deliverySettingInTx) {
        throw new Error('Delivery configuration is not initialized. Please configure delivery settings before placing orders.');
      }

      const resolvedDelivery = await resolveAuthoritativeDelivery({
        wilayaCode: codeNum,
        deliveryMethod: customer.deliveryMethod,
        subtotal,
        deliverySetting: deliverySettingInTx,
        throwOnError: true
      });
      const deliveryFee = resolvedDelivery.deliveryFee;
      const totalPrice = resolvedDelivery.totalPrice;

      // 5. Deduct all inventory atomically within the session
      await deductStockAtomic(items, session);

      // 6. Generate secure unique order tracking code
      let orderCode;
      let codeExists = true;
      while (codeExists) {
        orderCode = generateOrderCode();
        const found = await Order.findOne({ orderCode }, null, sessionOpt);
        if (!found) codeExists = false;
      }

      // 7. Create Order Document with snapshot and fingerprint inside session
      // Always store canonical Wilaya name (not client-supplied variant) in the snapshot
      const canonicalCustomer = {
        ...customer,
        wilaya: { code: codeNum, name: canonicalWilaya.name }
      };
      const createdOrder = new Order({
        orderCode,
        idempotencyKey,
        idempotencyFingerprint: currentFingerprint,
        customer: canonicalCustomer,
        items: itemSnapshots,
        subtotal,
        deliveryFee,
        totalPrice,
        status: ORDER_STATUS.PENDING,
        stockRestored: false,
        auditHistory: [
          {
            action: 'ORDER_PLACED',
            timestamp: new Date(),
            performedBy: 'Customer',
            note: `Order placed via Cash on Delivery (${customer.deliveryMethod})`,
            details: { subtotal, deliveryFee, totalPrice }
          }
        ]
      });

      await createdOrder.save(sessionOpt);
      console.log(`[OrderService] [TX] Checkout committed successfully on attempt ${attempt}: order ${createdOrder.orderCode}`);
      return { order: createdOrder, isDuplicate: false };
    });
  } catch (err) {
    // Handle race condition where another concurrent transaction with the same idempotency key won/committed
    if (idempotencyKey && (err.code === 11000 || err.message?.includes('duplicate key') || err.message?.includes('E11000'))) {
      let existingOrder = await Order.findOne({ idempotencyKey });
      if (!existingOrder) {
        await new Promise(resolve => setTimeout(resolve, 100));
        existingOrder = await Order.findOne({ idempotencyKey });
      }

      if (existingOrder) {
        if (existingOrder.idempotencyFingerprint && existingOrder.idempotencyFingerprint !== currentFingerprint) {
          throw new Error('IDEMPOTENCY_CONFLICT: Idempotency key reused with different request payload');
        }
        console.log(`[OrderService] Concurrent duplicate order caught via idempotencyKey: ${idempotencyKey}`);
        return { order: existingOrder, isDuplicate: true };
      }
    }

    throw err;
  }

  const { order: finalOrder, isDuplicate } = txResult;

  // 8. Real-time WebSocket Broadcast to Admin (strictly after successful final commit)
  if (!isDuplicate && finalOrder) {
    try {
      wsService.broadcastNewOrder(finalOrder);
    } catch (wsErr) {
      console.warn(`[OrderService] WebSocket broadcastNewOrder failed (non-fatal): ${wsErr.message}`);
    }

    // 9. Instant Telegram Order Alert to Store Owner (non-blocking)
    try {
      sendTelegramOrderNotification(finalOrder).catch(tErr => {
        console.warn(`[OrderService] Telegram alert failed (non-fatal): ${tErr.message}`);
      });
    } catch (tErr) {
      console.warn(`[OrderService] Telegram alert dispatch error (non-fatal): ${tErr.message}`);
    }
  }

  return { order: finalOrder, isDuplicate: !!isDuplicate };
}
