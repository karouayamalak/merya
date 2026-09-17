import express from 'express';
import {
  login,
  refresh,
  logout,
  logoutAll,
  getMe,
  getSessions
} from '../controllers/authController.js';
import { authenticateAdmin } from '../middleware/auth.js';
import { issueCsrfToken, verifyCsrf } from '../middleware/csrf.js';
import { loginLimiter, refreshLimiter } from '../middleware/rateLimiter.js';
import { validate, adminLoginSchema } from '../middleware/validation.js';

const router = express.Router();

router.post('/login', loginLimiter, validate(adminLoginSchema), login);
router.post('/refresh', refreshLimiter, verifyCsrf, refresh);
router.post('/logout', verifyCsrf, logout);
router.post('/logout-all', verifyCsrf, authenticateAdmin, logoutAll);
router.get('/sessions', authenticateAdmin, getSessions);
router.get('/me', authenticateAdmin, getMe);
// GET: issues a fresh CSRF token as a JS-readable cookie + JSON body value
router.get('/csrf-token', issueCsrfToken);

export default router;
