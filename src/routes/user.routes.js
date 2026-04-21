import { Router } from 'express';
import { getUserProfile, updateUserProfile } from '../controllers/user.controller.js';
import { authorizeRoles, verifyJWT } from '../middleware/auth.middleware.js';
import { uploadSingle } from '../services/s3.service.js';

const router = Router();

// All routes below require user to be authenticated and have role USER
router.use(verifyJWT);
router.use(authorizeRoles('USER', 'ADMIN')); // Admin can also act as user in some contexts

router.route('/me')
  .get(getUserProfile)
  .patch(uploadSingle('profilePhoto'), updateUserProfile);

export default router;
