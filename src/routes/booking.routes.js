import { Router } from 'express';
import {
    completeBookingWithHappyCode,
    completeBooking,
    createBooking,
    createBookingHold,
    deleteBookingHold,
    getArtistsCalendarIntersection,
    getAllBookingsAdmin,
    getArtistBookings,
    getUserBookings,
    markBookingOngoing,
    respondToBooking
} from '../controllers/booking.controller.js';
import { authorizeRoles, verifyJWT } from '../middleware/auth.middleware.js';

const router = Router();

// All routes require authentication
router.use(verifyJWT);

// User specific routes
router.post('/holds', authorizeRoles('USER'), createBookingHold);
router.delete('/holds/:holdId', authorizeRoles('USER'), deleteBookingHold);
router.get('/calendar/intersection', authorizeRoles('USER'), getArtistsCalendarIntersection);
router.post('/request', authorizeRoles('USER'), createBooking);
router.get('/user', authorizeRoles('USER'), getUserBookings);
router.patch('/:id/complete', authorizeRoles('USER'), completeBooking);

// Artist specific routes
router.patch('/:id/respond', authorizeRoles('ARTIST'), respondToBooking);
router.get('/artist', authorizeRoles('ARTIST'), getArtistBookings);
router.patch('/:id/start', authorizeRoles('ARTIST'), markBookingOngoing);
router.patch('/:id/close', authorizeRoles('ARTIST'), completeBookingWithHappyCode);

// Admin routes
router.get('/admin/all', authorizeRoles('ADMIN'), getAllBookingsAdmin);

export default router;
