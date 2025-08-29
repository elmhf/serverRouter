import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  checkPermission,
  checkAnyPermission,
  checkAllPermissions,
  getUserClinicPermissions,
  getUserAccessInfo,
  checkIsClinicCreator,
  getUserRole,
  getAllPermissions,
  getAllRoles,
  getRolePermissions
} from '../controllers/permissionController.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Check specific permission
router.post('/check-permission', checkPermission);

// Check if user has any of the specified permissions
router.post('/check-any-permission', checkAnyPermission);

// Check if user has all of the specified permissions
router.post('/check-all-permissions', checkAllPermissions);

// Get user's permissions in a clinic
router.get('/user-permissions/:clinicId', getUserClinicPermissions);

// Get comprehensive user access information
router.get('/user-access/:clinicId', getUserAccessInfo);

// Check if user is clinic creator
router.get('/is-creator/:clinicId', checkIsClinicCreator);

// Get user's role in a clinic
router.get('/user-role/:clinicId', getUserRole);

// Get all available permissions in the system
router.get('/permissions', getAllPermissions);

// Get all available roles in the system
router.get('/roles', getAllRoles);

// Get role permissions mapping
router.get('/role-permissions', getRolePermissions);

export default router; 