import { Order } from '../../models/Order.js';
import { parsePaginationParams } from '../../utils/pagination.js';

// Admin: Get all orders with search, filters, and pagination
export const getAllOrdersAdmin = async (req, res, next) => {
  try {
    const { search, status, deliveryMethod, startDate, endDate } = req.query;

    const filter = {};

    if (search && search.trim()) {
      const raw = search.trim().slice(0, 100);
      const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { orderCode: { $regex: escaped, $options: 'i' } },
        { "customer.phone": { $regex: escaped, $options: 'i' } },
        { "customer.fullName": { $regex: escaped, $options: 'i' } }
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
      if (startDate) {
        const d = new Date(startDate);
        if (isNaN(d.getTime())) return res.status(400).json({ success: false, message: 'Invalid startDate.' });
        filter.createdAt.$gte = d;
      }
      if (endDate) {
        const d = new Date(endDate);
        if (isNaN(d.getTime())) return res.status(400).json({ success: false, message: 'Invalid endDate.' });
        filter.createdAt.$lte = d;
      }
    }

    // Strict pagination validation — rejects NaN, Infinity, negatives, decimals
    const pagination = parsePaginationParams(req.query, { defaultLimit: 25, maxLimit: 100 });
    if (!pagination.valid) {
      return res.status(400).json({ success: false, message: pagination.error });
    }
    const { pageNum, limitNum, skip } = pagination;

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
