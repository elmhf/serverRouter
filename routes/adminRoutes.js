import { getAllUsers, promoteToAdmin, deleteUser, banUser, unbanUser, getAllClinics, getAllReports, loginAdmin, logoutAdmin, refreshAdminToken, removeUserFromClinic, updateUserRoleInClinic, updateUser, addUser, updateClinic, deleteClinic, createClinic, getClinicMembers, addUserToClinic, deleteReport, getAllPatients, deletePatient, updatePatient, getPatientDoctors, addDoctorToPatient, removeDoctorFromPatient, createPatient, getDashboardStats, getAdminProfile, updateAdminProfile, updateAdminPassword, getIncidentReports, updateIncidentReport, getAppSettings, updateAppSettings, addAppSetting, deleteAppSetting, getAllIntegrations, addIntegration, updateIntegration, deleteIntegration } from '../controllers/adminController.js';
import { authMiddleware } from '../middleware/auth.js';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';
import { Router } from 'express';
const router = Router();


router.get('/me', adminAuthMiddleware, getAdminProfile);
router.put('/update-profile', adminAuthMiddleware, updateAdminProfile);
router.put('/update-password', adminAuthMiddleware, updateAdminPassword);
router.get('/system-config', adminAuthMiddleware, getAppSettings);
router.put('/system-config', adminAuthMiddleware, updateAppSettings);
router.post('/system-config', adminAuthMiddleware, addAppSetting);
router.delete('/system-config/:key', adminAuthMiddleware, deleteAppSetting);
router.get('/incident-reports', adminAuthMiddleware, getIncidentReports);
router.put('/incident-report/update', adminAuthMiddleware, updateIncidentReport);
router.post('/login', loginAdmin);
router.post('/logout', logoutAdmin);
router.post('/refresh-token', refreshAdminToken);

router.get('/users', adminAuthMiddleware, getAllUsers);
router.post('/promote', adminAuthMiddleware, promoteToAdmin);
router.delete('/user/:userId', adminAuthMiddleware, deleteUser);
router.post('/user/update', adminAuthMiddleware, updateUser);
router.post('/user/add', adminAuthMiddleware, addUser);
router.post('/user/ban', adminAuthMiddleware, banUser);
router.post('/user/unban', adminAuthMiddleware, unbanUser);
router.post('/clinic/remove-user', adminAuthMiddleware, removeUserFromClinic);
router.post('/clinic/update-role', adminAuthMiddleware, updateUserRoleInClinic);
router.post('/clinics', adminAuthMiddleware, getAllClinics);
router.post('/clinic/update', adminAuthMiddleware, updateClinic);
router.delete('/clinic/:clinicId', adminAuthMiddleware, deleteClinic);
router.post('/clinic/add', adminAuthMiddleware, createClinic);
router.get('/clinic/:clinicId/members', adminAuthMiddleware, getClinicMembers);
router.post('/clinic/add-member', adminAuthMiddleware, addUserToClinic);
router.post('/reports', adminAuthMiddleware, getAllReports);
router.delete('/reports/:reportId', adminAuthMiddleware, deleteReport);
router.post('/patients', adminAuthMiddleware, getAllPatients);
router.delete('/patients/:patientId', adminAuthMiddleware, deletePatient);
router.post('/patient/update', adminAuthMiddleware, updatePatient);
router.get('/patient/:patientId/doctors', adminAuthMiddleware, getPatientDoctors);
router.post('/patient/add-doctor', adminAuthMiddleware, addDoctorToPatient);
router.post('/patient/remove-doctor', adminAuthMiddleware, removeDoctorFromPatient);
router.post('/patient/add', adminAuthMiddleware, createPatient);
router.get('/dashboard-stats', adminAuthMiddleware, getDashboardStats);

router.get('/integrations', adminAuthMiddleware, getAllIntegrations);
router.post('/integration/add', adminAuthMiddleware, addIntegration);
router.put('/integration/update', adminAuthMiddleware, updateIntegration);
router.delete('/integration/:id', adminAuthMiddleware, deleteIntegration);

export default router; 