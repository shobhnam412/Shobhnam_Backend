import { Router } from 'express';
import {
  approveRejectArtist,
  getArtistCalendarPublic,
  getArtistDetail,
  getMyArtistProfile,
  getMyBankVerificationStatus,
  listArtists,
  updateArtistProfile,
  updateMyBankDetails,
  uploadAadharCard,
  uploadPanCard,
  uploadProfilePhoto,
} from '../controllers/artist.controller.js';
import { authorizeRoles, verifyJWT } from '../middleware/auth.middleware.js';
import { uploadSingle } from '../services/s3.service.js';
import { uploadWithErrorHandling } from '../utils/uploadUtils.js';

const router = Router();

// Publicly accessible routes
router.get('/', listArtists); // Paginated artist list with filters

// Artist /me routes - MUST be defined before /:id so /me is not captured as id
const artistAuth = [verifyJWT, authorizeRoles('ARTIST')];
router.get('/me', ...artistAuth, getMyArtistProfile);
router.patch('/me', ...artistAuth, updateArtistProfile);
router.post('/me/upload-profile-photo', ...artistAuth, ...uploadWithErrorHandling(uploadSingle('profilePhoto'), uploadProfilePhoto));
router.post('/me/upload-aadhar', ...artistAuth, ...uploadWithErrorHandling(uploadSingle('aadharCard'), uploadAadharCard));
router.post('/me/upload-pan-card', ...artistAuth, ...uploadWithErrorHandling(uploadSingle('panCard'), uploadPanCard));
router.patch('/me/bank-details', ...artistAuth, updateMyBankDetails);
router.get('/me/bank-verification-status', ...artistAuth, getMyBankVerificationStatus);

// Public - must be after /me
router.get('/:id/calendar', getArtistCalendarPublic);
router.get('/:id', getArtistDetail); // Detail view

// Admin routes
router.patch('/:id/approval', verifyJWT, authorizeRoles('ADMIN'), approveRejectArtist);

export default router;
