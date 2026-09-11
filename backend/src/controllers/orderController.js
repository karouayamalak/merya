import { Order } from '../models/Order.js';
import { DeliverySetting } from '../models/DeliverySetting.js';
import { placeOrder, updateOrderStatus } from '../services/orderService.js';
import { setStockAtomic } from '../services/inventoryService.js';
import { ALGERIA_WILAYAS, DELIVERY_METHODS } from '../config/constants.js';

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
    // Business logic errors (insufficient stock, invalid product, bad delivery method)
    // are surfaced as 400/409. Infrastructure errors (DB down, unexpected) go to next().
    const businessErrors = [
      'insufficient stock',
      'product not found',
      'no longer available',
      'not available',
      'invalid item',
      'invalid delivery method',
      'at least one item'
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
    const { status, note } = req.body;
    const adminUsername = req.admin?.username || 'Admin';

    // Allow authenticated Admin / Owner to update order status flexibly
    const updatedOrder = await updateOrderStatus(id, status, adminUsername, note, true);
    res.json({ success: true, order: updatedOrder });
  } catch (error) {
    if (error.message?.includes('Order not found')) {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.message?.includes('Cannot transition') || error.message?.includes('Invalid order status') || error.message?.includes('Insufficient stock')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
};

// Admin: Edit customer details and delivery on order
export const updateOrderCustomerDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { fullName, phone, wilaya, address, agencyName, deliveryMethod, notes, deliveryFee } = req.body;

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const previousCustomer = { ...order.customer.toObject() };
    const previousDeliveryFee = order.deliveryFee;
    const previousTotalPrice = order.totalPrice;

    if (fullName) order.customer.fullName = fullName.trim();
    if (phone) order.customer.phone = phone.trim();
    if (address !== undefined) order.customer.address = address.trim();
    if (agencyName !== undefined) order.customer.agencyName = agencyName.trim();
    if (notes !== undefined) order.customer.notes = notes.trim();

    let wilayaOrMethodChanged = false;

    // Resolve wilaya if provided
    if (wilaya) {
      let resolvedWilaya = null;
      if (typeof wilaya === 'object' && wilaya.code && wilaya.name) {
        resolvedWilaya = { code: Number(wilaya.code), name: wilaya.name };
      } else {
        const found = ALGERIA_WILAYAS.find(w => 
          w.code === Number(wilaya) || 
          w.name.toLowerCase() === String(wilaya).toLowerCase()
        );
        if (found) {
          resolvedWilaya = { code: found.code, name: found.name };
        }
      }

      if (resolvedWilaya && (order.customer.wilaya?.code !== resolvedWilaya.code)) {
        order.customer.wilaya = resolvedWilaya;
        wilayaOrMethodChanged = true;
      }
    }

    // Resolve delivery method
    if (deliveryMethod) {
      const normalizedMethod = String(deliveryMethod).toLowerCase() === 'agency' ? DELIVERY_METHODS.AGENCY : DELIVERY_METHODS.HOME;
      if (order.customer.deliveryMethod !== normalizedMethod) {
        order.customer.deliveryMethod = normalizedMethod;
        wilayaOrMethodChanged = true;
      }
    }

    // If manual delivery fee provided, apply directly
    if (deliveryFee !== undefined && !isNaN(Number(deliveryFee))) {
      order.deliveryFee = Math.max(0, Number(deliveryFee));
      order.totalPrice = order.subtotal + order.deliveryFee;
    } else if (wilayaOrMethodChanged) {
      // Recalculate shipping fee from delivery settings for changed wilaya/method
      const deliverySetting = await DeliverySetting.findOne();
      if (deliverySetting) {
        let wilayaRate = null;
        const targetCode = order.customer.wilaya?.code;
        const targetName = order.customer.wilaya?.name?.toLowerCase();

        if (targetCode) {
          wilayaRate = deliverySetting.wilayaRates?.find(r => r.wilayaCode === Number(targetCode));
        } else if (targetName) {
          wilayaRate = deliverySetting.wilayaRates?.find(r => r.wilayaName.toLowerCase() === targetName);
        }

        const isAgency = String(order.customer.deliveryMethod).toLowerCase() === 'agency';
        let newFee = isAgency
          ? (wilayaRate ? wilayaRate.agencyFee : deliverySetting.agencyDeliveryFee)
          : (wilayaRate ? wilayaRate.homeFee : deliverySetting.homeDeliveryFee);

        // Apply free delivery threshold if active
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
      note: `Owner/Admin updated order info (Delivery: ${order.customer.deliveryMethod}, Wilaya: ${order.customer.wilaya?.name || 'N/A'}, Fee: ${order.deliveryFee} DZD).`,
      details: {
        previousCustomer,
        updatedCustomer: order.customer,
        previousDeliveryFee,
        newDeliveryFee: order.deliveryFee,
        previousTotalPrice,
        newTotalPrice: order.totalPrice
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
    const { productId, colorName, size, newStock } = req.body;
    if (!productId || !colorName || !size || newStock === undefined) {
      return res.status(400).json({ success: false, message: 'Missing required inventory parameters' });
    }

    const updatedProduct = await setStockAtomic(productId, colorName, size, parseInt(newStock, 10));
    res.json({ success: true, product: updatedProduct });
  } catch (error) {
    if (error.message?.includes('not found') || error.message?.includes('negative')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
};
