import express from 'express';
import {
  checkout,
  getCartQuote,
  getAllOrdersAdmin,
  getOrderByIdAdmin,
  changeOrderStatus,
  updateOrderCustomerDetails,
  updateOrderItems,
  adjustVariantStock
} from '../controllers/orderController.js';
import { authenticateAdmin } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { checkoutLimiter } from '../middleware/rateLimiter.js';
import { validate, checkoutOrderSchema, statusChangeSchema } from '../middleware/validation.js';

const router = express.Router();

// Public checkout & cart quote endpoints (COD) — no auth cookie, no CSRF needed
router.post('/checkout', checkoutLimiter, validate(checkoutOrderSchema), checkout);
router.post('/quote', checkoutLimiter, getCartQuote);

// Admin order management — all mutations require both auth cookie AND valid CSRF token
router.get('/admin', authenticateAdmin, getAllOrdersAdmin);
router.get('/admin/:id', authenticateAdmin, getOrderByIdAdmin);
router.patch('/admin/:id/status', authenticateAdmin, verifyCsrf, validate(statusChangeSchema), changeOrderStatus);
router.put('/admin/:id/customer', authenticateAdmin, verifyCsrf, updateOrderCustomerDetails);
router.put('/admin/:id/items', authenticateAdmin, verifyCsrf, updateOrderItems);
router.post('/admin/inventory/adjust', authenticateAdmin, verifyCsrf, adjustVariantStock);

export default router;
