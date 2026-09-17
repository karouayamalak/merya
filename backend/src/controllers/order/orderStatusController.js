import { updateOrderStatus } from '../../services/orderService.js';

// Admin: Update order status
export const changeOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, note, override, overrideReason } = req.body;
    const adminUsername = req.admin?.username || 'Admin';

    const isOverride = override === true;

    if (isOverride) {
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
