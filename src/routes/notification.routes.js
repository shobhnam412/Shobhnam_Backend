import { Router } from 'express';
import {
  getMyNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from '../controllers/notification.controller.js';
import { authorizeRoles, verifyJWT } from '../middleware/auth.middleware.js';

const router = Router();

router.use(verifyJWT, authorizeRoles('USER', 'ARTIST'));
router.get('/me', getMyNotifications);
router.patch('/read-all', markAllNotificationsAsRead);
router.patch('/:id/read', markNotificationAsRead);

export default router;
