import { Router } from 'express';
import { getUserProfile, updateUserProfile, deleteOwnAccount, changePassword, changeName, changeSignature, changeProfilePhoto, deleteProfilePhoto } from '../controllers/userController.js';
import { authMiddleware } from '../middleware/auth.js';
import { uploaders } from '../utils/uploadUtils.js';

const router = Router();

router.post('/me', authMiddleware, getUserProfile);
router.put('/:userId', updateUserProfile);
router.delete('/:userId', deleteOwnAccount);

// Changer le mot de passe
router.post('/change-password', authMiddleware, changePassword);

// Changer le nom
router.post('/change-name', authMiddleware, changeName);

router.post('/change-signature', authMiddleware, uploaders.signature.single, changeSignature);
router.post('/change-profile-photo', authMiddleware, uploaders.image.single, changeProfilePhoto);
router.post('/delete-profile-photo', authMiddleware, deleteProfilePhoto);

export default router; 