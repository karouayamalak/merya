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
import { authenticateAdmin, requireRoles } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { checkoutLimiter } from '../middleware/rateLimiter.js';
import { validate, checkoutOrderSchema, statusChangeSchema, cartQuoteSchema } from '../middleware/validation.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// Public checkout & cart quote endpoints (COD) — no auth cookie, no CSRF needed
router.post('/checkout', checkoutLimiter, validate(checkoutOrderSchema), checkout);
router.post('/quote', checkoutLimiter, validate(cartQuoteSchema), getCartQuote);

// Admin order management — read-only accessible to all authenticated admin roles
router.get('/admin', authenticateAdmin, getAllOrdersAdmin);
router.get('/admin/:id', authenticateAdmin, getOrderByIdAdmin);

// Sensitive mutations — restricted to owner and admin roles only (staff cannot mutate orders)
router.patch('/admin/:id/status', authenticateAdmin, requireRoles(ROLES.OWNER, ROLES.ADMIN), verifyCsrf, validate(statusChangeSchema), changeOrderStatus);
router.put('/admin/:id/customer', authenticateAdmin, requireRoles(ROLES.OWNER, ROLES.ADMIN), verifyCsrf, updateOrderCustomerDetails);
router.put('/admin/:id/items', authenticateAdmin, requireRoles(ROLES.OWNER, ROLES.ADMIN), verifyCsrf, updateOrderItems);
router.post('/admin/inventory/adjust', authenticateAdmin, requireRoles(ROLES.OWNER, ROLES.ADMIN), verifyCsrf, adjustVariantStock);

export default router;
