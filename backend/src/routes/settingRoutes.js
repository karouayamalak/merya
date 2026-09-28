import express from 'express';
import { getDeliverySettings, updateDeliverySettings } from '../controllers/deliverySettingController.js';
import { getStoreSettings, updateStoreSettings } from '../controllers/storeSettingController.js';
import { authenticateAdmin, requireRoles } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

router.get('/delivery', getDeliverySettings);
router.put('/delivery', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), updateDeliverySettings);

router.get('/store', getStoreSettings);
router.put('/store', authenticateAdmin, verifyCsrf, requireRoles(ROLES.OWNER, ROLES.ADMIN), updateStoreSettings);

export default router;

