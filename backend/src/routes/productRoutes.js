import express from 'express';
import {
  getProducts,
  getProductBySlug,
  getAllProductsAdmin,
  getProductByIdAdmin,
  createProduct,
  updateProduct,
  archiveProduct
} from '../controllers/productController.js';
import { authenticateAdmin, requireRoles } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { ROLES } from '../config/constants.js';
import { validate, productSchema, updateProductSchema } from '../middleware/validation.js';

const router = express.Router();

// Public routes
router.get('/', getProducts);
router.get('/slug/:slug', getProductBySlug);

// Admin routes — mutations require auth cookie + valid CSRF token
router.get('/admin/all', authenticateAdmin, getAllProductsAdmin);
router.get('/admin/:id', authenticateAdmin, getProductByIdAdmin);
router.post('/', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), validate(productSchema), createProduct);
router.put('/:id', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), validate(updateProductSchema), updateProduct);
router.delete('/:id', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), archiveProduct);

export default router;
