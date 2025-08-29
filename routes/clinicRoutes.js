import { Router } from 'express';
import { createClinic, updateClinic, deleteClinic, getUserClinics, updateClinicEmail, updateClinicPhone, updateClinicInfo, changeClinicLogo, changeStampClinic, getClinicMembers, getClinicInvitationMembers, deleteClinicInvitation, inviteClinicMember, validateInvitation, acceptInvitation, rejectInvitation, leaveClinic, deleteClinicMember, changeMemberRole } from '../controllers/clinicController.js';
import { authMiddleware } from '../middleware/auth.js';
import { verifyEmailOtpCode } from '../controllers/authController.js';
import multer from 'multer';

// Configure multer for memory storage (for Supabase Storage upload)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

const router = Router();

router.post('/create', authMiddleware, verifyEmailOtpCode, createClinic);
router.put('/:clinicId', authMiddleware, updateClinic);
router.delete('/:clinicId', authMiddleware, deleteClinic);
router.get('/my-clinics', authMiddleware, getUserClinics);
router.post('/get-members', authMiddleware, getClinicMembers);
router.post('/get-invitation-members', authMiddleware, getClinicInvitationMembers);
router.post('/delete-invitation', authMiddleware, deleteClinicInvitation);


router.post('/invite-member', authMiddleware, inviteClinicMember);
router.post('/delete-member', authMiddleware, deleteClinicMember);
router.post('/change-member-role', authMiddleware, changeMemberRole);
router.post('/leave-clinic', authMiddleware, leaveClinic);

// Invitation routes (no auth required for these)
router.post('/validate-invitation', authMiddleware, validateInvitation);
router.post('/accept-invitation', authMiddleware, acceptInvitation);
router.post('/reject-invitation', authMiddleware, rejectInvitation);

router.post('/update-email', authMiddleware, verifyEmailOtpCode, updateClinicEmail); 
router.post('/update-phone', authMiddleware, updateClinicPhone);
router.post('/update-info', authMiddleware, updateClinicInfo);
router.post('/change-logo', authMiddleware, upload.single('image'), changeClinicLogo);
router.post('/change-stamp', authMiddleware, upload.single('image'), changeStampClinic);

export default router; 