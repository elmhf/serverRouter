import express from 'express';
import { getStorageStats, getBucketContent, downloadFile, deleteFile, uploadFile, createBucket, deleteBucket, emptyBucket } from '../controllers/storageController.js';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';
import upload from '../middleware/uploadMiddleware.js';

const router = express.Router();

// Get storage summary stats
// Protected route: only admins can access
router.get('/stats', adminAuthMiddleware, getStorageStats);

// Get specific bucket content
router.get('/bucket/:bucketName', adminAuthMiddleware, getBucketContent);

// Get signed URL for download
router.get('/bucket/:bucketName/download', adminAuthMiddleware, downloadFile);

// Delete file
router.delete('/bucket/:bucketName/file', adminAuthMiddleware, deleteFile);

// Upload file
router.post('/bucket/:bucketName/upload', adminAuthMiddleware, upload.single('file'), uploadFile);

// Create bucket
router.post('/bucket', adminAuthMiddleware, createBucket);

// Empty bucket
router.post('/bucket/:bucketName/empty', adminAuthMiddleware, emptyBucket);

// Delete bucket
router.delete('/bucket/:bucketName', adminAuthMiddleware, deleteBucket);

export default router;
