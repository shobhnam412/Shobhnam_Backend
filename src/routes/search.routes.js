import { Router } from 'express';
import { globalSearch } from '../controllers/search.controller.js';
import { authorizeRoles, verifyJWT } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/global', verifyJWT, authorizeRoles('USER'), globalSearch);

export default router;
