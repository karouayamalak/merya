import mongoose from 'mongoose';
import { Order } from '../../models/Order.js';
import { Product } from '../../models/Product.js';
import { DeliverySetting } from '../../models/DeliverySetting.js';
import { ORDER_STATUS, DELIVERY_METHODS } from '../../config/constants.js';
import { wsService } from '../websocketService.js';
import { withTransactionRetry } from '../../utils/transactionRetry.js';

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
  reason,
  priceOverride = false,
  priceOverrideReason = ''
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
      if (it.unitPrice !== undefined && existing.unitPrice === undefined) {
        existing.unitPrice = it.unitPrice;
      }
    } else {
      consolidatedMap.set(key, {
        productId: it.productId.toString(),
        colorName: it.colorName.trim(),
        size: it.size.trim(),
        quantity: qty,
        unitPrice: it.unitPrice !== undefined ? it.unitPrice : undefined
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

    // 2. Concurrency check (CAS) — expectedVersion is pre-validated as an integer by the controller
    if (expectedVersion !== undefined && order.__v !== expectedVersion) {
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

    // 3b. Reason validation — must have a non-empty reason to proceed with any modification
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      const err = new Error('A valid reason is required for admin order item modifications.');
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

    // 5. Calculate net delta per variant
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
      if (netDelta === 0) continue;

      const [pId, cName, sVal] = key.split(':');

      if (netDelta > 0) {
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
            $inc: {
              'colors.$[c].sizes.$[s].stock': -netDelta,
              __v: 1
            }
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
        const restoreUnits = Math.abs(netDelta);
        const restoredProduct = await Product.findOneAndUpdate(
          {
            _id: pId,
            'colors.colorName': cName,
            'colors.sizes.size': sVal
          },
          {
            $inc: {
              'colors.$[c].sizes.$[s].stock': restoreUnits,
              __v: 1
            }
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

    // 7. Construct fresh authoritative item snapshots with historical price protection
    const previousItems = order.items.map(it => it.toObject());
    const previousSubtotal = order.subtotal;
    const previousDeliveryFee = order.deliveryFee;
    const previousTotalPrice = order.totalPrice;

    const previousItemMap = new Map();
    for (const oldIt of order.items) {
      const key = `${oldIt.productId.toString()}:${oldIt.colorName.toLowerCase()}:${oldIt.size}`;
      previousItemMap.set(key, oldIt);
    }

    const priceChanges = [];

    const snapshotItems = consolidatedItems.map(it => {
      const prod = productMap.get(it.productId);
      const colorObj = prod.colors.find(c => c.colorName.toLowerCase() === it.colorName.toLowerCase());
      const key = `${it.productId}:${it.colorName.toLowerCase()}:${it.size}`;
      const existingOrderItem = previousItemMap.get(key);

      let unitPrice;
      let unitCost;

      if (existingOrderItem) {
        if (it.unitPrice !== undefined) {
          const explicitPrice = Number(it.unitPrice);
          if (!Number.isInteger(explicitPrice) || explicitPrice <= 0 || !Number.isSafeInteger(explicitPrice)) {
            const err = new Error(`Explicit unitPrice for "${prod.name}" must be a positive integer in DZD.`);
            err.statusCode = 400;
            throw err;
          }
          if (explicitPrice !== existingOrderItem.unitPrice) {
            if (priceOverride !== true) {
              const err = new Error(
                `Price override for "${prod.name}" (${it.colorName}, ${it.size}) requires priceOverride: true. ` +
                `Historical price: ${existingOrderItem.unitPrice} DZD → Requested: ${explicitPrice} DZD. ` +
                `Pass priceOverride: true and a non-empty priceOverrideReason to confirm this intentional change.`
              );
              err.statusCode = 400;
              err.code = 'PRICE_OVERRIDE_REQUIRED';
              throw err;
            }
            if (!priceOverrideReason || typeof priceOverrideReason !== 'string' || !priceOverrideReason.trim()) {
              const err = new Error(
                `A non-empty priceOverrideReason is required when overriding historical price for "${prod.name}".`
              );
              err.statusCode = 400;
              err.code = 'PRICE_OVERRIDE_REASON_REQUIRED';
              throw err;
            }
            if (priceOverrideReason.trim().length > 500) {
              const err = new Error('priceOverrideReason cannot exceed 500 characters.');
              err.statusCode = 400;
              throw err;
            }
            const resolvedName = typeof prod.name === 'object' && prod.name ? (prod.name.fr || prod.name.en || prod.name.ar || 'Product') : String(prod.name || 'Product');
            priceChanges.push({
              productId: prod._id,
              productName: resolvedName,
              colorName: colorObj.colorName,
              size: it.size,
              previousPrice: existingOrderItem.unitPrice,
              newPrice: explicitPrice,
              priceOverrideReason: priceOverrideReason.trim()
            });
          }
          unitPrice = explicitPrice;
        } else {
          unitPrice = existingOrderItem.unitPrice;
        }
        unitCost = existingOrderItem.unitCost ?? prod.costPrice;
      } else {
        const resolvedName = typeof prod.name === 'object' && prod.name ? (prod.name.fr || prod.name.en || prod.name.ar || 'Product') : String(prod.name || 'Product');
        const authoritativePrice = (prod.promotion && prod.promotion.active && typeof prod.promotion.promotionalPrice === 'number' && prod.promotion.promotionalPrice > 0 && prod.promotion.promotionalPrice < prod.sellingPrice)
          ? prod.promotion.promotionalPrice
          : prod.sellingPrice;

        if (it.unitPrice !== undefined) {
          const explicitPrice = Number(it.unitPrice);
          if (!Number.isInteger(explicitPrice) || explicitPrice <= 0 || !Number.isSafeInteger(explicitPrice)) {
            const err = new Error(`Explicit unitPrice for "${resolvedName}" must be a positive integer in DZD.`);
            err.statusCode = 400;
            throw err;
          }

          if (explicitPrice !== authoritativePrice) {
            if (priceOverride !== true) {
              const err = new Error(
                `Price override for new item "${resolvedName}" (${it.colorName}, ${it.size}) requires priceOverride: true. ` +
                `Authoritative price: ${authoritativePrice} DZD → Requested: ${explicitPrice} DZD. ` +
                `Pass priceOverride: true and a non-empty priceOverrideReason to confirm this intentional change.`
              );
              err.statusCode = 400;
              err.code = 'PRICE_OVERRIDE_REQUIRED';
              throw err;
            }
            if (!priceOverrideReason || typeof priceOverrideReason !== 'string' || !priceOverrideReason.trim()) {
              const err = new Error(
                `A non-empty priceOverrideReason is required when overriding authoritative price for new item "${resolvedName}".`
              );
              err.statusCode = 400;
              err.code = 'PRICE_OVERRIDE_REASON_REQUIRED';
              throw err;
            }
            if (priceOverrideReason.trim().length > 500) {
              const err = new Error('priceOverrideReason cannot exceed 500 characters.');
              err.statusCode = 400;
              throw err;
            }
            priceChanges.push({
              productId: prod._id,
              productName: resolvedName,
              colorName: colorObj.colorName,
              size: it.size,
              previousPrice: authoritativePrice,
              newPrice: explicitPrice,
              priceOverrideReason: priceOverrideReason.trim()
            });
          }
          unitPrice = explicitPrice;
        } else {
          unitPrice = authoritativePrice;
        }
        unitCost = prod.costPrice;
      }

      const finalResolvedName = typeof prod.name === 'object' && prod.name ? (prod.name.fr || prod.name.en || prod.name.ar || 'Product') : String(prod.name || 'Product');
      return {
        productId: prod._id,
        productName: finalResolvedName,
        colorName: colorObj.colorName,
        colorCode: colorObj.colorCode,
        size: it.size,
        quantity: it.quantity,
        unitPrice,
        unitCost,
        image: colorObj.images?.[0] || ''
      };
    });

    const newSubtotal = snapshotItems.reduce((acc, it) => acc + (it.unitPrice * it.quantity), 0);

    // 8. Authoritative delivery fee check
    const deliverySetting = await DeliverySetting.findOne(null, null, sessionOpt);
    if (!deliverySetting) {
      const err = new Error('Delivery configuration is not initialized. Cannot safely recalculate delivery fee for line-item edit.');
      err.statusCode = 400;
      err.code = 'DELIVERY_CONFIGURATION_MISSING';
      throw err;
    }

    let newDeliveryFee = order.deliveryFee;
    if (deliverySetting.freeDeliveryThreshold && deliverySetting.freeDeliveryThreshold > 0) {
      if (newSubtotal >= deliverySetting.freeDeliveryThreshold) {
        newDeliveryFee = 0;
      } else if (order.deliveryFee === 0 && previousSubtotal >= deliverySetting.freeDeliveryThreshold) {
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
      note: `Admin modified order line items. (Subtotal: ${previousSubtotal} -> ${newSubtotal} DZD, Total: ${previousTotalPrice} -> ${newTotalPrice} DZD). Reason: ${reason.trim()}${priceChanges.length > 0 ? ` [PRICE OVERRIDES: ${priceChanges.length}]` : ''}`,
      details: {
        previousItems,
        updatedItems: snapshotItems,
        previousSubtotal,
        updatedSubtotal: newSubtotal,
        previousDeliveryFee,
        updatedDeliveryFee: newDeliveryFee,
        previousTotalPrice,
        updatedTotalPrice: newTotalPrice,
        priceChanges,
        priceOverride: priceChanges.length > 0,
        priceOverrideReason: priceChanges.length > 0 ? priceOverrideReason.trim() : undefined,
        reason: reason.trim()
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
