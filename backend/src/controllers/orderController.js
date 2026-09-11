import { Order } from '../models/Order.js';
import { DeliverySetting } from '../models/DeliverySetting.js';
import { placeOrder, updateOrderStatus } from '../services/orderService.js';
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
    if (error.message && error.message.startsWith('IDEMPOTENCY_CONFLICT')) {
      return res.status(409).json({ success: false, message: error.message });
    }

    // Business logic errors (insufficient stock, invalid product, bad delivery method, wilaya unavailable)
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
      'invalid wilaya'
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
    const { fullName, phone, wilaya, address, agencyName, deliveryMethod, notes, deliveryFee, overrideReason } = req.body;

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Historical protection: Delivered orders cannot have their financial values modified
    if (order.status === ORDER_STATUS.DELIVERED) {
      if (deliveryFee !== undefined && deliveryFee !== order.deliveryFee) {
        return res.status(400).json({
          success: false,
          message: 'Historical financial values (delivery fee, subtotal, total) cannot be modified on Delivered orders.'
        });
      }
      if (wilaya || deliveryMethod) {
        return res.status(400).json({
          success: false,
          message: 'Delivery destination cannot be modified on Delivered orders.'
        });
      }
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
          message: `Invalid Wilaya code: ${code}. Must be a canonical Algerian Wilaya between 1 and 58.`
        });
      }

      if (name && typeof name === 'string' && name.trim()) {
        const normName = name.trim().toLowerCase();
        const matchesEn = canonicalWilaya.name.toLowerCase() === normName;
        const matchesAr = canonicalWilaya.nameAr === normName;
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

    // Handle delivery fee calculation vs manual override
    let feeOverridden = false;
    if (deliveryFee !== undefined) {
      if (typeof deliveryFee !== 'number' || !Number.isFinite(deliveryFee) || deliveryFee < 0) {
        return res.status(400).json({ success: false, message: 'Delivery fee must be a finite non-negative number.' });
      }
      // Require a non-empty override reason — silent fallback is not allowed
      if (!overrideReason || typeof overrideReason !== 'string' || overrideReason.trim().length === 0) {
        return res.status(400).json({ success: false, message: 'A non-empty overrideReason is required when manually setting the delivery fee.' });
      }
      if (overrideReason.trim().length > 500) {
        return res.status(400).json({ success: false, message: 'overrideReason cannot exceed 500 characters.' });
      }
      order.deliveryFee = deliveryFee;
      order.totalPrice = order.subtotal + order.deliveryFee;
      feeOverridden = true;
    } else if (wilayaOrMethodChanged) {
      const deliverySetting = await DeliverySetting.findOne();
      if (deliverySetting) {
        const targetCode = order.customer.wilaya?.code;
        const wilayaRate = deliverySetting.wilayaRates?.find(r => r.wilayaCode === Number(targetCode));

        if (wilayaRate && wilayaRate.isAvailable === false) {
          return res.status(400).json({
            success: false,
            message: `Selected Wilaya ${targetCode} is currently marked unavailable for delivery.`
          });
        }

        const isAgency = order.customer.deliveryMethod === DELIVERY_METHODS.AGENCY;
        let newFee = isAgency
          ? (wilayaRate ? wilayaRate.agencyFee : deliverySetting.agencyDeliveryFee)
          : (wilayaRate ? wilayaRate.homeFee : deliverySetting.homeDeliveryFee);

        if (deliverySetting.freeDeliveryThreshold && deliverySetting.freeDeliveryThreshold > 0 && order.subtotal >= deliverySetting.freeDeliveryThreshold) {
          newFee = 0;
        }

        order.deliveryFee = newFee;
        order.totalPrice = order.subtotal + newFee;
      }
    }

    order.auditHistory.push({
      action: 'CUSTOMER_INFO_UPDATED',
      timestamp: new Date(),
      performedBy: req.admin?.username || 'Admin',
      note: feeOverridden
        ? `Owner/Admin manually adjusted delivery fee from ${previousDeliveryFee} to ${order.deliveryFee} DZD (Reason: ${overrideReason.trim()}).`
        : `Owner/Admin updated order customer info (Delivery: ${order.customer.deliveryMethod}, Wilaya: ${order.customer.wilaya?.name}, Fee: ${order.deliveryFee} DZD).`,
      details: {
        previousCustomer,
        updatedCustomer: order.customer,
        previousDeliveryFee,
        updatedDeliveryFee: order.deliveryFee,
        feeOverridden,
        overrideReason: feeOverridden ? overrideReason.trim() : null,
        previousTotalPrice,
        updatedTotalPrice: order.totalPrice
      }
    });

    await order.save();
    res.json({ success: true, order });
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

    const stockNum = parseInt(newStock, 10);
    if (isNaN(stockNum) || stockNum < 0) {
      return res.status(400).json({ success: false, message: 'Stock must be a non-negative integer' });
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
    if (error.message?.includes('not found') || error.message?.includes('negative')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
};
