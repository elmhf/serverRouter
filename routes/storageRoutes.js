import express from 'express';
import { getStorageStats, getBucketContent } from '../controllers/storageController.js';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';

const router = express.Router();

// Get storage summary stats
// Protected route: only admins can access
router.get('/stats', adminAuthMiddleware, getStorageStats);

// Get specific bucket content
router.get('/bucket/:bucketName', adminAuthMiddleware, getBucketContent);

export default router;
