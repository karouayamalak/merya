import { updateOrderItemsService } from '../../services/orderService.js';

// Admin: Update order line items (product, color, size, quantity)
export const updateOrderItems = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { items, reason, priceOverride, priceOverrideReason } = req.body;
    const adminUsername = req.admin?.username || 'Admin';

    if (!items) {
      return res.status(400).json({
        success: false,
        message: 'items array is required'
      });
    }

    // Strict version validation: reject non-numbers, NaN, Infinity, decimals, negatives.
    let expectedVersion;
    if (req.body.expectedVersion !== undefined) {
      const rv = req.body.expectedVersion;
      if (
        typeof rv !== 'number' ||
        !Number.isFinite(rv) ||
        !Number.isInteger(rv) ||
        rv < 0
      ) {
        return res.status(400).json({
          success: false,
          message: 'expectedVersion must be a finite non-negative integer.'
        });
      }
      expectedVersion = rv;
    }

    const updatedOrder = await updateOrderItemsService({
      orderId: id,
      newItems: items,
      expectedVersion,
      adminUsername,
      reason,
      priceOverride: priceOverride === true,
      priceOverrideReason: typeof priceOverrideReason === 'string' ? priceOverrideReason : ''
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
