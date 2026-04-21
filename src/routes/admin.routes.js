import { Router } from 'express';
import {
  assignArtistToOrderItem,
  assignArtistToBooking,
  cancelBookingByAdmin,
  deleteActivationPaymentVerification,
  deleteArtistBankVerification,
  approveRejectArtist,
  banUser,
  createArtist,
  createCategory,
  deleteArtist,
  deleteBookingByAdmin,
  deleteBookingPaymentVerification,
  deleteCategory,
  deleteOrderByAdmin,
  deleteReview,
  getAdminMe,
  getAllArtists,
  getBankVerificationArtists,
  listActivationPaymentVerifications,
  listBookingPaymentVerifications,
  reviewActivationPaymentVerification,
  reviewBookingPaymentVerification,
  getArtistApplications,
  getAllBookings,
  getAllOrders,
  getAllReviews,
  getAllUsers,
  getBookingById,
  getCategories,
  getCategoriesForAdmin,
  getDashboardStats,
  getArtistCalendarForAdmin,
  listArtistsAvailableForSlot,
  getOrderById,
  reviewArtistBankVerification,
  toggleCategory,
  unassignArtistFromOrderItem,
  unassignArtistFromBooking,
  uploadAadharAdmin,
  uploadPanCardAdmin,
  uploadProfilePhotoAdmin,
} from '../controllers/admin.controller.js';
import {
  createAdminBroadcastNotification,
  getAdminNotifications,
} from '../controllers/notification.controller.js';
import {
  approveCancellationRequest,
  closeCancellationRequest,
  listCancellationRequestsForAdmin,
  markCancellationRefundDone,
  rejectCancellationRequest,
} from '../controllers/cancellationRequest.controller.js';
import {
  getSupportRequestsForAdmin,
  resolveSupportRequest,
} from '../controllers/support.controller.js';
import { authorizeRoles, verifyJWT } from '../middleware/auth.middleware.js';
import { uploadSingle } from '../services/s3.service.js';
import { uploadWithErrorHandling } from '../utils/uploadUtils.js';

const router = Router();

// Publicly readable categories
router.get('/categories', getCategories);

// Admin + Artist: shared upload endpoints (used by app and admin dashboard)
router.use(verifyJWT);
router.post('/upload-artist-profile-photo', authorizeRoles('ADMIN', 'ARTIST'), ...uploadWithErrorHandling(uploadSingle('profilePhoto'), uploadProfilePhotoAdmin));
router.post('/upload-artist-aadhar', authorizeRoles('ADMIN', 'ARTIST'), ...uploadWithErrorHandling(uploadSingle('aadharCard'), uploadAadharAdmin));
router.post('/upload-artist-pan-card', authorizeRoles('ADMIN', 'ARTIST'), ...uploadWithErrorHandling(uploadSingle('panCard'), uploadPanCardAdmin));

// Admin protected routes
router.use(authorizeRoles('ADMIN'));

router.get('/me', getAdminMe);
router.get('/dashboard', getDashboardStats);
router.get('/dashboard/stats', getDashboardStats);

router.get('/users', getAllUsers);
router.delete('/users/:id', banUser);

router.get('/artists/applications', getArtistApplications);
/** Must be before GET /artists so it is not shadowed by list handlers on some Express setups. */
router.get('/artists/available-for-slot', listArtistsAvailableForSlot);
/** Stable alias (single segment) — use this from clients to avoid 404s if older builds lack the /artists/... path. */
router.get('/available-artists-for-slot', listArtistsAvailableForSlot);
router.get('/artists', getAllArtists);
router.get('/artists/:id/calendar', getArtistCalendarForAdmin);
router.get('/artists/bank-verifications', getBankVerificationArtists);
router.get('/payments/booking-verifications', listBookingPaymentVerifications);
router.patch('/payments/booking-verifications/:id', reviewBookingPaymentVerification);
router.delete('/payments/booking-verifications/:id', deleteBookingPaymentVerification);
router.get('/payments/activation-verifications', listActivationPaymentVerifications);
router.patch('/payments/activation-verifications/:id', reviewActivationPaymentVerification);
router.delete('/payments/activation-verifications/:id', deleteActivationPaymentVerification);
router.get('/notifications', getAdminNotifications);
router.post('/notifications/broadcast', createAdminBroadcastNotification);
router.get('/support', getSupportRequestsForAdmin);
router.patch('/support/:id/resolve', resolveSupportRequest);
router.get('/cancellations', listCancellationRequestsForAdmin);
router.patch('/cancellations/:id/approve', approveCancellationRequest);
router.patch('/cancellations/:id/reject', rejectCancellationRequest);
router.patch('/cancellations/:id/refund-done', markCancellationRefundDone);
router.patch('/cancellations/:id/close', closeCancellationRequest);
router.post('/artists', createArtist);
router.patch('/artists/:id', approveRejectArtist);
router.patch('/artists/:id/bank-verification', reviewArtistBankVerification);
router.delete('/artists/:id/bank-verification', deleteArtistBankVerification);
router.delete('/artists/:id', deleteArtist);

router.get('/bookings', getAllBookings);
router.get('/bookings/:id', getBookingById);
router.patch('/bookings/:id/assign-artist', assignArtistToBooking);
router.patch('/bookings/:id/unassign-artist', unassignArtistFromBooking);
router.patch('/bookings/:id/cancel', cancelBookingByAdmin);
router.delete('/bookings/:id', deleteBookingByAdmin);
router.get('/orders', getAllOrders);
router.get('/orders/:id', getOrderById);
router.patch('/orders/:id/items/:itemIndex/assign-artist', assignArtistToOrderItem);
router.patch('/orders/:id/items/:itemIndex/unassign-artist', unassignArtistFromOrderItem);
router.delete('/orders/:id', deleteOrderByAdmin);

router.get('/reviews', getAllReviews);
router.delete('/reviews/:id', deleteReview);

router.get('/categories/all', getCategoriesForAdmin);
router.post('/categories', createCategory);
router.patch('/categories/:id/toggle', toggleCategory);
router.delete('/categories/:id', deleteCategory);

export default router;
