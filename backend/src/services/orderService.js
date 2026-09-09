import { Order } from '../models/Order.js';
import { Product } from '../models/Product.js';
import { DeliverySetting } from '../models/DeliverySetting.js';
import { ORDER_STATUS, VALID_STATUS_TRANSITIONS, DELIVERY_METHODS } from '../config/constants.js';
import { generateOrderCode } from '../utils/orderCode.js';
import { deductStockAtomic, restoreStockAtomic } from './inventoryService.js';
import { wsService } from './websocketService.js';

/**
 * Place a new order with full database validation and atomic inventory deduction.
 */
export async function placeOrder({ customer, items, idempotencyKey }) {
  // 1. Check idempotency if key provided
  if (idempotencyKey) {
    const existingOrder = await Order.findOne({ idempotencyKey });
    if (existingOrder) {
      console.log(`[OrderService] Duplicate submission caught via idempotency key: ${idempotencyKey}`);
      return { order: existingOrder, isDuplicate: true };
    }
  }

  if (!items || items.length === 0) {
    throw new Error('Order must contain at least one item');
  }

  // 2. Authoritative Database Item Verification & Snapshots
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

  // 3. Dynamic Delivery Fee calculation from database (per-Wilaya rates)
  let deliverySetting = await DeliverySetting.findOne();
  if (!deliverySetting) {
    deliverySetting = await DeliverySetting.create({ agencyDeliveryFee: 500, homeDeliveryFee: 800 });
  }

  let wilayaRate = null;
  if (customer.wilaya) {
    const wStr = String(customer.wilaya).trim().toLowerCase();
    wilayaRate = deliverySetting.wilayaRates?.find(r => 
      String(r.wilayaCode) === wStr ||
      r.wilayaName.toLowerCase() === wStr ||
      (r.wilayaNameAr && r.wilayaNameAr === wStr) ||
      wStr.includes(r.wilayaName.toLowerCase())
    );
  }

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

  // 4. Atomic Inventory Deduction
  await deductStockAtomic(items);

  // 5. Generate secure order tracking code
  let orderCode;
  let codeExists = true;
  while (codeExists) {
    orderCode = generateOrderCode();
    const found = await Order.findOne({ orderCode });
    if (!found) codeExists = false;
  }

  // 6. Create Order Document
  const order = new Order({
    orderCode,
    idempotencyKey,
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

  // 7. Real-time WebSocket Broadcast to Admin
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

  // Validate state machine unless owner/admin override is enabled
  if (!isOverride) {
    const allowedTransitions = VALID_STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowedTransitions.includes(newStatus)) {
      throw new Error(`Cannot transition order from status "${currentStatus}" to "${newStatus}"`);
    }
  }

  // Stock inventory management on status changes:
  // 1. Moving to CANCELLED: restore reserved stock (only if not already restored)
  if (newStatus === ORDER_STATUS.CANCELLED && !order.stockRestored) {
    console.log(`[OrderService] Restoring stock for cancelled order ${order.orderCode}`);
    await restoreStockAtomic(order.items);
    order.stockRestored = true;
  } 
  // 2. Moving from CANCELLED to active status: re-deduct stock if previously restored
  else if (currentStatus === ORDER_STATUS.CANCELLED && newStatus !== ORDER_STATUS.CANCELLED && order.stockRestored) {
    console.log(`[OrderService] Re-deducting stock for reactivated order ${order.orderCode}`);
    try {
      await deductStockAtomic(order.items);
      order.stockRestored = false;
    } catch (err) {
      console.warn(`[OrderService] Re-deducting stock note: ${err.message}`);
      order.stockRestored = false;
    }
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
