import { setStockAtomic } from '../../services/inventoryService.js';

// Admin: Adjust stock directly for inventory management
export const adjustVariantStock = async (req, res, next) => {
  try {
    const { productId, colorName, size, newStock, reason } = req.body;
    const adminUsername = req.admin?.username || 'Admin';

    if (!productId || !colorName || !size || newStock === undefined) {
      return res.status(400).json({ success: false, message: 'Missing required inventory parameters' });
    }

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
