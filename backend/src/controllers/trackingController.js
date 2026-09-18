import { Order } from '../models/Order.js';
import { normalizeAlgerianPhone } from '../utils/phone.js';

export const trackOrder = async (req, res, next) => {
  try {
    const { phone, orderCode } = req.body;

    if (!phone || !orderCode) {
      return res.status(400).json({ success: false, message: 'Please provide both phone number and order code' });
    }

    const cleanCode = String(orderCode).trim().toUpperCase();
    let normalizedSubmittedPhone;
    try {
      normalizedSubmittedPhone = normalizeAlgerianPhone(String(phone));
    } catch {
      // Return generic not found message to prevent phone validation enumeration
      return res.status(404).json({
        success: false,
        message: 'No order found matching this tracking code and phone number combination'
      });
    }

    // Search order by orderCode
    const order = await Order.findOne({ orderCode: cleanCode });

    // Anti-enumeration protection: return unified generic message if order not found OR phone doesn't match exactly
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'No order found matching this tracking code and phone number combination'
      });
    }

    let normalizedStoredPhone;
    try {
      normalizedStoredPhone = normalizeAlgerianPhone(order.customer.phone);
    } catch {
      normalizedStoredPhone = order.customer.phone.replace(/[\s-]/g, '');
    }

    // STRICT EXACT EQUALITY MATCH ONLY — No partial matching, no endsWith
    if (normalizedStoredPhone !== normalizedSubmittedPhone) {
      return res.status(404).json({
        success: false,
        message: 'No order found matching this tracking code and phone number combination'
      });
    }

    // Build customer-safe timeline (excluding admin identities, cost prices, internal notes)
    const timeline = (order.auditHistory || [])
      .filter(entry => entry.action === 'ORDER_PLACED' || entry.action === 'STATUS_CHANGED')
      .map(entry => ({
        action: entry.action,
        timestamp: entry.timestamp,
        status: entry.details?.newStatus || 'Pending'
      }));

    // Customer safe tracking response (no cost prices, no profit margins, no admin identities)
    res.json({
      success: true,
      order: {
        orderCode: order.orderCode,
        status: order.status,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        deliveryMethod: order.customer.deliveryMethod,
        wilaya: order.customer.wilaya.name,
        agencyName: order.customer.agencyName || null,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        totalPrice: order.totalPrice,
        items: order.items.map(item => ({
          productName: item.productName,
          colorName: item.colorName,
          colorCode: item.colorCode,
          size: item.size,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          image: item.image
        })),
        timeline
      }
    });
  } catch (error) {
    next(error);
  }
};
