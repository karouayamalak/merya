import express from 'express';
import { handleImageUpload } from '../controllers/uploadController.js';
import { uploadMiddleware } from '../middleware/upload.js';
import { authenticateAdmin } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';

const router = express.Router();

router.post('/', authenticateAdmin, verifyCsrf, uploadMiddleware.single('image'), handleImageUpload);

export default router;
