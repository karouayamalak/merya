import crypto from 'crypto';
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
    const normName = name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const canonicalNorm = canonicalWilaya.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const matchesEn = canonicalNorm === normName || (codeNum === 16 && (normName === 'alger' || normName === 'algiers'));
    const matchesAr = canonicalWilaya.nameAr === name.trim();
    if (!matchesEn && !matchesAr) {
      throw new Error(`Wilaya mismatch: code ${codeNum} is "${canonicalWilaya.name}", but received "${name}".`);
    }
  }

  let deliverySetting = await DeliverySetting.findOne();
  if (!deliverySetting) {
    deliverySetting = await DeliverySetting.create({ agencyDeliveryFee: 500, homeDeliveryFee: 800 });
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

  // 3. Authoritative Database Item Verification & Snapshots
  const itemSnapshots = [];
  let subtotal = 0;

  for (const item of items) {
    const { productId, colorName, size, quantity } = item;

    if (!productId || !colorName || !size || !quantity || quantity <= 0) {
      throw new Error('Invalid item parameters');
    }

    const product = await Product.findOne({ _id: productId, isActive: true, isArchived: false });
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

  // 5. Atomic Inventory Deduction with Order Creation Rollback
  await deductStockAtomic(items);

  let order;
  try {
    // Generate secure order tracking code
    let orderCode;
    let codeExists = true;
    while (codeExists) {
      orderCode = generateOrderCode();
      const found = await Order.findOne({ orderCode });
      if (!found) codeExists = false;
    }

    // Create Order Document with snapshot and fingerprint
    order = new Order({
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

    await order.save();
  } catch (saveError) {
    // Roll back deducted stock immediately if order persistence fails for any reason
    console.error(`[OrderService] Order save failed: ${saveError.message}. Rolling back inventory deduction.`);
    await restoreStockAtomic(items);

    // Handle race condition where another concurrent request with the same idempotency key saved first
    if (saveError.code === 11000 && idempotencyKey) {
      const existingOrder = await Order.findOne({ idempotencyKey });
      if (existingOrder) {
        if (existingOrder.idempotencyFingerprint && existingOrder.idempotencyFingerprint !== currentFingerprint) {
          throw new Error('IDEMPOTENCY_CONFLICT: Idempotency key reused with different request payload');
        }
        console.log(`[OrderService] Concurrent duplicate order caught via unique idempotencyKey index: ${idempotencyKey}`);
        return { order: existingOrder, isDuplicate: true };
      }
    }

    throw saveError;
  }

  // 6. Real-time WebSocket Broadcast to Admin (safe, non-fatal)
  wsService.broadcastNewOrder(order);

  return { order, isDuplicate: false };
}

/**
 * Atomically transition order status using optimistic concurrency control.
 *
 * INVARIANTS:
 *   - Exactly ONE stock restoration per order when entering Cancelled/Returned.
 *   - Exactly ONE stock deduction per order when leaving Cancelled/Returned.
 *   - Concurrent duplicate requests: exactly one succeeds; others get a 409-style error.
 *   - If the inventory op fails after the order CAS, the order CAS is rolled back.
 *   - Delivered orders are TERMINAL — no transition possible, even with override.
 *
 * Strategy:
 *   Phase 1: Atomic conditional findOneAndUpdate on the Order document.
 *            Conditions: correct _id AND current status AND correct __v (version) AND correct stockRestored.
 *            This is the CAS. Only ONE concurrent request can win.
 *   Phase 2: Perform the inventory operation (restore/deduct).
 *            If inventory op throws, roll back the order to its previous state.
 */
export async function updateOrderStatus(orderId, newStatus, adminUsername = 'Admin', note = '', isOverride = false) {
  const validStatuses = Object.values(ORDER_STATUS);
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Invalid order status "${newStatus}". Must be one of: ${validStatuses.join(', ')}`);
  }

  // Read current order state
  const order = await Order.findById(orderId);
  if (!order) {
    throw new Error('Order not found');
  }

  const currentStatus = order.status;
  if (currentStatus === newStatus) {
    if (!isOverride) {
      throw new Error(`Cannot transition order: Order is already in status "${newStatus}"`);
    }
    return order; // No-op, idempotent admin override
  }

  // HARD INVARIANT: Delivered is a terminal state — no override can change this
  if (currentStatus === ORDER_STATUS.DELIVERED) {
    throw new Error('Cannot transition order: Terminal state violation: Delivered orders cannot be transitioned.');
  }

  // Validate state machine unless admin override
  if (!isOverride) {
    const allowedTransitions = VALID_STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowedTransitions.includes(newStatus)) {
      throw new Error(`Cannot transition order from status "${currentStatus}" to "${newStatus}"`);
    }
  }

  // Determine if this transition requires an inventory operation
  const isEnteringRestoredState = newStatus === ORDER_STATUS.CANCELLED || newStatus === ORDER_STATUS.RETURNED;
  const isLeavingRestoredState = (
    currentStatus === ORDER_STATUS.CANCELLED || currentStatus === ORDER_STATUS.RETURNED
  ) && !isEnteringRestoredState;

  const needsRestore = isEnteringRestoredState && !order.stockRestored;
  const needsDeduct = isLeavingRestoredState && order.stockRestored;

  const auditEntry = {
    action: 'STATUS_CHANGED',
    timestamp: new Date(),
    performedBy: adminUsername,
    note: note || `Owner/Admin updated status from ${currentStatus} to ${newStatus}`,
    details: { previousStatus: currentStatus, newStatus }
  };

  // ─── PHASE 1: Atomic Optimistic-Lock CAS on the Order ────────────────────────
  // Build the conditional query. The __v check (version key) ensures that if
  // two concurrent requests both read the same document, only one can win the
  // update. The second sees a mismatched __v and gets null.
  const casQuery = {
    _id: order._id,
    __v: order.__v,          // Optimistic lock — must match the version we read
    status: currentStatus    // Must still be in the state we read
  };

  // Also lock on stockRestored when we care about it, for extra safety
  if (needsRestore) {
    casQuery.stockRestored = false; // Only win if stock has NOT been restored yet
  } else if (needsDeduct) {
    casQuery.stockRestored = true;  // Only win if stock HAS been restored
  }

  const casUpdate = {
    $set: {
      status: newStatus,
      ...(needsRestore ? { stockRestored: true } : {}),
      ...(needsDeduct  ? { stockRestored: false } : {})
    },
    $inc: { __v: 1 },      // Increment version to invalidate any concurrent CAS
    $push: { auditHistory: auditEntry }
  };

  const updatedOrder = await Order.findOneAndUpdate(casQuery, casUpdate, { new: true });

  if (!updatedOrder) {
    // Another concurrent request won the race, or the document was modified.
    // Return a specific error that the controller can surface as 409.
    throw new Error('CONCURRENT_CONFLICT: Order was modified concurrently. Please retry.');
  }

  // ─── PHASE 2: Inventory operation (after successful CAS) ─────────────────────
  // If this fails, we MUST roll back the order to its previous state.
  if (needsRestore) {
    try {
      console.log(`[OrderService] Restoring stock for ${newStatus.toLowerCase()} order ${updatedOrder.orderCode}`);
      await restoreStockAtomic(updatedOrder.items);
    } catch (inventoryErr) {
      // Roll back the order CAS only if the order still matches the exact state produced by this CAS.
      // If another concurrent request has since modified the order (__v or status mismatch),
      // we must NOT blindly overwrite the newer order state.
      console.error(`[OrderService] Stock restoration failed for ${updatedOrder.orderCode}: ${inventoryErr.message}. Attempting conditional rollback.`);
      const rolledBackOrder = await Order.findOneAndUpdate(
        {
          _id: updatedOrder._id,
          __v: updatedOrder.__v,
          status: newStatus,
          stockRestored: true
        },
        {
          $set: { status: currentStatus, stockRestored: false },
          $inc: { __v: 1 },
          $push: {
            auditHistory: {
              action: 'STATUS_ROLLBACK',
              timestamp: new Date(),
              performedBy: 'SYSTEM',
              note: `Automatic rollback: stock restoration failed — ${inventoryErr.message}`,
              details: { attemptedStatus: newStatus, revertedTo: currentStatus }
            }
          }
        },
        { new: true }
      );
      if (!rolledBackOrder) {
        console.warn(`[OrderService] Concurrency safety: Rollback skipped for order ${updatedOrder.orderCode}. The order was already modified or claimed by a concurrent transition.`);
      }
      throw inventoryErr;
    }
  } else if (needsDeduct) {
    try {
      console.log(`[OrderService] Re-deducting stock for reactivated order ${updatedOrder.orderCode}`);
      await deductStockAtomic(updatedOrder.items);
    } catch (inventoryErr) {
      // Roll back the order CAS only if the order still matches the exact state produced by this CAS.
      console.error(`[OrderService] Stock deduction failed for ${updatedOrder.orderCode}: ${inventoryErr.message}. Attempting conditional rollback.`);
      const rolledBackOrder = await Order.findOneAndUpdate(
        {
          _id: updatedOrder._id,
          __v: updatedOrder.__v,
          status: newStatus,
          stockRestored: false
        },
        {
          $set: { status: currentStatus, stockRestored: true },
          $inc: { __v: 1 },
          $push: {
            auditHistory: {
              action: 'STATUS_ROLLBACK',
              timestamp: new Date(),
              performedBy: 'SYSTEM',
              note: `Automatic rollback: stock deduction failed — ${inventoryErr.message}`,
              details: { attemptedStatus: newStatus, revertedTo: currentStatus }
            }
          }
        },
        { new: true }
      );
      if (!rolledBackOrder) {
        console.warn(`[OrderService] Concurrency safety: Rollback skipped for order ${updatedOrder.orderCode}. The order was already modified or claimed by a concurrent transition.`);
      }
      throw inventoryErr;
    }
  }

  // Broadcast to customer tracking page and admin
  wsService.broadcastOrderStatus(updatedOrder.orderCode, newStatus, {
    customerName: updatedOrder.customer.fullName,
    updatedAt: updatedOrder.updatedAt
  });

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
    { $unwind: "$items" },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: { $multiply: ["$items.unitPrice", "$items.quantity"] } },
        totalCost: { $sum: { $multiply: ["$items.unitCost", "$items.quantity"] } },
        totalDeliveryFees: { $sum: "$deliveryFee" },
        unitsSold: { $sum: "$items.quantity" }
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
        _id: "$status",
        count: { $sum: 1 },
        totalAmount: { $sum: "$totalPrice" }
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
