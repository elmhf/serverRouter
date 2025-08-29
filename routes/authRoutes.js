import { Router } from 'express';
import {
  sendVerificationCode,
  verifyAndSignup,
  resendVerificationCode,
  login,
  debugCodes,
  clearCodes,
  verificationStatus,
  logout,
  refreshToken,
  sendEmailUpdateCode,
  verifyEmailUpdateCode,
  verifyPassword,
  sendEmailOtpCode,
  verifyEmailOtpCode
} from '../controllers/authController.js';

import validateSignupInput from '../middlewares/validateSignupInput.js';
import { authMiddleware } from '../middleware/auth.js';

import {
  sendPasswordResetOtp,
  verifyResetOtp,
  updatePasswordWithResetToken
} from '../controllers/authController.js';

// ========== Password Verification & OTP ========== 
const router = Router();



// ===== Password Reset Flow (Request, Verify, Update) =====
router.post('/reset/sendPasswordReset', sendPasswordResetOtp); // Step 1: Request OTP
router.post('/reset/verifyResetOtp', verifyResetOtp);        // Step 2: Verify OTP, get resetToken
router.post('/reset/updatePassword', updatePasswordWithResetToken); // Step 3: Update password with resetToken

router.post('/verification-status', verificationStatus);
router.post('/send-verification-code', validateSignupInput, sendVerificationCode);
router.post('/verify-and-signup', verifyAndSignup);
router.post('/resend-verification-code', resendVerificationCode);
router.post('/login', login);
router.post('/logout',logout)
router.post('/refresh-token', refreshToken);
router.post('/verification-status', verificationStatus);
router.post('/send-email-update-code', authMiddleware, sendEmailUpdateCode);
router.post('/verify-email-update-code', authMiddleware, verifyEmailUpdateCode);
router.post('/verify-password', verifyPassword);
router.post('/send-email-otp-code', authMiddleware,sendEmailOtpCode);
router.post('/verify-email-otp-code', authMiddleware,verifyEmailOtpCode);


if (process.env.NODE_ENV === 'development') {
  router.get('/debug/active-codes', debugCodes);
  router.delete('/debug/clear-codes', clearCodes);
}

export default router; 