import { Router } from 'express';
import { getUserNotifications, clearAllNotifications, markNotificationAsRead, markAllAsRead } from '../controllers/notificationController.js'
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.post('/getNotifications', authMiddleware, getUserNotifications);
router.post('/markAsRead', authMiddleware, markNotificationAsRead);
router.post('/markAllAsRead', authMiddleware, markAllAsRead);
router.post('/clearAll', authMiddleware, clearAllNotifications);

export default router;