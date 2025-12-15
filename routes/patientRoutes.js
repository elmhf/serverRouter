import { Router } from 'express';
import { addPatient, getPatients, getPatient, updatePatient, updatePatientDescription, deletePatient, addToFavorites, getFavoritePatients } from '../controllers/patientController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// Patient routes
router.post('/add', authMiddleware, addPatient);
router.post('/all', authMiddleware, getPatients);
router.get('/:patientId', authMiddleware, getPatient);
router.put('/update', authMiddleware, updatePatient);
router.post('/description', authMiddleware, updatePatientDescription);
router.delete('/delete', authMiddleware, deletePatient);

// Patient favorites routes
router.post('/favorites/toggle', authMiddleware, addToFavorites);
router.post('/favorites/all', authMiddleware, getFavoritePatients);

export default router; 