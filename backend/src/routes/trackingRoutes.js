import express from 'express';
import { trackOrder } from '../controllers/trackingController.js';
import { trackingLimiter } from '../middleware/rateLimiter.js';
import { validate, trackingSchema } from '../middleware/validation.js';

const router = express.Router();

router.post('/', trackingLimiter, validate(trackingSchema), trackOrder);

export default router;
