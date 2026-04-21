import { Router } from 'express';
import { deleteReviewAdmin, getArtistReviews, submitReview } from '../controllers/review.controller.js';
import { authorizeRoles, verifyJWT } from '../middleware/auth.middleware.js';

const router = Router();

// Public route to view reviews
router.get('/artist/:artistId', getArtistReviews);

router.use(verifyJWT);

// User protected
router.post('/', authorizeRoles('USER'), submitReview);

// Admin protected
router.delete('/:id', authorizeRoles('ADMIN'), deleteReviewAdmin);

export default router;
