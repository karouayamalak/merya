import express from 'express';
import {
  getBanners,
  getAllBannersAdmin,
  createBanner,
  updateBanner,
  deleteBanner
} from '../controllers/bannerController.js';
import { authenticateAdmin, authenticateAdminJwtOnly, requireRoles } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { ROLES } from '../config/constants.js';
import { validate, bannerSchema, updateBannerSchema } from '../middleware/validation.js';

const router = express.Router();

// Public routes
router.get('/', getBanners);

// Admin routes — mutations require auth cookie + valid CSRF token + strict Zod schema validation
router.get('/admin/all', authenticateAdminJwtOnly, getAllBannersAdmin);
router.post('/', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), validate(bannerSchema), createBanner);
router.put('/:id', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), validate(updateBannerSchema), updateBanner);
router.delete('/:id', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), deleteBanner);

export default router;
