import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getSecuritySettings, updateSecuritySettings, initiate2FA, verify2FA, initiateDisable2FA, confirmDisable2FA, validate2FA, updateAutoSave } from '../controllers/securityController.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

router.get('/', getSecuritySettings);
router.put('/', updateSecuritySettings);
router.put('/autosave', updateAutoSave);

// 2FA Routes
router.post('/initiate', initiate2FA);
router.post('/verify', verify2FA);
router.post('/disable-initiate', initiateDisable2FA);
router.post('/disable-confirm', confirmDisable2FA);
router.post('/validate', validate2FA);

export default router;
