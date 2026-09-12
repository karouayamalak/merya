import express from 'express';
import {
  getBanners,
  getAllBannersAdmin,
  createBanner,
  updateBanner,
  deleteBanner
} from '../controllers/bannerController.js';
import { authenticateAdmin, requireRoles } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// Public routes
router.get('/', getBanners);

// Admin routes — mutations require auth cookie + valid CSRF token
router.get('/admin/all', authenticateAdmin, getAllBannersAdmin);
router.post('/', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), createBanner);
router.put('/:id', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), updateBanner);
router.delete('/:id', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), deleteBanner);

export default router;
