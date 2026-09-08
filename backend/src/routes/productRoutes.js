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
import { ROLES } from '../config/constants.js';
import { validate, productSchema } from '../middleware/validation.js';

const router = express.Router();

// Public routes
router.get('/', getProducts);
router.get('/slug/:slug', getProductBySlug);

// Admin routes
router.get('/admin/all', authenticateAdmin, getAllProductsAdmin);
router.get('/admin/:id', authenticateAdmin, getProductByIdAdmin);
router.post('/', authenticateAdmin, requireRoles(ROLES.OWNER, ROLES.ADMIN), validate(productSchema), createProduct);
router.put('/:id', authenticateAdmin, requireRoles(ROLES.OWNER, ROLES.ADMIN), updateProduct);
router.delete('/:id', authenticateAdmin, requireRoles(ROLES.OWNER, ROLES.ADMIN), archiveProduct);

export default router;
