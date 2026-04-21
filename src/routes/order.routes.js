import { Router } from 'express';
import { createOrder, getUserOrders } from '../controllers/order.controller.js';
import { authorizeRoles, verifyJWT } from '../middleware/auth.middleware.js';

const router = Router();

router.use(verifyJWT);

router.post('/', authorizeRoles('USER'), createOrder);
router.get('/user', authorizeRoles('USER'), getUserOrders);

export default router;
