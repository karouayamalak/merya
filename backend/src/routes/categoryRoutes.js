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
import { validate, categorySchema, updateCategorySchema } from '../middleware/validation.js';

const router = express.Router();

// Public route
router.get('/', getCategories);

// Admin routes — mutations require auth cookie + valid CSRF token + strict Zod schema validation
router.get('/admin/all', authenticateAdmin, getAllCategoriesAdmin);
router.post('/', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), validate(categorySchema), createCategory);
router.put('/:id', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), validate(updateCategorySchema), updateCategory);
router.delete('/:id', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), archiveCategory);

export default router;
