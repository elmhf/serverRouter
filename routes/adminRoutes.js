import { Router } from 'express';
import { getAllUsers, promoteToAdmin, deleteUser } from '../controllers/adminController.js';

const router = Router();

router.get('/users', getAllUsers);
router.post('/promote', promoteToAdmin);
router.delete('/user/:userId', deleteUser);

export default router; 