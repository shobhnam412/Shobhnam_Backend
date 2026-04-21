import { Router } from 'express';
import {
  createCancellationRequest,
  listMyCancellationRequests,
} from '../controllers/cancellationRequest.controller.js';
import { authorizeRoles, verifyJWT } from '../middleware/auth.middleware.js';

const router = Router();

router.use(verifyJWT);

router.post('/', authorizeRoles('USER'), createCancellationRequest);
router.get('/me', authorizeRoles('USER'), listMyCancellationRequests);

export default router;
