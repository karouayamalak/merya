import crypto from 'crypto';
import mongoose from 'mongoose';
import { Order } from '../models/Order.js';
import { Product } from '../models/Product.js';
import { DeliverySetting } from '../models/DeliverySetting.js';
import { ORDER_STATUS, VALID_STATUS_TRANSITIONS, DELIVERY_METHODS, ALGERIA_WILAYAS } from '../config/constants.js';
import { generateOrderCode } from '../utils/orderCode.js';
import { normalizeAlgerianPhone } from '../utils/phone.js';
import { deductStockAtomic, restoreStockAtomic } from './inventoryService.js';
import { wsService } from './websocketService.js';
import { withTransactionRetry } from '../utils/transactionRetry.js';

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

/**
 * Place a new order with full database validation and atomic inventory deduction.
 */
export async function placeOrder({ customer, items, idempotencyKey }) {
  if (!items || items.length === 0) {
    throw new Error('Order must contain at least one item');
  }

  // 1. Check idempotency with deterministic fingerprint (early fast path)
  const currentFingerprint = computeOrderFingerprint({ customer, items });

  if (idempotencyKey) {
    const existingOrder = await Order.findOne({ idempotencyKey });
    if (existingOrder) {
      if (existingOrder.idempotencyFingerprint && existingOrder.idempotencyFingerprint !== currentFingerprint) {
        throw new Error('IDEMPOTENCY_CONFLICT: Idempotency key reused with different request payload');
      }
      console.log(`[OrderService] Duplicate submission caught via idempotency key: ${idempotencyKey}`);
      return { order: existingOrder, isDuplicate: true };
    }
  }

  // 2. Strict Canonical Wilaya Verification & Availability Check
  if (!customer || !customer.wilaya) {
    throw new Error('Customer Wilaya is required');
  }

  const code = typeof customer.wilaya === 'object' ? customer.wilaya.code : customer.wilaya;
  const name = typeof customer.wilaya === 'object' ? (customer.wilaya.name || '') : String(customer.wilaya);
  const codeNum = Number(code);

  const canonicalWilaya = ALGERIA_WILAYAS.find(w => w.code === codeNum);
  if (!canonicalWilaya) {
    throw new Error(`Invalid Wilaya code: ${code}. Must be between 1 and 58.`);
  }

  if (name && typeof name === 'string' && name.trim()) {
    const normName = name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const canonicalNorm = canonicalWilaya.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const matchesEn = canonicalNorm === normName || (codeNum === 16 && (normName === 'alger' || normName === 'algiers'));
    const matchesAr = canonicalWilaya.nameAr === name.trim();
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
    if (!customer.agencyName || typeof customer.agencyName !== 'string' || customer.agencyName.trim().length === 0) {
      throw new Error('Agency name is required for agency delivery');
    }
    const trimmedAgency = customer.agencyName.trim();
    if (trimmedAgency.length < 2) {
      throw new Error('Agency name must be at least 2 characters');
    }
    if (trimmedAgency.length > 100) {
      throw new Error('Agency name cannot exceed 100 characters');
    }
    customer.agencyName = trimmedAgency;
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

  let deliverySetting = await DeliverySetting.findOne();
  if (!deliverySetting) {
    const err = new Error('Delivery configuration is not initialized. Please configure delivery settings before placing orders.');
    err.statusCode = 400;
    err.code = 'DELIVERY_CONFIGURATION_MISSING';
    throw err;
  }

  const wilayaRate = deliverySetting.wilayaRates?.find(r => r.wilayaCode === codeNum);
  if (!wilayaRate) {
    const err = new Error(`Delivery configuration missing for Wilaya ${codeNum} (${canonicalWilaya.name})`);
    err.statusCode = 400;
    err.code = 'DELIVERY_CONFIGURATION_MISSING';
    throw err;
  }

  if (wilayaRate.isAvailable === false) {
    const err = new Error(`Wilaya ${codeNum} (${canonicalWilaya.name}) is currently unavailable for delivery.`);
    err.statusCode = 400;
    err.code = 'WILAYA_UNAVAILABLE';
    throw err;
  }

  let authoritativeFee;
  if (customer.deliveryMethod === DELIVERY_METHODS.AGENCY) {
    authoritativeFee = wilayaRate.agencyFee;
  } else if (customer.deliveryMethod === DELIVERY_METHODS.HOME) {
    authoritativeFee = wilayaRate.homeFee;
  } else {
    const err = new Error(`Invalid delivery method "${customer.deliveryMethod}". Must be "agency" or "home".`);
    err.statusCode = 400;
    throw err;
  }

  if (typeof authoritativeFee !== 'number' || !Number.isInteger(authoritativeFee) || authoritativeFee < 0) {
    const err = new Error(`Authoritative delivery fee is not configured for Wilaya ${codeNum} (${canonicalWilaya.name}) with method "${customer.deliveryMethod}".`);
    err.statusCode = 400;
    err.code = 'DELIVERY_FEE_NOT_CONFIGURED';
    throw err;
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

      for (const item of items) {
        const { productId, colorName, size, quantity } = item;

        if (!productId || !colorName || !size || !quantity || quantity <= 0) {
          throw new Error('Invalid item parameters');
        }

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

        const itemTotal = product.sellingPrice * quantity;
        subtotal += itemTotal;

        itemSnapshots.push({
          productId: product._id,
          productName: product.name,
          colorName: colorVariant.colorName,
          colorCode: colorVariant.colorCode,
          size: sizeVariant.size,
          quantity,
          unitPrice: product.sellingPrice,
          unitCost: product.costPrice,
          image: colorVariant.images[0] || ''
        });
      }

      // 4. Dynamic Delivery Fee calculation from database
      let deliveryFee = authoritativeFee;

      // Free delivery threshold check if active
      if (deliverySetting.freeDeliveryThreshold && deliverySetting.freeDeliveryThreshold > 0 && subtotal >= deliverySetting.freeDeliveryThreshold) {
        deliveryFee = 0;
      }

      const totalPrice = subtotal + deliveryFee;

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
      const createdOrder = new Order({
        orderCode,
        idempotencyKey,
        idempotencyFingerprint: currentFingerprint,
        customer,
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
  }

  return { order: finalOrder, isDuplicate: !!isDuplicate };
}

/**
 * Atomically transition order status using a MongoDB multi-document transaction.
 *
 * INVARIANTS:
 *   - Order state change AND all inventory operations are wrapped in a single
 *     MongoDB session/transaction. They either ALL commit or ALL abort.
 *   - No partial inventory state can survive a failure.
 *   - Exactly ONE stock restoration per order when entering Cancelled/Returned.
 *   - Exactly ONE stock deduction per order when leaving Cancelled/Returned.
 *   - Concurrent duplicate requests: exactly one CAS wins; others get CONCURRENT_CONFLICT.
 *   - Delivered orders are TERMINAL — no transition possible, even with override.
 *   - Override requires explicit override=true AND non-empty overrideReason.
 *   - Every override is recorded in auditHistory with the reason.
 *
 * Strategy (inside a single Mongoose transaction):
 *   1. Pre-flight: read order outside session for fast validation (no side effects)
 *   2. Start session + transaction
 *   3. Re-read order inside session (serialises with other transactions)
 *   4. Re-validate CAS conditions inside the transaction
 *   5. CAS findOneAndUpdate with __v + status + stockRestored conditions
 *   6. If matchedCount === 0 → throw CONCURRENT_CONFLICT (abort)
 *   7. Inventory ops with { session }
 *   8. commitTransaction()
 *   9. Broadcast WebSocket AFTER commit (non-fatal)
 *
 * @param {string}  orderId
 * @param {string}  newStatus
 * @param {string}  [adminUsername='Admin']
 * @param {string}  [note='']
 * @param {boolean} [isOverride=false]  - Must be true for non-machine transitions
 * @param {string}  [overrideReason=''] - Required when isOverride=true
 */
export async function updateOrderStatus(
  orderId,
  newStatus,
  adminUsername = 'Admin',
  note = '',
  isOverride = false,
  overrideReason = ''
) {
  const validStatuses = Object.values(ORDER_STATUS);
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Invalid order status "${newStatus}". Must be one of: ${validStatuses.join(', ')}`);
  }

  // Validate override parameters up-front
  if (isOverride) {
    if (!overrideReason || typeof overrideReason !== 'string' || overrideReason.trim().length === 0) {
      throw new Error('OVERRIDE_REQUIRES_REASON: A non-empty overrideReason is required for manual status overrides.');
    }
  }

  // ─── PRE-FLIGHT: Fast read outside session for early validation ───────────────
  const preflight = await Order.findById(orderId);
  if (!preflight) {
    throw new Error('Order not found');
  }

  const currentStatus = preflight.status;

  // HARD INVARIANT: Delivered is a terminal state — no override can change this
  if (currentStatus === ORDER_STATUS.DELIVERED) {
    throw new Error('Cannot transition order: Terminal state violation: Delivered orders cannot be transitioned.');
  }

  if (currentStatus === newStatus && !isOverride) {
    throw new Error(`Cannot transition order: Order is already in status "${newStatus}"`);
  }

  // Validate state machine unless admin override
  if (!isOverride) {
    const allowedTransitions = VALID_STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowedTransitions.includes(newStatus)) {
      throw new Error(`Cannot transition order from status "${currentStatus}" to "${newStatus}"`);
    }
  }

  // ─── Determine inventory operation required (needed before choosing tx strategy) ─
  const isEnteringRestoredState = newStatus === ORDER_STATUS.CANCELLED || newStatus === ORDER_STATUS.RETURNED;
  const isLeavingRestoredState = (
    currentStatus === ORDER_STATUS.CANCELLED || currentStatus === ORDER_STATUS.RETURNED
  ) && !isEnteringRestoredState;

  // Use pre-flight values as early signal; definitive check is inside transaction
  const mayNeedRestore = isEnteringRestoredState && !preflight.stockRestored;
  const mayNeedDeduct  = isLeavingRestoredState  && preflight.stockRestored;
  const needsTransaction = mayNeedRestore || mayNeedDeduct;

  let updatedOrder = null;

  if (needsTransaction) {
    // ─── TRANSACTION PATH: inventory-touching transition (WITH BOUNDED RETRY) ───
    // All reads and writes happen inside a single MongoDB session so they either
    // ALL commit or ALL abort. No compensating rollback is needed or performed.
    updatedOrder = await withTransactionRetry(async (session, attempt) => {
      const sessionOpt = session ? { session } : {};

      // Re-read inside transaction to establish a consistent read snapshot.
      const orderInTx = await Order.findById(orderId, null, sessionOpt);
      if (!orderInTx) {
        throw new Error('Order not found');
      }

      // Re-check terminal state inside transaction
      if (orderInTx.status === ORDER_STATUS.DELIVERED) {
        throw new Error('Cannot transition order: Terminal state violation: Delivered orders cannot be transitioned.');
      }

      // Re-check idempotency inside transaction
      if (orderInTx.status === newStatus && !isOverride) {
        throw new Error(`Cannot transition order: Order is already in status "${newStatus}"`);
      }

      // Re-validate state machine inside transaction
      if (!isOverride) {
        const allowedTx = VALID_STATUS_TRANSITIONS[orderInTx.status] || [];
        if (!allowedTx.includes(newStatus)) {
          throw new Error(`Cannot transition order from status "${orderInTx.status}" to "${newStatus}"`);
        }
      }

      const txCurrentStatus = orderInTx.status;

      // Definitively determine inventory op (inside tx, using authoritative data)
      const txIsEntering = newStatus === ORDER_STATUS.CANCELLED || newStatus === ORDER_STATUS.RETURNED;
      const txIsLeaving  = (txCurrentStatus === ORDER_STATUS.CANCELLED || txCurrentStatus === ORDER_STATUS.RETURNED) && !txIsEntering;
      const needsRestore = txIsEntering && !orderInTx.stockRestored;
      const needsDeduct  = txIsLeaving  && orderInTx.stockRestored;

      const auditEntry = {
        action: isOverride ? 'STATUS_OVERRIDE' : 'STATUS_CHANGED',
        timestamp: new Date(),
        performedBy: adminUsername,
        note: note || (isOverride
          ? `Owner/Admin manually overrode status from ${txCurrentStatus} to ${newStatus}. Reason: ${overrideReason.trim()}`
          : `Owner/Admin updated status from ${txCurrentStatus} to ${newStatus}`
        ),
        details: {
          previousStatus: txCurrentStatus,
          newStatus,
          ...(isOverride ? { isOverride: true, overrideReason: overrideReason.trim() } : {})
        }
      };

      const casQuery = {
        _id: orderInTx._id,
        __v: orderInTx.__v,
        status: txCurrentStatus
      };
      if (needsRestore) casQuery.stockRestored = false;
      else if (needsDeduct) casQuery.stockRestored = true;

      const casUpdate = {
        $set: {
          status: newStatus,
          ...(needsRestore ? { stockRestored: true }  : {}),
          ...(needsDeduct  ? { stockRestored: false } : {})
        },
        $inc: { __v: 1 },
        $push: { auditHistory: auditEntry }
      };

      const res = await Order.findOneAndUpdate(casQuery, casUpdate, {
        new: true,
        ...sessionOpt
      });

      if (!res) {
        throw new Error('CONCURRENT_CONFLICT: Order was modified concurrently. Please retry.');
      }

      // ─── INVENTORY OPERATIONS (inside the same transaction) ─────────────────
      if (needsRestore) {
        console.log(`[OrderService] [TX] Restoring stock for ${newStatus.toLowerCase()} order ${res.orderCode}`);
        await restoreStockAtomic(res.items, session);
      } else if (needsDeduct) {
        console.log(`[OrderService] [TX] Re-deducting stock for reactivated order ${res.orderCode}`);
        await deductStockAtomic(res.items, session);
      }

      console.log(`[OrderService] [TX] Committed on attempt ${attempt}: order ${res.orderCode} → ${newStatus}`);
      return res;
    });

  } else {
    // ─── NON-TRANSACTION PATH: pure status change (no inventory involved) ───────
    // This path is safe on standalone MongoDB instances.
    // CAS guarantees exactly-once execution without a multi-document transaction.
    const casQuery = {
      _id: preflight._id,
      __v: preflight.__v,
      status: currentStatus
    };

    const auditEntry = {
      action: isOverride ? 'STATUS_OVERRIDE' : 'STATUS_CHANGED',
      timestamp: new Date(),
      performedBy: adminUsername,
      note: note || (isOverride
        ? `Owner/Admin manually overrode status from ${currentStatus} to ${newStatus}. Reason: ${overrideReason.trim()}`
        : `Owner/Admin updated status from ${currentStatus} to ${newStatus}`
      ),
      details: {
        previousStatus: currentStatus,
        newStatus,
        ...(isOverride ? { isOverride: true, overrideReason: overrideReason.trim() } : {})
      }
    };

    const casUpdate = {
      $set: { status: newStatus },
      $inc: { __v: 1 },
      $push: { auditHistory: auditEntry }
    };

    updatedOrder = await Order.findOneAndUpdate(casQuery, casUpdate, { new: true });

    if (!updatedOrder) {
      throw new Error('CONCURRENT_CONFLICT: Order was modified concurrently. Please retry.');
    }

    console.log(`[OrderService] [CAS] Updated: order ${updatedOrder.orderCode} → ${newStatus}`);
  }

  // ─── POST-COMMIT: WebSocket broadcast (non-fatal) ──────────────────────────
  // Runs only after a successful commit, so clients never see a status that
  // was not actually persisted.
  try {
    wsService.broadcastOrderStatus(updatedOrder.orderCode, newStatus, {
      customerName: updatedOrder.customer.fullName,
      updatedAt: updatedOrder.updatedAt
    });
  } catch (wsErr) {
    console.warn(`[OrderService] WebSocket broadcast failed (non-fatal): ${wsErr.message}`);
  }

  return updatedOrder;
}

/**
 * Calculate financial analytics: revenue, realized profit, breakdown.
 * CRITICAL RULE: Realized profit ONLY comes from DELIVERED orders.
 * Cancelled orders do NOT contribute to revenue or realized profit.
 * Realized profit must be exactly revenue - cost (losses remain negative).
 */
export async function getFinancialAnalytics() {
  // Aggregate delivered orders for realized revenue and profit
  const deliveredAggregation = await Order.aggregate([
    { $match: { status: ORDER_STATUS.DELIVERED } },
    { $unwind: '$items' },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: { $multiply: ['$items.unitPrice', '$items.quantity'] } },
        totalCost: { $sum: { $multiply: ['$items.unitCost', '$items.quantity'] } },
        totalDeliveryFees: { $sum: '$deliveryFee' },
        unitsSold: { $sum: '$items.quantity' }
      }
    }
  ]);

  const deliveredMetrics = deliveredAggregation[0] || {
    totalRevenue: 0,
    totalCost: 0,
    totalDeliveryFees: 0,
    unitsSold: 0
  };

  // Realized profit without clamp: legitimate losses remain negative
  const realizedProfit = deliveredMetrics.totalRevenue - deliveredMetrics.totalCost;

  // Status breakdown
  const statusCounts = await Order.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$totalPrice' }
      }
    }
  ]);

  const statusMap = {
    [ORDER_STATUS.PENDING]: 0,
    [ORDER_STATUS.CONFIRMED]: 0,
    [ORDER_STATUS.ON_THE_WAY]: 0,
    [ORDER_STATUS.AT_AGENCY]: 0,
    [ORDER_STATUS.DELIVERED]: 0,
    [ORDER_STATUS.RETURNED]: 0,
    [ORDER_STATUS.CANCELLED]: 0
  };

  statusCounts.forEach(s => {
    statusMap[s._id] = s.count;
  });

  const totalOrdersCount = Object.values(statusMap).reduce((a, b) => a + b, 0);

  return {
    totalOrders: totalOrdersCount,
    statusCounts: statusMap,
    realizedRevenue: deliveredMetrics.totalRevenue,
    realizedProfit: realizedProfit,
    realizedProductCost: deliveredMetrics.totalCost,
    deliveredDeliveryFees: deliveredMetrics.totalDeliveryFees,
    unitsSold: deliveredMetrics.unitsSold
  };
}

/**
 * Update order line items with full transactional stock adjustment, validation,
 * financial recalculation, and audit logging.
 *
 * @param {Object} params
 * @param {string} params.orderId - Order ID to edit
 * @param {Array}  params.newItems - Array of { productId, colorName, size, quantity }
 * @param {number} [params.expectedVersion] - Expected __v for CAS optimistic locking
 * @param {string} [params.adminUsername] - Admin user performing the change
 * @param {string} [params.reason] - Reason for line item edit
 * @returns {Promise<Order>} Updated order
 */
export async function updateOrderItemsService({
  orderId,
  newItems,
  expectedVersion,
  adminUsername = 'Admin',
  reason = 'Admin order item modification'
}) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    const err = new Error('Invalid order ID');
    err.statusCode = 400;
    throw err;
  }

  if (!Array.isArray(newItems) || newItems.length === 0) {
    const err = new Error('Items list must be a non-empty array');
    err.statusCode = 400;
    throw err;
  }

  // Validate item format
  for (let i = 0; i < newItems.length; i++) {
    const it = newItems[i];
    if (!it.productId || !mongoose.Types.ObjectId.isValid(it.productId)) {
      const err = new Error(`Item ${i + 1}: valid productId is required`);
      err.statusCode = 400;
      throw err;
    }
    if (!it.colorName || typeof it.colorName !== 'string' || !it.colorName.trim()) {
      const err = new Error(`Item ${i + 1}: colorName is required`);
      err.statusCode = 400;
      throw err;
    }
    if (!it.size || typeof it.size !== 'string' || !it.size.trim()) {
      const err = new Error(`Item ${i + 1}: size is required`);
      err.statusCode = 400;
      throw err;
    }
    const qty = Number(it.quantity);
    if (!Number.isInteger(qty) || qty <= 0 || !Number.isSafeInteger(qty)) {
      const err = new Error(`Item ${i + 1}: quantity must be a positive whole integer`);
      err.statusCode = 400;
      throw err;
    }
  }

  // Consolidate duplicate variant rows if any
  const consolidatedMap = new Map();
  for (const it of newItems) {
    const key = `${it.productId.toString()}:${it.colorName.trim()}:${it.size.trim()}`;
    const qty = Number(it.quantity);
    if (consolidatedMap.has(key)) {
      const existing = consolidatedMap.get(key);
      existing.quantity += qty;
    } else {
      consolidatedMap.set(key, {
        productId: it.productId.toString(),
        colorName: it.colorName.trim(),
        size: it.size.trim(),
        quantity: qty
      });
    }
  }
  const consolidatedItems = Array.from(consolidatedMap.values());

  const updatedOrder = await withTransactionRetry(async (session) => {
    const sessionOpt = session ? { session } : {};

    // 1. Fetch order inside transaction
    const order = await Order.findById(orderId, null, sessionOpt);
    if (!order) {
      const err = new Error('Order not found');
      err.statusCode = 404;
      throw err;
    }

    // 2. Concurrency check (CAS)
    if (expectedVersion !== undefined && order.__v !== Number(expectedVersion)) {
      const err = new Error('CONCURRENT_CONFLICT: Order was modified concurrently. Please refresh and retry.');
      err.statusCode = 409;
      err.code = 'CONCURRENT_CONFLICT';
      throw err;
    }

    // 3. Status checks
    if (order.status === ORDER_STATUS.DELIVERED) {
      const err = new Error('Historical financial values and items cannot be modified on Delivered orders.');
      err.statusCode = 400;
      throw err;
    }
    if (order.status === ORDER_STATUS.CANCELLED) {
      const err = new Error('Cannot modify items on a Cancelled order.');
      err.statusCode = 400;
      throw err;
    }
    if (order.stockRestored === true) {
      const err = new Error('Order stock is marked as restored; cannot modify active line items.');
      err.statusCode = 400;
      throw err;
    }

    // 4. Validate all requested products and variants exist and are active
    const uniqueProductIds = [...new Set(consolidatedItems.map(it => it.productId))];
    const products = await Product.find({ _id: { $in: uniqueProductIds } }, null, sessionOpt);
    const productMap = new Map(products.map(p => [p._id.toString(), p]));

    for (const it of consolidatedItems) {
      const prod = productMap.get(it.productId);
      if (!prod) {
        const err = new Error(`Product ${it.productId} not found`);
        err.statusCode = 400;
        throw err;
      }
      if (!prod.isActive || prod.isArchived) {
        const err = new Error(`Product "${prod.name}" is inactive or archived`);
        err.statusCode = 400;
        throw err;
      }
      const colorObj = prod.colors?.find(c => c.colorName.toLowerCase() === it.colorName.toLowerCase());
      if (!colorObj) {
        const err = new Error(`Color "${it.colorName}" does not exist for product "${prod.name}"`);
        err.statusCode = 400;
        throw err;
      }
      const sizeObj = colorObj.sizes?.find(s => s.size === it.size);
      if (!sizeObj) {
        const err = new Error(`Size "${it.size}" does not exist for color "${it.colorName}" in product "${prod.name}"`);
        err.statusCode = 400;
        throw err;
      }
    }

    // 5. Calculate net delta per variant:
    // deltaMap: key -> net quantity change (positive = deduct more stock, negative = release stock)
    const deltaMap = new Map();

    // Old items currently deducted (release them)
    for (const oldIt of order.items) {
      const key = `${oldIt.productId.toString()}:${oldIt.colorName}:${oldIt.size}`;
      deltaMap.set(key, (deltaMap.get(key) || 0) - oldIt.quantity);
    }

    // New items to be deducted
    for (const newIt of consolidatedItems) {
      const key = `${newIt.productId}:${newIt.colorName}:${newIt.size}`;
      deltaMap.set(key, (deltaMap.get(key) || 0) + newIt.quantity);
    }

    // 6. Apply atomic stock modifications
    for (const [key, netDelta] of deltaMap.entries()) {
      if (netDelta === 0) continue; // Unchanged variant quantity

      const [pId, cName, sVal] = key.split(':');

      if (netDelta > 0) {
        // Need to deduct additional netDelta units atomically with conditional $gte
        const updatedProduct = await Product.findOneAndUpdate(
          {
            _id: pId,
            isActive: true,
            isArchived: false,
            colors: {
              $elemMatch: {
                colorName: cName,
                sizes: {
                  $elemMatch: {
                    size: sVal,
                    stock: { $gte: netDelta }
                  }
                }
              }
            }
          },
          {
            $inc: { 'colors.$[c].sizes.$[s].stock': -netDelta }
          },
          {
            session,
            new: true,
            arrayFilters: [
              { 'c.colorName': cName },
              { 's.size': sVal }
            ]
          }
        );

        if (!updatedProduct) {
          const prod = productMap.get(pId) || await Product.findById(pId, null, sessionOpt);
          const err = new Error(`Insufficient stock for "${prod?.name || pId}" (${cName} - Size ${sVal}). Required additional: ${netDelta}`);
          err.statusCode = 400;
          throw err;
        }
      } else if (netDelta < 0) {
        // Need to restore Math.abs(netDelta) units back into stock
        const restoreUnits = Math.abs(netDelta);
        const restoredProduct = await Product.findOneAndUpdate(
          {
            _id: pId,
            'colors.colorName': cName,
            'colors.sizes.size': sVal
          },
          {
            $inc: { 'colors.$[c].sizes.$[s].stock': restoreUnits }
          },
          {
            session,
            new: true,
            arrayFilters: [
              { 'c.colorName': cName },
              { 's.size': sVal }
            ]
          }
        );

        if (!restoredProduct) {
          const err = new Error(`Failed to restore inventory for ${cName} - Size ${sVal}`);
          err.statusCode = 500;
          throw err;
        }
      }
    }

    // 7. Construct fresh authoritative item snapshots
    const previousItems = order.items.map(it => it.toObject());
    const previousSubtotal = order.subtotal;
    const previousDeliveryFee = order.deliveryFee;
    const previousTotalPrice = order.totalPrice;

    const snapshotItems = consolidatedItems.map(it => {
      const prod = productMap.get(it.productId);
      const colorObj = prod.colors.find(c => c.colorName.toLowerCase() === it.colorName.toLowerCase());
      return {
        productId: prod._id,
        productName: prod.name,
        colorName: colorObj.colorName,
        colorCode: colorObj.colorCode,
        size: it.size,
        quantity: it.quantity,
        unitPrice: prod.sellingPrice,
        unitCost: prod.costPrice,
        image: colorObj.images?.[0] || ''
      };
    });

    const newSubtotal = snapshotItems.reduce((acc, it) => acc + (it.unitPrice * it.quantity), 0);

    // 8. Authoritative delivery fee check (e.g. Free Delivery Threshold)
    let newDeliveryFee = order.deliveryFee;
    const deliverySetting = await DeliverySetting.findOne(null, null, sessionOpt);
    if (deliverySetting?.freeDeliveryThreshold && deliverySetting.freeDeliveryThreshold > 0) {
      if (newSubtotal >= deliverySetting.freeDeliveryThreshold) {
        newDeliveryFee = 0;
      } else if (order.deliveryFee === 0 && previousSubtotal >= deliverySetting.freeDeliveryThreshold) {
        // Subtotal dropped below free threshold: recalculate authoritative fee
        const targetCode = Number(order.customer.wilaya?.code);
        const wilayaRate = deliverySetting.wilayaRates?.find(r => r.wilayaCode === targetCode);
        if (!wilayaRate || wilayaRate.isAvailable === false) {
          const err = new Error(`Delivery configuration missing or unavailable for Wilaya ${targetCode}`);
          err.statusCode = 400;
          err.code = 'DELIVERY_CONFIGURATION_MISSING';
          throw err;
        }
        const isAgency = order.customer.deliveryMethod === DELIVERY_METHODS.AGENCY;
        const configuredFee = isAgency ? wilayaRate.agencyFee : wilayaRate.homeFee;
        if (typeof configuredFee !== 'number' || !Number.isInteger(configuredFee) || configuredFee < 0) {
          const err = new Error(`Authoritative delivery fee is not configured for Wilaya ${targetCode} with method "${order.customer.deliveryMethod}".`);
          err.statusCode = 400;
          err.code = 'DELIVERY_FEE_NOT_CONFIGURED';
          throw err;
        }
        newDeliveryFee = configuredFee;
      }
    }

    const newTotalPrice = newSubtotal + newDeliveryFee;

    // 9. Append audit log
    const auditEntry = {
      action: 'LINE_ITEMS_UPDATED',
      timestamp: new Date(),
      performedBy: adminUsername,
      note: `Admin modified order line items. (Subtotal: ${previousSubtotal} -> ${newSubtotal} DZD, Total: ${previousTotalPrice} -> ${newTotalPrice} DZD). ${reason ? `Reason: ${reason.trim()}` : ''}`,
      details: {
        previousItems,
        updatedItems: snapshotItems,
        previousSubtotal,
        updatedSubtotal: newSubtotal,
        previousDeliveryFee,
        updatedDeliveryFee: newDeliveryFee,
        previousTotalPrice,
        updatedTotalPrice: newTotalPrice,
        reason: reason?.trim() || null
      }
    };

    order.items = snapshotItems;
    order.subtotal = newSubtotal;
    order.deliveryFee = newDeliveryFee;
    order.totalPrice = newTotalPrice;
    order.auditHistory.push(auditEntry);

    try {
      await order.save({ session });
    } catch (saveErr) {
      if (saveErr.name === 'VersionError') {
        const err = new Error('CONCURRENT_CONFLICT: Order was modified concurrently. Please refresh and retry.');
        err.statusCode = 409;
        err.code = 'CONCURRENT_CONFLICT';
        throw err;
      }
      throw saveErr;
    }
    return order;
  });

  // 10. Broadcast real-time notifications
  try {
    if (updatedOrder?.orderCode && typeof wsService.broadcastOrderUpdate === 'function') {
      wsService.broadcastOrderUpdate(updatedOrder.orderCode, updatedOrder);
    }
  } catch (wsErr) {
    console.warn('[OrderService] Non-critical WS notification failed:', wsErr.message);
  }

  return updatedOrder;
}
