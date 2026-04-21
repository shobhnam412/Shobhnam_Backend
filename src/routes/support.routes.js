import { Router } from 'express';
import {
  getMySupportRequests,
  submitFeedbackRequest,
  submitHelpRequest,
} from '../controllers/support.controller.js';
import { authorizeRoles, verifyJWT } from '../middleware/auth.middleware.js';

const router = Router();

router.use(verifyJWT, authorizeRoles('USER', 'ARTIST'));
router.post('/help', submitHelpRequest);
router.post('/feedback', submitFeedbackRequest);
router.get('/me', getMySupportRequests);

export default router;
