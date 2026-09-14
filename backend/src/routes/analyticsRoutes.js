import express from 'express';
import { getDashboardAnalytics } from '../controllers/analyticsController.js';
import { authenticateAdmin, requireRoles } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

router.get('/dashboard', authenticateAdmin, requireRoles(ROLES.OWNER, ROLES.ADMIN), getDashboardAnalytics);

export default router;
