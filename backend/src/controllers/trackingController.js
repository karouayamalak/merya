import { Order } from '../models/Order.js';

export const trackOrder = async (req, res, next) => {
  try {
    const { phone, orderCode } = req.body;

    if (!phone || !orderCode) {
      return res.status(400).json({ success: false, message: 'Please provide both phone number and order code' });
    }

    const cleanCode = orderCode.trim().toUpperCase();
    const cleanPhone = phone.trim().replace(/[\s-]/g, '');

    // Search order by orderCode
    const order = await Order.findOne({ orderCode: cleanCode });

    // Anti-enumeration protection: return unified generic message if order not found OR phone doesn't match
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'No order found matching this tracking code and phone number combination'
      });
    }

    const orderPhoneClean = order.customer.phone.replace(/[\s-]/g, '');
    if (orderPhoneClean !== cleanPhone && !orderPhoneClean.endsWith(cleanPhone) && !cleanPhone.endsWith(orderPhoneClean)) {
      return res.status(404).json({
        success: false,
        message: 'No order found matching this tracking code and phone number combination'
      });
    }

    // Build customer-safe timeline
    const timeline = order.auditHistory
      .filter(entry => entry.action === 'ORDER_PLACED' || entry.action === 'STATUS_CHANGED')
      .map(entry => ({
        action: entry.action,
        timestamp: entry.timestamp,
        status: entry.details?.newStatus || 'Pending',
        note: entry.note
      }));

    // Customer safe tracking response (no cost prices, no admin identities)
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
