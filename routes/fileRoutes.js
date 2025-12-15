import express from 'express';
import { generateUploadUrl, confirmUpload, getFiles, deleteFile } from '../controllers/fileController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Generate signed URL for direct upload
router.post('/generate-upload-url', authMiddleware, generateUploadUrl);

// Confirm upload and save metadata
router.post('/confirm-upload', authMiddleware, confirmUpload);

// Get files for a clinic or patient (POST for body params)
router.post('/list', authMiddleware, getFiles);

// Delete file (ID in body)
router.post('/delete', authMiddleware, deleteFile);

export default router;
