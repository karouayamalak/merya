import express from 'express';
import { getDashboardAnalytics } from '../controllers/analyticsController.js';
import { authenticateAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/dashboard', authenticateAdmin, getDashboardAnalytics);

export default router;
