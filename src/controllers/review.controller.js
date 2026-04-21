import { Artist } from '../models/artist.model.js';
import { Booking } from '../models/booking.model.js';
import { Order } from '../models/order.model.js';
import { Review } from '../models/review.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const toIdString = (value) => String(value ?? '');

const collectUniqueArtistIds = (artistValues = []) => {
  const map = new Map();
  artistValues.forEach((value) => {
    if (!value) return;
    map.set(toIdString(value), value);
  });
  return Array.from(map.values());
};

const buildArtistReviewQuery = (artistId) => ({
  $or: [{ artist: artistId }, { artists: artistId }],
});

const recalculateArtistsRatings = async (artistIds = []) => {
  if (!artistIds.length) return;
  const uniqueArtistIds = collectUniqueArtistIds(artistIds);

  await Promise.all(
    uniqueArtistIds.map(async (artistId) => {
      const reviews = await Review.find(buildArtistReviewQuery(artistId)).select('rating');
      const totalReviews = reviews.length;
      const averageRating =
        totalReviews > 0
          ? reviews.reduce((sum, row) => sum + Number(row.rating || 0), 0) / totalReviews
          : 0;

      await Artist.findByIdAndUpdate(artistId, {
        rating: {
          averageRating,
          totalReviews,
        },
      });
    })
  );
};

const ensureValidRating = (rating) => {
  const parsed = Number(rating);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5) {
    throw new ApiError(400, 'Rating must be between 1 and 5');
  }
  return parsed;
};

const isOrderCompleted = (order) => {
  if (!order) return false;
  if (order.paymentStatus !== 'PAID') return false;
  const hasPastDatedItem = (order.items || []).some((item) => {
    if (!item?.date) return false;
    const dateMs = new Date(item.date).getTime();
    return Number.isFinite(dateMs) && dateMs < Date.now();
  });
  const hasCompletedItem = (order.items || []).some((item) => item?.status === 'COMPLETED');
  return hasCompletedItem || hasPastDatedItem;
};

export const submitReview = asyncHandler(async (req, res) => {
  const { bookingId, orderId, rating, comment } = req.body;
  const normalizedRating = ensureValidRating(rating);
  const normalizedComment = String(comment ?? '').trim();

  if (!bookingId && !orderId) {
    throw new ApiError(400, 'bookingId or orderId is required');
  }
  if (bookingId && orderId) {
    throw new ApiError(400, 'Provide either bookingId or orderId, not both');
  }

  if (bookingId) {
    const booking = await Booking.findOne({ _id: bookingId, user: req.user._id }).select(
      '_id status artist assignedArtists'
    );
    if (!booking) throw new ApiError(404, 'Booking not found');
    if (booking.status !== 'COMPLETED') throw new ApiError(400, 'Can only review completed bookings');

    const existingReview = await Review.findOne({ booking: booking._id, user: req.user._id });
    if (existingReview) throw new ApiError(400, 'You have already reviewed this booking');

    const artistIds = collectUniqueArtistIds([
      booking.artist,
      ...(booking.assignedArtists || []).map((entry) => entry?.artist),
    ]);
    if (!artistIds.length) {
      throw new ApiError(400, 'No artist is linked with this booking');
    }

    const review = await Review.create({
      user: req.user._id,
      artist: artistIds[0],
      artists: artistIds,
      booking: booking._id,
      reviewScope: 'BOOKING',
      rating: normalizedRating,
      comment: normalizedComment,
    });

    await recalculateArtistsRatings(artistIds);
    return res.status(201).json(new ApiResponse(201, review, 'Review submitted successfully'));
  }

  const order = await Order.findOne({ _id: orderId, user: req.user._id }).select(
    '_id paymentStatus items date'
  );
  if (!order) throw new ApiError(404, 'Order not found');
  if (!isOrderCompleted(order)) {
    throw new ApiError(400, 'Can only review completed or past paid orders');
  }

  const existingReview = await Review.findOne({ order: order._id, user: req.user._id });
  if (existingReview) throw new ApiError(400, 'You have already reviewed this order');

  const artistIds = collectUniqueArtistIds(
    (order.items || []).flatMap((item) => [
      item?.artist,
      ...((item?.assignedArtists || []).map((entry) => entry?.artist)),
    ])
  );
  if (!artistIds.length) {
    throw new ApiError(400, 'No artist is linked with this order');
  }

  const review = await Review.create({
    user: req.user._id,
    artist: artistIds[0],
    artists: artistIds,
    order: order._id,
    reviewScope: 'ORDER',
    rating: normalizedRating,
    comment: normalizedComment,
  });

  await recalculateArtistsRatings(artistIds);
  res.status(201).json(new ApiResponse(201, review, 'Review submitted successfully'));
});

export const getArtistReviews = asyncHandler(async (req, res) => {
  const { artistId } = req.params;
  const { page = 1, limit = 10 } = req.query;
  const skip = (page - 1) * limit;
  const query = buildArtistReviewQuery(artistId);

  const [reviews, totalCount] = await Promise.all([
    Review.find(query)
      .populate('user', 'name profilePhoto city')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Review.countDocuments(query)
  ]);

  res.status(200).json(
    new ApiResponse(200, {
      reviews,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalCount,
        totalPages: Math.ceil(totalCount / limit)
      }
    }, 'Artist reviews fetched')
  );
});

export const deleteReviewAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const review = await Review.findById(id);
  if (!review) throw new ApiError(404, 'Review not found');

  const artistIds = collectUniqueArtistIds([review.artist, ...(review.artists || [])]);
  await review.deleteOne();
  await recalculateArtistsRatings(artistIds);

  res.status(200).json(new ApiResponse(200, {}, 'Review deleted and artist rating updated'));
});
