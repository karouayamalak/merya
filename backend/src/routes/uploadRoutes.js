import express from 'express';
import { handleImageUpload } from '../controllers/uploadController.js';
import { uploadMiddleware } from '../middleware/upload.js';
import { authenticateAdmin, requireRoles } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

router.post('/', authenticateAdmin, requireRoles(ROLES.OWNER, ROLES.ADMIN), verifyCsrf, uploadMiddleware.single('image'), handleImageUpload);

export default router;
