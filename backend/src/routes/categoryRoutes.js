import express from 'express';
import {
  getCategories,
  getAllCategoriesAdmin,
  createCategory,
  updateCategory,
  archiveCategory
} from '../controllers/categoryController.js';
import { authenticateAdmin, requireRoles } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// Public route
router.get('/', getCategories);

// Admin routes — mutations require auth cookie + valid CSRF token
router.get('/admin/all', authenticateAdmin, getAllCategoriesAdmin);
router.post('/', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), createCategory);
router.put('/:id', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), updateCategory);
router.delete('/:id', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), archiveCategory);

export default router;
