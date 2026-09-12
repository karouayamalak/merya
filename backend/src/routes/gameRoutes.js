import express from 'express';
import {
  getGames,
  getGameBySlug,
  getAllGamesAdmin,
  createGame,
  updateGame,
  deleteGame
} from '../controllers/gameController.js';
import { authenticateAdmin, requireRoles } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// Public routes
router.get('/', getGames);
router.get('/slug/:slug', getGameBySlug);

// Admin routes — mutations require auth cookie + valid CSRF token
router.get('/admin/all', authenticateAdmin, getAllGamesAdmin);
router.post('/', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), createGame);
router.put('/:id', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), updateGame);
router.delete('/:id', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), deleteGame);

export default router;
