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

  // 1. Strict Canonical Wilaya Verification & Availability Check
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

  let deliverySetting = await DeliverySetting.findOne();
  if (!deliverySetting) {
    const defaultRates = ALGERIA_WILAYAS.map(w => ({
      wilayaCode: w.code,
      wilayaName: w.name,
      wilayaNameAr: w.nameAr,
      homeFee: 800,
      agencyFee: 500,
      isAvailable: true
    }));
    deliverySetting = await DeliverySetting.create({
      agencyDeliveryFee: 500,
      homeDeliveryFee: 800,
      wilayaRates: defaultRates
    });
  }

  const wilayaRate = deliverySetting.wilayaRates?.find(r => r.wilayaCode === codeNum);
  if (!wilayaRate) {
    throw new Error(`Delivery configuration missing for Wilaya ${codeNum} (${canonicalWilaya.name})`);
  }

  if (wilayaRate.isAvailable === false) {
    throw new Error(`Wilaya ${codeNum} (${canonicalWilaya.name}) is currently unavailable for delivery.`);
  }

  // 2. Check idempotency with deterministic fingerprint
  const currentFingerprint = computeOrderFingerprint({ customer, items });

  // Early idempotency check outside session (fast path)
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

  // ─── CHECKOUT TRANSACTION ──────────────────────────────────────────────────
  // Order creation and all inventory deductions occur within a single session.
  // Either ALL commit or ALL abort. No manual inventory compensation is used.
  const session = await mongoose.startSession();
  let createdOrder = null;

  try {
    session.startTransaction();

    // Re-check idempotency inside transaction for concurrency safety
    if (idempotencyKey) {
      const existingInTx = await Order.findOne({ idempotencyKey }).session(session);
      if (existingInTx) {
        if (existingInTx.idempotencyFingerprint && existingInTx.idempotencyFingerprint !== currentFingerprint) {
          throw new Error('IDEMPOTENCY_CONFLICT: Idempotency key reused with different request payload');
        }
        await session.abortTransaction();
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

      const product = await Product.findOne({ _id: productId, isActive: true, isArchived: false }).session(session);
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
    let deliveryFee = 0;
    if (customer.deliveryMethod === DELIVERY_METHODS.AGENCY) {
      deliveryFee = wilayaRate ? wilayaRate.agencyFee : deliverySetting.agencyDeliveryFee;
    } else if (customer.deliveryMethod === DELIVERY_METHODS.HOME) {
      deliveryFee = wilayaRate ? wilayaRate.homeFee : deliverySetting.homeDeliveryFee;
    } else {
      throw new Error('Invalid delivery method');
    }

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
      const found = await Order.findOne({ orderCode }).session(session);
      if (!found) codeExists = false;
    }

    // 7. Create Order Document with snapshot and fingerprint inside session
    createdOrder = new Order({
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

    await createdOrder.save({ session });

    await session.commitTransaction();
    console.log(`[OrderService] [TX] Checkout committed successfully: order ${createdOrder.orderCode}`);

  } catch (err) {
    try {
      await session.abortTransaction();
    } catch (abortErr) {
      console.error(`[OrderService] [TX] Checkout abortTransaction failed: ${abortErr.message}`);
    }

    // Handle race condition where another concurrent transaction with the same idempotency key won/committed
    if (idempotencyKey) {
      let existingOrder = await Order.findOne({ idempotencyKey });
      if (!existingOrder) {
        // Brief pause in case the winner is in the middle of commitTransaction
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
  } finally {
    session.endSession();
  }

  // 8. Real-time WebSocket Broadcast to Admin (only after successful commit)
  try {
    wsService.broadcastNewOrder(createdOrder);
  } catch (wsErr) {
    console.warn(`[OrderService] WebSocket broadcastNewOrder failed (non-fatal): ${wsErr.message}`);
  }

  return { order: createdOrder, isDuplicate: false };
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
    // ─── TRANSACTION PATH: inventory-touching transition ────────────────────────
    // All reads and writes happen inside a single MongoDB session so they either
    // ALL commit or ALL abort. No compensating rollback is needed or performed.
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      // Re-read inside transaction to establish a consistent read snapshot.
      const orderInTx = await Order.findById(orderId).session(session);
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

      updatedOrder = await Order.findOneAndUpdate(casQuery, casUpdate, {
        new: true,
        session
      });

      if (!updatedOrder) {
        throw new Error('CONCURRENT_CONFLICT: Order was modified concurrently. Please retry.');
      }

      // ─── INVENTORY OPERATIONS (inside the same transaction) ─────────────────
      if (needsRestore) {
        console.log(`[OrderService] [TX] Restoring stock for ${newStatus.toLowerCase()} order ${updatedOrder.orderCode}`);
        await restoreStockAtomic(updatedOrder.items, session);
      } else if (needsDeduct) {
        console.log(`[OrderService] [TX] Re-deducting stock for reactivated order ${updatedOrder.orderCode}`);
        await deductStockAtomic(updatedOrder.items, session);
      }

      await session.commitTransaction();
      console.log(`[OrderService] [TX] Committed: order ${updatedOrder.orderCode} → ${newStatus}`);

    } catch (err) {
      try { await session.abortTransaction(); } catch (abortErr) {
        console.error(`[OrderService] [TX] abortTransaction failed: ${abortErr.message}`);
      }
      throw err;
    } finally {
      session.endSession();
    }

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

  const realizedProfit = Math.max(0, deliveredMetrics.totalRevenue - deliveredMetrics.totalCost);

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
