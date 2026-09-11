import express from 'express';
import { getDeliverySettings, updateDeliverySettings } from '../controllers/deliverySettingController.js';
import { authenticateAdmin, requireRoles } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

router.get('/delivery', getDeliverySettings);
router.put('/delivery', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), updateDeliverySettings);

export default router;
