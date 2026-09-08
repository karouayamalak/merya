import express from 'express';
import { login, logout, getMe } from '../controllers/authController.js';
import { authenticateAdmin } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/rateLimiter.js';
import { validate, adminLoginSchema } from '../middleware/validation.js';

const router = express.Router();

router.post('/login', loginLimiter, validate(adminLoginSchema), login);
router.post('/logout', logout);
router.get('/me', authenticateAdmin, getMe);

export default router;
