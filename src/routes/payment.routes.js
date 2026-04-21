import { Router } from 'express';
import {
  createRazorpayOrder,
  getMyActivationPaymentVerificationStatus,
  getMyBookingPaymentVerificationStatus,
  razorpayWebhook,
  submitActivationPaymentVerification,
  submitBookingPaymentVerification,
  verifyPayment,
} from '../controllers/payment.controller.js';
import { authorizeRoles, verifyJWT } from '../middleware/auth.middleware.js';
import { uploadSingle } from '../services/s3.service.js';
import { uploadWithErrorHandling } from '../utils/uploadUtils.js';

const router = Router();

// Webhook doesn't require JWT, Razorpay Server calls it directly
router.post('/webhook', razorpayWebhook);

// Protected routes
router.use(verifyJWT);
router.post('/create-order', authorizeRoles('USER'), createRazorpayOrder);
router.post('/verify', authorizeRoles('USER'), verifyPayment);
router.post(
  '/booking-verification',
  authorizeRoles('USER'),
  ...uploadWithErrorHandling(uploadSingle('screenshot'), submitBookingPaymentVerification)
);
router.get('/booking-verification-status', authorizeRoles('USER'), getMyBookingPaymentVerificationStatus);
router.post(
  '/activation-verification',
  authorizeRoles('USER', 'ARTIST'),
  ...uploadWithErrorHandling(uploadSingle('screenshot'), submitActivationPaymentVerification)
);
router.get('/activation-verification-status', authorizeRoles('USER', 'ARTIST'), getMyActivationPaymentVerificationStatus);

export default router;
