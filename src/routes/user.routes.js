import { Router } from 'express';
import {
  getUserProfile,
  updateUserProfile,
  uploadUserProfilePhoto,
} from '../controllers/user.controller.js';
import { authorizeRoles, verifyJWT } from '../middleware/auth.middleware.js';
import { uploadSingle } from '../services/s3.service.js';
import { uploadWithErrorHandling } from '../utils/uploadUtils.js';

const router = Router();

// All routes below require user to be authenticated and have role USER
router.use(verifyJWT);
router.use(authorizeRoles('USER', 'ADMIN')); // Admin can also act as user in some contexts

router.route('/me')
  .get(getUserProfile)
  .patch(...uploadWithErrorHandling(uploadSingle('profilePhoto'), updateUserProfile));

// Dedicated photo upload endpoint (mirrors the artist flow). Using this instead
// of PATCH /me for photo changes gives a clean `{ data: { fileSavedUrl, user } }`
// response and proper multer/S3 error handling via uploadWithErrorHandling.
router.post(
  '/me/upload-profile-photo',
  ...uploadWithErrorHandling(uploadSingle('profilePhoto'), uploadUserProfilePhoto)
);

export default router;
