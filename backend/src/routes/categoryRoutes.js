import express from 'express';
import {
  getCategories,
  getAllCategoriesAdmin,
  createCategory,
  updateCategory,
  archiveCategory
} from '../controllers/categoryController.js';
import { authenticateAdmin, requireRoles } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// Public route
router.get('/', getCategories);

// Admin routes
router.get('/admin/all', authenticateAdmin, getAllCategoriesAdmin);
router.post('/', authenticateAdmin, requireRoles(ROLES.OWNER, ROLES.ADMIN), createCategory);
router.put('/:id', authenticateAdmin, requireRoles(ROLES.OWNER, ROLES.ADMIN), updateCategory);
router.delete('/:id', authenticateAdmin, requireRoles(ROLES.OWNER, ROLES.ADMIN), archiveCategory);

export default router;
