import express from 'express';
import {
  checkout,
  getAllOrdersAdmin,
  getOrderByIdAdmin,
  changeOrderStatus,
  updateOrderCustomerDetails,
  adjustVariantStock
} from '../controllers/orderController.js';
import { authenticateAdmin } from '../middleware/auth.js';
import { checkoutLimiter } from '../middleware/rateLimiter.js';
import { validate, checkoutOrderSchema, statusChangeSchema } from '../middleware/validation.js';

const router = express.Router();

// Public checkout endpoint (COD)
router.post('/checkout', checkoutLimiter, validate(checkoutOrderSchema), checkout);

// Admin order management
router.get('/admin', authenticateAdmin, getAllOrdersAdmin);
router.get('/admin/:id', authenticateAdmin, getOrderByIdAdmin);
router.patch('/admin/:id/status', authenticateAdmin, validate(statusChangeSchema), changeOrderStatus);
router.put('/admin/:id/customer', authenticateAdmin, updateOrderCustomerDetails);
router.post('/admin/inventory/adjust', authenticateAdmin, adjustVariantStock);

export default router;
