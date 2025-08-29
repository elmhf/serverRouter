import { Router } from 'express';
import { createReport, deleteReport, updateReportStatus, getReportData, getReportDataPost, generateCbctReport, getReportDataWithJsonPost, generatePanoReportWithFlask } from '../controllers/reportController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// AI Report routes
router.post('/create', authMiddleware, createReport);
router.delete('/delete', authMiddleware, deleteReport);
router.put('/update-status', authMiddleware, updateReportStatus);
router.get('/get-data', authMiddleware, getReportData);
router.post('/get-data', authMiddleware, getReportDataPost);
router.post('/get-data-with-json',authMiddleware, getReportDataWithJsonPost); // جديد
router.post('/generate-cbct', authMiddleware, generateCbctReport);
router.post('/generate-pano', authMiddleware, generatePanoReportWithFlask); // جديد - Pano with Flask API

export default router;