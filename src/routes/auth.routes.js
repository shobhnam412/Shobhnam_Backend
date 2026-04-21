import { Router } from 'express';
import { adminLogin, hasDualProfile, sendOtp, switchProfile, verifyOtpArtist, verifyOtpUser } from '../controllers/auth.controller.js';
import { authorizeRoles, verifyJWT } from '../middleware/auth.middleware.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import { authValidation } from '../validations/auth.validation.js';

const router = Router();

router.post('/send-otp', validateRequest(authValidation.sendOtp), sendOtp);
router.post('/verify-otp/user', validateRequest(authValidation.verifyOtpUser), verifyOtpUser);
router.post('/verify-otp/artist', validateRequest(authValidation.verifyOtpArtist), verifyOtpArtist);

router.post('/admin-login', validateRequest(authValidation.adminLogin), adminLogin);

const userOrArtistAuth = [verifyJWT, authorizeRoles('USER', 'ARTIST', 'ADMIN')];
router.get('/has-dual-profile', ...userOrArtistAuth, hasDualProfile);
router.post('/switch-profile', ...userOrArtistAuth, switchProfile);

export default router;
