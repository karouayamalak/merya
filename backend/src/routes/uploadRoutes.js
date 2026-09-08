import express from 'express';
import { handleImageUpload } from '../controllers/uploadController.js';
import { uploadMiddleware } from '../middleware/upload.js';
import { authenticateAdmin } from '../middleware/auth.js';

const router = express.Router();

router.post('/', authenticateAdmin, uploadMiddleware.single('image'), handleImageUpload);

export default router;
