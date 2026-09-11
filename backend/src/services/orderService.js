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
 */
export function computeOrderFingerprint({ customer, items }) {
  let normPhone = '';
  try {
    normPhone = normalizeAlgerianPhone(String(customer?.phone || ''));
  } catch {
    normPhone = String(customer?.phone || '').trim();
  }

  const wilayaCode = Number(typeof customer?.wilaya === 'object' ? customer?.wilaya?.code : customer?.wilaya);
  const deliveryMethod = String(customer?.deliveryMethod || '').trim().toLowerCase();

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
    wilayaCode,
    deliveryMethod,
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
 * Transition Order Status safely with validation and inventory management.
 * Admin/Owner has authoritative control to transition any order to any valid status.
 */
export async function updateOrderStatus(orderId, newStatus, adminUsername = 'Admin', note = '', isOverride = false) {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new Error('Order not found');
  }

  const validStatuses = Object.values(ORDER_STATUS);
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Invalid order status "${newStatus}". Must be one of: ${validStatuses.join(', ')}`);
  }

  const currentStatus = order.status;
  if (currentStatus === newStatus) {
    return order;
  }

  // CRITICAL INVARIANT: Delivered orders can NEVER be transitioned to Cancelled or Returned (even with override)
  if (currentStatus === ORDER_STATUS.DELIVERED) {
    throw new Error('Cannot transition order: Terminal state violation: Delivered orders cannot be transitioned to Cancelled or Returned.');
  }

  // Validate state machine unless owner/admin override is enabled
  if (!isOverride) {
    const allowedTransitions = VALID_STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowedTransitions.includes(newStatus)) {
      throw new Error(`Cannot transition order from status "${currentStatus}" to "${newStatus}"`);
    }
  }

  // Stock inventory management on status changes:
  // 1. Moving to CANCELLED or RETURNED: restore reserved stock (only if not already restored)
  const isEnteringRestoredState = newStatus === ORDER_STATUS.CANCELLED || newStatus === ORDER_STATUS.RETURNED;
  const isLeavingRestoredState = (currentStatus === ORDER_STATUS.CANCELLED || currentStatus === ORDER_STATUS.RETURNED) && !isEnteringRestoredState;

  if (isEnteringRestoredState && !order.stockRestored) {
    console.log(`[OrderService] Restoring stock for ${newStatus.toLowerCase()} order ${order.orderCode}`);
    await restoreStockAtomic(order.items);
    order.stockRestored = true;
  } 
  // 2. Moving from CANCELLED/RETURNED to active status: re-deduct stock if previously restored
  else if (isLeavingRestoredState && order.stockRestored) {
    console.log(`[OrderService] Re-deducting stock for reactivated order ${order.orderCode}`);
    // STRICT INVARIANT: If stock cannot be deducted (insufficient stock), this throws an Error!
    // order.status and order.stockRestored are NOT modified. Order remains in previous state.
    await deductStockAtomic(order.items);
    order.stockRestored = false;
  }

  order.status = newStatus;
  order.auditHistory.push({
    action: 'STATUS_CHANGED',
    timestamp: new Date(),
    performedBy: adminUsername,
    note: note || `Owner/Admin updated status from ${currentStatus} to ${newStatus}`,
    details: { previousStatus: currentStatus, newStatus }
  });

  await order.save();

  // Broadcast to customer tracking page and admin
  wsService.broadcastOrderStatus(order.orderCode, newStatus, {
    customerName: order.customer.fullName,
    updatedAt: order.updatedAt
  });

  return order;
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
