import { Order } from '../models/Order.js';
import { DeliverySetting } from '../models/DeliverySetting.js';
import { placeOrder, updateOrderStatus, updateOrderItemsService } from '../services/orderService.js';
import { setStockAtomic } from '../services/inventoryService.js';
import { ALGERIA_WILAYAS, DELIVERY_METHODS, ORDER_STATUS } from '../config/constants.js';
import { normalizeAlgerianPhone } from '../utils/phone.js';

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

    if (error.message && error.message.startsWith('IDEMPOTENCY_CONFLICT')) {
      return res.status(409).json({ success: false, message: error.message });
    }

    // Business logic errors (insufficient stock, invalid product, bad delivery method, wilaya unavailable, delivery config)
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

// Admin: Get all orders with search, filters, and pagination
export const getAllOrdersAdmin = async (req, res, next) => {
  try {
    const { search, status, deliveryMethod, startDate, endDate, page = 1, limit = 25 } = req.query;

    const filter = {};

    if (search && search.trim()) {
      const q = search.trim();
      filter.$or = [
        { orderCode: { $regex: q, $options: 'i' } },
        { "customer.phone": { $regex: q, $options: 'i' } },
        { "customer.fullName": { $regex: q, $options: 'i' } }
      ];
    }

    if (status) {
      filter.status = status;
    }

    if (deliveryMethod) {
      filter["customer.deliveryMethod"] = deliveryMethod;
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Order.countDocuments(filter)
    ]);

    res.json({
      success: true,
      orders,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Get single order details with full audit log
export const getOrderByIdAdmin = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    res.json({ success: true, order });
  } catch (error) {
    next(error);
  }
};

// Admin: Update order status
export const changeOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, note, override, overrideReason } = req.body;
    const adminUsername = req.admin?.username || 'Admin';

    // Explicit override: admin must pass { override: true, overrideReason: "..." }
    // Normal transitions: no override flag needed, state machine is enforced.
    const isOverride = override === true;

    if (isOverride) {
      // Validate overrideReason is provided and non-empty
      if (!overrideReason || typeof overrideReason !== 'string' || overrideReason.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'A non-empty overrideReason is required when override is true.'
        });
      }
      if (overrideReason.trim().length > 500) {
        return res.status(400).json({
          success: false,
          message: 'overrideReason cannot exceed 500 characters.'
        });
      }
    }

    const updatedOrder = await updateOrderStatus(
      id,
      status,
      adminUsername,
      note || '',
      isOverride,
      isOverride ? overrideReason.trim() : ''
    );

    res.json({ success: true, order: updatedOrder });
  } catch (error) {
    if (error.message?.includes('Order not found')) {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.message?.startsWith('CONCURRENT_CONFLICT')) {
      return res.status(409).json({ success: false, message: 'Order was updated concurrently. Please refresh and retry.' });
    }
    if (
      error.message?.startsWith('OVERRIDE_REQUIRES_REASON') ||
      error.message?.includes('Cannot transition') ||
      error.message?.includes('Invalid order status') ||
      error.message?.includes('Insufficient stock') ||
      error.message?.includes('Terminal state violation')
    ) {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
};

// Admin: Edit customer details and delivery on order with strict validation & historical protection
export const updateOrderCustomerDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    // NOTE: deliveryFee is intentionally NOT accepted from req.body.
    // The server derives it exclusively from the authoritative DeliverySetting document.
    const { fullName, phone, wilaya, address, agencyName, deliveryMethod, notes } = req.body;

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Historical immutability: DELIVERED orders are fully locked.
    // No customer fields, delivery destination, or financial values may be changed
    // after an order reaches the Delivered state. Any attempt is rejected immediately.
    if (order.status === ORDER_STATUS.DELIVERED) {
      return res.status(400).json({
        success: false,
        message: 'Delivered orders are fully locked. Historical financial values and customer details cannot be modified on Delivered orders.'
      });
    }

    const previousCustomer = { ...order.customer.toObject() };
    const previousDeliveryFee = order.deliveryFee;
    const previousTotalPrice = order.totalPrice;

    if (fullName) {
      if (typeof fullName !== 'string' || fullName.trim().length < 2) {
        return res.status(400).json({ success: false, message: 'Full name must be at least 2 characters.' });
      }
      order.customer.fullName = fullName.trim();
    }

    // Phone normalization and strict validation
    if (phone) {
      try {
        order.customer.phone = normalizeAlgerianPhone(phone);
      } catch (phoneErr) {
        return res.status(400).json({ success: false, message: phoneErr.message });
      }
    }

    if (notes !== undefined) {
      if (typeof notes === 'string' && notes.length > 500) {
        return res.status(400).json({ success: false, message: 'Notes cannot exceed 500 characters.' });
      }
      order.customer.notes = notes ? notes.trim() : '';
    }

    let wilayaOrMethodChanged = false;

    // Strict Wilaya validation
    if (wilaya) {
      const code = typeof wilaya === 'object' ? wilaya.code : wilaya;
      const name = typeof wilaya === 'object' ? (wilaya.name || '') : String(wilaya);
      const codeNum = Number(code);

      const canonicalWilaya = ALGERIA_WILAYAS.find(w => w.code === codeNum);
      if (!canonicalWilaya) {
        return res.status(400).json({
          success: false,
          message: `Invalid Wilaya code: ${code}. Must be a canonical Algerian Wilaya between 1 and 69.`
        });
      }

      if (name && typeof name === 'string' && name.trim()) {
        const normEn = (s) => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const normAr = (s) => s.trim().replace(/[إأآا]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
        const normNameEn = normEn(name);
        const normCanonEn = normEn(canonicalWilaya.name);
        const matchesEn = normCanonEn === normNameEn || (codeNum === 16 && (normNameEn === 'alger' || normNameEn === 'algiers'));
        const matchesAr = canonicalWilaya.nameAr === name.trim() || normAr(canonicalWilaya.nameAr) === normAr(name);
        if (!matchesEn && !matchesAr) {
          return res.status(400).json({
            success: false,
            message: `Wilaya mismatch: code ${codeNum} is "${canonicalWilaya.name}", but received "${name}".`
          });
        }
      }

      if (order.customer.wilaya?.code !== canonicalWilaya.code) {
        order.customer.wilaya = { code: canonicalWilaya.code, name: canonicalWilaya.name };
        wilayaOrMethodChanged = true;
      }
    }

    // Strict Delivery Method validation
    if (deliveryMethod !== undefined) {
      const normMethod = String(deliveryMethod).toLowerCase().trim();
      if (normMethod !== DELIVERY_METHODS.AGENCY && normMethod !== DELIVERY_METHODS.HOME) {
        return res.status(400).json({
          success: false,
          message: 'Invalid delivery method. Must be "agency" or "home".'
        });
      }

      if (normMethod === DELIVERY_METHODS.HOME) {
        const currentAddress = address !== undefined ? address : order.customer.address;
        if (!currentAddress || typeof currentAddress !== 'string' || currentAddress.trim().length < 3) {
          return res.status(400).json({
            success: false,
            message: 'Detailed home address is required for home delivery (min 3 characters).'
          });
        }
      }

      if (order.customer.deliveryMethod !== normMethod) {
        order.customer.deliveryMethod = normMethod;
        wilayaOrMethodChanged = true;
      }
    }

    if (address !== undefined) order.customer.address = address ? address.trim() : '';
    if (agencyName !== undefined) order.customer.agencyName = agencyName ? agencyName.trim() : '';

    // Server-authoritative delivery fee calculation:
    // Client-supplied deliveryFee is strictly ignored and cannot tamper with the order.
    // Fee is only recalculated if Wilaya or delivery method changed.
    if (wilayaOrMethodChanged) {
      const deliverySetting = await DeliverySetting.findOne();
      if (!deliverySetting) {
        return res.status(400).json({
          success: false,
          message: 'Delivery configuration not initialized. Cannot calculate delivery fee.'
        });
      }

      const targetCode = Number(order.customer.wilaya?.code);
      const wilayaRate = deliverySetting.wilayaRates?.find(r => r.wilayaCode === targetCode);
      if (!wilayaRate) {
        return res.status(400).json({
          success: false,
          message: `Delivery configuration missing for Wilaya ${targetCode} (${order.customer.wilaya?.name}).`
        });
      }

      if (wilayaRate.isAvailable === false) {
        return res.status(400).json({
          success: false,
          message: `Selected Wilaya ${targetCode} is currently marked unavailable for delivery.`
        });
      }

      const isAgency = order.customer.deliveryMethod === DELIVERY_METHODS.AGENCY;
      const authoritativeFee = isAgency ? wilayaRate.agencyFee : wilayaRate.homeFee;

      if (typeof authoritativeFee !== 'number' || !Number.isInteger(authoritativeFee) || authoritativeFee < 0) {
        return res.status(400).json({
          success: false,
          message: `Authoritative delivery fee is not configured for Wilaya ${targetCode} with method "${order.customer.deliveryMethod}".`
        });
      }

      let newFee = authoritativeFee;
      if (deliverySetting.freeDeliveryThreshold && deliverySetting.freeDeliveryThreshold > 0 && order.subtotal >= deliverySetting.freeDeliveryThreshold) {
        newFee = 0;
      }

      order.deliveryFee = newFee;
      order.totalPrice = order.subtotal + newFee;
    }

    // Agency delivery name validation
    if (order.customer.deliveryMethod === DELIVERY_METHODS.AGENCY) {
      if (!order.customer.agencyName || typeof order.customer.agencyName !== 'string' || order.customer.agencyName.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Agency name is required for agency delivery.'
        });
      }
    }

    const feeChanged = previousDeliveryFee !== order.deliveryFee;
    const auditEntry = {
      action: 'CUSTOMER_INFO_UPDATED',
      timestamp: new Date(),
      performedBy: req.admin?.username || 'Admin',
      note: feeChanged
        ? `Owner/Admin updated delivery destination/method. Authoritative fee updated from ${previousDeliveryFee} to ${order.deliveryFee} DZD (Delivery: ${order.customer.deliveryMethod}, Wilaya: ${order.customer.wilaya?.name}).`
        : `Owner/Admin updated order customer info (Delivery: ${order.customer.deliveryMethod}, Wilaya: ${order.customer.wilaya?.name}, Fee: ${order.deliveryFee} DZD).`,
      details: {
        previousCustomer,
        updatedCustomer: order.customer,
        previousDeliveryFee,
        updatedDeliveryFee: order.deliveryFee,
        feeChanged,
        previousTotalPrice,
        updatedTotalPrice: order.totalPrice
      }
    };

    // ── Optimistic Concurrency Control (CAS on __v) ───────────────────────────
    const expectedVersion = req.body.expectedVersion !== undefined
      ? Number(req.body.expectedVersion)
      : order.__v;

    // CAS: add status guard if admin is changing delivery destination/method,
    // which is the only operation that can alter financial values.
    const casQuery = {
      _id: order._id,
      __v: expectedVersion
    };

    // Historical financial protection: Under concurrent requests, Delivered orders must never be modified.
    // Triggered by actual wilaya/method change, not a client-supplied deliveryFee field.
    if (wilayaOrMethodChanged) {
      casQuery.status = { $ne: ORDER_STATUS.DELIVERED };
    }

    const casUpdate = {
      $set: {
        customer: order.customer,
        deliveryFee: order.deliveryFee,
        totalPrice: order.totalPrice
      },
      $inc: { __v: 1 },
      $push: { auditHistory: auditEntry }
    };

    const updatedOrder = await Order.findOneAndUpdate(casQuery, casUpdate, { new: true });

    if (!updatedOrder) {
      // Check if the order was concurrently marked Delivered
      const latestOrder = await Order.findById(id);
      if (latestOrder && latestOrder.status === ORDER_STATUS.DELIVERED && financialsOrDeliveryAttempted) {
        return res.status(400).json({
          success: false,
          message: 'Historical financial values (delivery fee, subtotal, total) cannot be modified on Delivered orders.'
        });
      }

      return res.status(409).json({
        success: false,
        code: 'CONCURRENT_CONFLICT',
        message: 'CONCURRENT_CONFLICT: Order was modified concurrently. Please refresh and retry.'
      });
    }

    res.json({ success: true, order: updatedOrder });
  } catch (error) {
    next(error);
  }
};

// Admin: Adjust stock directly for inventory management
export const adjustVariantStock = async (req, res, next) => {
  try {
    const { productId, colorName, size, newStock, reason } = req.body;
    const adminUsername = req.admin?.username || 'Admin';

    if (!productId || !colorName || !size || newStock === undefined) {
      return res.status(400).json({ success: false, message: 'Missing required inventory parameters' });
    }

    // Strict non-negative integer validation:
    // - reject decimals (1.5), floats, strings with whitespace
    // - reject values beyond safe integer range
    const rawStock = String(newStock).trim();
    const stockNum = Number(rawStock);
    if (
      !Number.isInteger(stockNum) ||
      stockNum < 0 ||
      !Number.isSafeInteger(stockNum) ||
      rawStock === ''
    ) {
      return res.status(400).json({ success: false, message: 'Stock must be a non-negative whole integer (no decimals)' });
    }

    const updatedProduct = await setStockAtomic(
      productId,
      colorName,
      size,
      stockNum,
      adminUsername,
      reason || 'Manual inventory adjustment'
    );
    res.json({
      success: true,
      product: updatedProduct,
      adjustment: updatedProduct._adjustment
    });
  } catch (error) {
    if (error.message?.startsWith('CONCURRENT_CONFLICT')) {
      return res.status(409).json({ success: false, message: error.message, code: 'CONCURRENT_CONFLICT' });
    }
    if (error.code === 'TRANSACTION_UNAVAILABLE' || error.message?.includes('TRANSACTION_UNAVAILABLE')) {
      return res.status(503).json({
        success: false,
        message: 'Inventory adjustments are temporarily unavailable because transaction support is offline.',
        code: 'TRANSACTION_UNAVAILABLE'
      });
    }
    if (error.message?.includes('not found') || error.message?.includes('negative')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
};

// Admin: Update order line items (product, color, size, quantity)
export const updateOrderItems = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { items, expectedVersion, reason } = req.body;
    const adminUsername = req.admin?.username || 'Admin';

    if (!items) {
      return res.status(400).json({
        success: false,
        message: 'items array is required'
      });
    }

    const updatedOrder = await updateOrderItemsService({
      orderId: id,
      newItems: items,
      expectedVersion,
      adminUsername,
      reason
    });

    res.json({
      success: true,
      message: 'Order line items updated successfully',
      order: updatedOrder
    });
  } catch (error) {
    if (error.code === 'CONCURRENT_CONFLICT' || error.message?.startsWith('CONCURRENT_CONFLICT')) {
      return res.status(409).json({
        success: false,
        code: 'CONCURRENT_CONFLICT',
        message: error.message
      });
    }
    if (
      error.statusCode === 400 ||
      error.message?.includes('Insufficient stock') ||
      error.message?.includes('cannot be modified') ||
      error.message?.includes('Cannot modify') ||
      error.message?.includes('required') ||
      error.message?.includes('not found') ||
      error.message?.includes('does not exist') ||
      error.message?.includes('Terminal state') ||
      error.message?.includes('inactive or archived')
    ) {
      return res.status(error.statusCode || 400).json({
        success: false,
        message: error.message
      });
    }
    if (error.statusCode === 404) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    if (error.code === 'TRANSACTION_UNAVAILABLE' || error.message?.includes('TRANSACTION_UNAVAILABLE')) {
      return res.status(503).json({
        success: false,
        code: 'TRANSACTION_UNAVAILABLE',
        message: 'Order modification is temporarily unavailable because MongoDB transactions are offline.'
      });
    }
    next(error);
  }
};
