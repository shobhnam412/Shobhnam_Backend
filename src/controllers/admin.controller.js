import { Artist } from '../models/artist.model.js';
import { ActivationPaymentVerification } from '../models/activationPaymentVerification.model.js';
import { Booking } from '../models/booking.model.js';
import { BookingPaymentVerification } from '../models/bookingPaymentVerification.model.js';
import { Category } from '../models/category.model.js';
import { Order } from '../models/order.model.js';
import { Payment } from '../models/payment.model.js';
import { Review } from '../models/review.model.js';
import { User } from '../models/user.model.js';
import {
  BOOKING_STATUS,
  PAYMENT_PLAN,
  PAYMENT_STATUS,
  createHappyCode,
  normalizePaymentPlanForEventDate,
  normalizePaymentPlanForOrderItems,
  requiresFullPaymentByEventDate,
} from '../utils/bookingLifecycle.js';
import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { fulfillActivationPayment, fulfillBookingPayment, reconcileBookingPostPaymentSms } from '../services/paymentFulfillment.service.js';
import { createInAppNotification, deactivatePaymentPendingNotifications, NOTIFICATION_TYPE } from '../services/notification.service.js';
import {
  findConflictingBooking,
  getArtistAvailabilityConflictMessage,
  buildArtistCalendarPayload,
} from '../services/inventory.service.js';
import { ALL_BOOKING_SLOT_ENUM, BOOKING_SLOT_ENUM, getSlotIntervalUtc } from '../utils/istTime.js';

const BANK_VERIFICATION_STATUS = {
  NOT_SUBMITTED: 'NOT_SUBMITTED',
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
};

const MANUAL_PAYMENT_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

const normalizeIndianPhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return String(phone || '').trim();
  return `+91${digits.slice(-10)}`;
};

const isArtistProfileComplete = (artist) =>
  Boolean(
    String(artist?.name || '').trim() &&
      String(artist?.expertise || '').trim() &&
      String(artist?.serviceLocation || '').trim() &&
      String(artist?.profilePhoto || '').trim() &&
      String(artist?.aadharCard || '').trim()
  );

/** Reasons an artist is not "fully active" for payouts / visibility; used when admin assigns. */
const getArtistProfileAssignmentIssues = (artist) => {
  const issues = [];
  if (artist?.activationChargeStatus !== 'PAID') {
    issues.push({
      code: 'ACTIVATION_PENDING',
      message: 'Activation fee has not been paid. This artist profile is not fully active.',
    });
  }
  const bv = artist?.bankVerification?.status || BANK_VERIFICATION_STATUS.NOT_SUBMITTED;
  if (bv !== BANK_VERIFICATION_STATUS.VERIFIED) {
    if (bv === BANK_VERIFICATION_STATUS.PENDING) {
      issues.push({
        code: 'BANK_PENDING_REVIEW',
        message: 'Bank details are awaiting admin verification.',
      });
    } else if (bv === BANK_VERIFICATION_STATUS.REJECTED) {
      issues.push({
        code: 'BANK_REJECTED',
        message: 'Bank verification was rejected; the artist must resubmit bank details.',
      });
    } else {
      issues.push({
        code: 'BANK_NOT_SUBMITTED',
        message: 'Bank details have not been submitted.',
      });
    }
  }
  return issues;
};

const buildOnboardingProgress = (artist) => {
  const complete = isArtistProfileComplete(artist);
  const verified = artist?.status === 'APPROVED';
  return {
    applied: complete,
    accountSetup: complete,
    verified,
    allDone: verified && complete,
    lastUpdatedAt: new Date(),
  };
};

export const getAdminMe = asyncHandler(async (req, res) => {
  res.status(200).json(new ApiResponse(200, req.user, 'Admin profile fetched'));
});

export const getDashboardStats = asyncHandler(async (req, res) => {
  const [
    totalUsers,
    totalArtists,
    pendingArtistsCount,
    approvedArtistsCount,
    liveArtistsCount,
    pendingBankVerificationsCount,
    pendingBookingPaymentVerificationsCount,
    pendingActivationPaymentVerificationsCount,
    totalBookings,
    totalOrders,
    revenueData,
    recentBookings,
    recentOrders,
    bookingsByStatus,
    bookingTrend,
  ] =
    await Promise.all([
      User.countDocuments({ role: 'USER' }),
      Artist.countDocuments(),
      Artist.countDocuments({ status: 'PENDING', 'onboardingProgress.applied': true }),
      Artist.countDocuments({ status: 'APPROVED' }),
      Artist.countDocuments({ isLive: true }),
      Artist.countDocuments({ 'bankVerification.status': BANK_VERIFICATION_STATUS.PENDING }),
      BookingPaymentVerification.countDocuments({ status: MANUAL_PAYMENT_STATUS.PENDING }),
      ActivationPaymentVerification.countDocuments({ status: MANUAL_PAYMENT_STATUS.PENDING }),
      Booking.countDocuments({ sourceType: 'DIRECT_BOOKING' }),
      Order.countDocuments(),
      Payment.aggregate([
        { $match: { status: 'SUCCESS' } },
        { $group: { _id: null, totalRevenue: { $sum: '$amount' } } },
      ]),
      Booking.find({ sourceType: 'DIRECT_BOOKING' })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('user', 'name phone')
        .populate('artist', 'name'),
      Order.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('user', 'name phone'),
      Booking.aggregate([
        { $match: { sourceType: 'DIRECT_BOOKING' } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Booking.aggregate([
        {
          $match: {
            sourceType: 'DIRECT_BOOKING',
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

  const totalRevenue = revenueData.length > 0 ? revenueData[0].totalRevenue : 0;

  res.status(200).json(
    new ApiResponse(
      200,
      {
        stats: {
          totalUsers,
          totalArtists,
          pendingArtistsCount,
          approvedArtistsCount,
          liveArtistsCount,
          pendingBankVerificationsCount,
          pendingBookingPaymentVerificationsCount,
          pendingActivationPaymentVerificationsCount,
          totalBookings,
          totalOrders,
          totalRevenue,
        },
        recentBookings,
        recentOrders,
        bookingsByStatus,
        bookingTrend,
      },
      'Dashboard stats fetched'
    )
  );
});

export const getAllUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search = '' } = req.query;
  const skip = (page - 1) * limit;

  const query = { role: 'USER' };
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  const [users, totalCount] = await Promise.all([
    User.find(query).select('-password -refreshToken').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    User.countDocuments(query),
  ]);

  res.status(200).json(
    new ApiResponse(200, {
      users,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    }, 'Users fetched')
  );
});

export const banUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = await User.findByIdAndDelete(id); // Simple delete for ban

  if (!user) throw new ApiError(404, 'User not found');

  res.status(200).json(new ApiResponse(200, {}, 'User banned/deleted successfully'));
});

export const createCategory = asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  if (!name) throw new ApiError(400, 'Category name is required');

  const existing = await Category.findOne({ name: { $regex: `^${name}$`, $options: 'i' } });
  if (existing) throw new ApiError(409, 'Category already exists');

  const category = await Category.create({ name, description });
  res.status(201).json(new ApiResponse(201, category, 'Category created'));
});

export const getCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({ isActive: true });
  res.status(200).json(new ApiResponse(200, categories, 'Categories fetched'));
});

export const getCategoriesForAdmin = asyncHandler(async (req, res) => {
  const categories = await Category.find().sort({ createdAt: -1 });
  res.status(200).json(new ApiResponse(200, categories, 'Categories fetched'));
});

export const toggleCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const category = await Category.findById(id);
  if (!category) throw new ApiError(404, 'Category not found');

  category.isActive = !category.isActive;
  await category.save();

  res.status(200).json(new ApiResponse(200, category, 'Category toggled'));
});

export const deleteCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const category = await Category.findByIdAndDelete(id);
  if (!category) throw new ApiError(404, 'Category not found');
  res.status(200).json(new ApiResponse(200, {}, 'Category deleted'));
});

export const getArtistApplications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search = '' } = req.query;
  const skip = (page - 1) * limit;

  const query = { status: 'PENDING', 'onboardingProgress.applied': true };
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { 'location.city': { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
    ];
  }

  const [artists, totalCount] = await Promise.all([
    Artist.find(query).select('-refreshToken').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Artist.countDocuments(query),
  ]);

  res.status(200).json(
    new ApiResponse(200, {
      artists,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    }, 'Artist applications fetched')
  );
});

export const getAllArtists = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search = '', status } = req.query;
  const skip = (page - 1) * limit;

  const query = { 'onboardingProgress.applied': true };
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { 'location.city': { $regex: search, $options: 'i' } },
    ];
  }
  if (status) query.status = status;

  const [artists, totalCount] = await Promise.all([
    Artist.find(query).select('-refreshToken').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Artist.countDocuments(query),
  ]);

  res.status(200).json(
    new ApiResponse(200, {
      artists,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    }, 'Artists fetched')
  );
});

export const getBankVerificationArtists = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search = '', status = BANK_VERIFICATION_STATUS.PENDING } = req.query;
  const skip = (page - 1) * limit;

  const allowedStatuses = Object.values(BANK_VERIFICATION_STATUS);
  if (status && !allowedStatuses.includes(status)) {
    throw new ApiError(400, `Invalid bank verification status. Allowed: ${allowedStatuses.join(', ')}`);
  }

  const query = {};
  if (status) query['bankVerification.status'] = status;
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { 'bankDetails.accountHolderName': { $regex: search, $options: 'i' } },
      { 'bankDetails.bankName': { $regex: search, $options: 'i' } },
      { 'bankDetails.ifscCode': { $regex: search, $options: 'i' } },
    ];
  }

  const [artists, totalCount] = await Promise.all([
    Artist.find(query).select('-refreshToken').sort({ 'bankVerification.submittedAt': -1, createdAt: -1 }).skip(skip).limit(Number(limit)),
    Artist.countDocuments(query),
  ]);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        artists,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          totalCount,
          totalPages: Math.ceil(totalCount / limit),
        },
      },
      'Bank verification artists fetched'
    )
  );
});

export const reviewArtistBankVerification = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, reason } = req.body;

  if (![BANK_VERIFICATION_STATUS.VERIFIED, BANK_VERIFICATION_STATUS.REJECTED].includes(status)) {
    throw new ApiError(400, 'Invalid status. Use VERIFIED or REJECTED');
  }
  if (status === BANK_VERIFICATION_STATUS.REJECTED && !String(reason || '').trim()) {
    throw new ApiError(400, 'Rejection reason is required');
  }

  const artist = await Artist.findById(id).select('-refreshToken');
  if (!artist) throw new ApiError(404, 'Artist not found');

  const currentStatus = artist.bankVerification?.status || BANK_VERIFICATION_STATUS.NOT_SUBMITTED;
  if (currentStatus !== BANK_VERIFICATION_STATUS.PENDING) {
    throw new ApiError(400, 'Only pending bank verifications can be reviewed');
  }

  artist.bankVerification = {
    ...(artist.bankVerification || {}),
    status,
    reviewedAt: new Date(),
    reviewedBy: req.user?._id,
    rejectionReason: status === BANK_VERIFICATION_STATUS.REJECTED ? String(reason).trim() : '',
  };
  await artist.save();

  if (status === BANK_VERIFICATION_STATUS.VERIFIED) {
    await createInAppNotification({
      recipientType: 'ARTIST',
      recipientId: artist._id,
      type: NOTIFICATION_TYPE.BANK_VERIFIED,
      title: 'Bank details verified',
      message: 'Your bank details have been verified by admin.',
      meta: {
        referenceDomain: 'ARTIST_BANK',
        referenceId: artist._id,
      },
      dedupeBy: 'REFERENCE',
    });
  }

  res.status(200).json(
    new ApiResponse(
      200,
      artist,
      status === BANK_VERIFICATION_STATUS.VERIFIED ? 'Bank verification approved' : 'Bank verification rejected'
    )
  );
});

export const deleteArtistBankVerification = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const artist = await Artist.findById(id).select('-refreshToken');
  if (!artist) throw new ApiError(404, 'Artist not found');

  artist.bankVerification = {
    status: BANK_VERIFICATION_STATUS.NOT_SUBMITTED,
    submittedAt: undefined,
    reviewedAt: undefined,
    reviewedBy: undefined,
    rejectionReason: '',
  };
  artist.bankDetails = {};
  await artist.save();

  res.status(200).json(new ApiResponse(200, artist, 'Bank verification deleted'));
});

export const listBookingPaymentVerifications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status = MANUAL_PAYMENT_STATUS.PENDING, search = '', targetType = '' } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const query = {};
  if (status) query.status = status;
  if (targetType) query.targetType = targetType;

  let requests = [];
  let totalCount = 0;

  if (search) {
    const users = await User.find({
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ],
    }).select('_id');
    query.user = { $in: users.map((item) => item._id) };
  }

  [requests, totalCount] = await Promise.all([
    BookingPaymentVerification.find(query)
      .sort({ submittedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('user', 'name phone')
      .populate('booking', 'eventDetails pricing paymentPlan')
      .populate('order', 'items paymentPlan grandTotal'),
    BookingPaymentVerification.countDocuments(query),
  ]);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        requests,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          totalCount,
          totalPages: Math.ceil(totalCount / Number(limit)),
        },
      },
      'Booking payment verification requests fetched'
    )
  );
});

export const reviewBookingPaymentVerification = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, reason } = req.body;

  if (![MANUAL_PAYMENT_STATUS.APPROVED, MANUAL_PAYMENT_STATUS.REJECTED].includes(status)) {
    throw new ApiError(400, 'Invalid status. Use APPROVED or REJECTED');
  }
  if (status === MANUAL_PAYMENT_STATUS.REJECTED && !String(reason || '').trim()) {
    throw new ApiError(400, 'Rejection reason is required');
  }

  const request = await BookingPaymentVerification.findById(id);
  if (!request) throw new ApiError(404, 'Payment verification request not found');
  if (request.status !== MANUAL_PAYMENT_STATUS.PENDING) {
    throw new ApiError(400, 'Only pending payment verification requests can be reviewed');
  }

  if (status === MANUAL_PAYMENT_STATUS.APPROVED) {
    if (request.targetType === 'BOOKING' && request.booking) {
      const booking = await Booking.findById(request.booking).select('eventDetails paymentPlan amountPaid');
      if (!booking) throw new ApiError(404, 'Booking not found');
      const effectivePlan = booking.amountPaid > 0
        ? booking.paymentPlan
        : normalizePaymentPlanForEventDate(request.paymentPlan || booking.paymentPlan, booking.eventDetails?.date);
      if (effectivePlan === PAYMENT_PLAN.FULL && request.paymentType === 'BOOKING_PARTIAL') {
        throw new ApiError(400, 'Partial booking payment cannot be approved for events within 3 days.');
      }
    }

    if (request.targetType === 'ORDER' && request.order) {
      const order = await Order.findById(request.order).select('items paymentPlan amountPaid');
      if (!order) throw new ApiError(404, 'Order not found');
      const effectivePlan = order.amountPaid > 0
        ? order.paymentPlan
        : normalizePaymentPlanForOrderItems(request.paymentPlan || order.paymentPlan, order.items || []);
      if (effectivePlan === PAYMENT_PLAN.FULL && request.paymentType === 'ORDER_PARTIAL') {
        throw new ApiError(400, 'Partial order payment cannot be approved for events within 3 days.');
      }
    }

    const submittedAmount = Number(request.amount || 0);
    const expectedAmount = Number(request.expectedAmount || 0);
    if (Math.abs(submittedAmount - expectedAmount) > 0.01) {
      throw new ApiError(
        400,
        `Cannot approve this payment request because amount INR ${submittedAmount} does not match expected INR ${expectedAmount}.`
      );
    }
    await fulfillBookingPayment({
      targetType: request.targetType,
      bookingId: request.booking,
      orderId: request.order,
      amount: request.amount,
      paymentType: request.paymentType,
      requestId: request._id,
    });
    await deactivatePaymentPendingNotifications({
      recipientType: 'USER',
      recipientId: request.user,
      paymentDomain: request.targetType === 'BOOKING' ? 'BOOKING' : 'ORDER',
      referenceId: request.targetType === 'BOOKING' ? request.booking : request.order,
    });
    await createInAppNotification({
      recipientType: 'USER',
      recipientId: request.user,
      type: NOTIFICATION_TYPE.PAYMENT_CONFIRMED,
      title: 'Payment confirmed',
      message: 'Your payment has been verified and confirmed by admin.',
      meta: {
        referenceDomain: request.targetType === 'BOOKING' ? 'BOOKING' : 'ORDER',
        referenceId: request.targetType === 'BOOKING' ? request.booking : request.order,
      },
      dedupeBy: 'REFERENCE',
    });

    request.status = status;
    request.reviewedAt = new Date();
    request.reviewedBy = req.user?._id;
    request.rejectionReason = '';
    await request.save();
  } else {
    request.status = status;
    request.reviewedAt = new Date();
    request.reviewedBy = req.user?._id;
    request.rejectionReason = String(reason).trim();
    await request.save();
  }

  res.status(200).json(
    new ApiResponse(200, request, status === MANUAL_PAYMENT_STATUS.APPROVED ? 'Payment request approved' : 'Payment request rejected')
  );
});

export const deleteBookingPaymentVerification = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const request = await BookingPaymentVerification.findByIdAndDelete(id);
  if (!request) throw new ApiError(404, 'Payment verification request not found');
  res.status(200).json(new ApiResponse(200, {}, 'Payment verification request deleted'));
});

export const listActivationPaymentVerifications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status = MANUAL_PAYMENT_STATUS.PENDING, activationFor = '' } = req.query;
  const skip = (Number(page) - 1) * Number(limit);
  const query = {};
  if (status) query.status = status;
  if (activationFor) query.activationFor = activationFor;

  const [requests, totalCount] = await Promise.all([
    ActivationPaymentVerification.find(query)
      .sort({ submittedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('user', 'name phone')
      .populate('artist', 'name phone'),
    ActivationPaymentVerification.countDocuments(query),
  ]);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        requests,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          totalCount,
          totalPages: Math.ceil(totalCount / Number(limit)),
        },
      },
      'Activation payment verification requests fetched'
    )
  );
});

export const reviewActivationPaymentVerification = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, reason } = req.body;

  if (![MANUAL_PAYMENT_STATUS.APPROVED, MANUAL_PAYMENT_STATUS.REJECTED].includes(status)) {
    throw new ApiError(400, 'Invalid status. Use APPROVED or REJECTED');
  }
  if (status === MANUAL_PAYMENT_STATUS.REJECTED && !String(reason || '').trim()) {
    throw new ApiError(400, 'Rejection reason is required');
  }

  const request = await ActivationPaymentVerification.findById(id);
  if (!request) throw new ApiError(404, 'Activation payment verification request not found');
  if (request.status !== MANUAL_PAYMENT_STATUS.PENDING) {
    throw new ApiError(400, 'Only pending payment verification requests can be reviewed');
  }

  request.status = status;
  request.reviewedAt = new Date();
  request.reviewedBy = req.user?._id;
  request.rejectionReason = status === MANUAL_PAYMENT_STATUS.REJECTED ? String(reason).trim() : '';
  await request.save();

  if (status === MANUAL_PAYMENT_STATUS.APPROVED) {
    await fulfillActivationPayment({
      activationFor: request.activationFor,
      userId: request.user,
      artistId: request.artist,
      amount: request.amount,
      requestId: request._id,
    });
    await deactivatePaymentPendingNotifications({
      recipientType: request.activationFor,
      recipientId: request.activationFor === 'ARTIST' ? request.artist : request.user,
      paymentDomain: 'ACTIVATION',
      referenceId: request.activationFor === 'ARTIST' ? request.artist : request.user,
    });
    await createInAppNotification({
      recipientType: request.activationFor,
      recipientId: request.activationFor === 'ARTIST' ? request.artist : request.user,
      type: NOTIFICATION_TYPE.ACTIVATION_VERIFIED,
      title: 'Activation verified',
      message: 'Your activation charges have been verified by admin.',
      meta: {
        referenceDomain: 'ACTIVATION',
        referenceId: request.activationFor === 'ARTIST' ? request.artist : request.user,
      },
      dedupeBy: 'REFERENCE',
    });
  }

  res.status(200).json(
    new ApiResponse(
      200,
      request,
      status === MANUAL_PAYMENT_STATUS.APPROVED ? 'Activation payment request approved' : 'Activation payment request rejected'
    )
  );
});

export const deleteActivationPaymentVerification = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const request = await ActivationPaymentVerification.findByIdAndDelete(id);
  if (!request) throw new ApiError(404, 'Activation payment verification request not found');
  res.status(200).json(new ApiResponse(200, {}, 'Activation payment verification request deleted'));
});

export const approveRejectArtist = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['APPROVED', 'REJECTED'].includes(status)) {
    throw new ApiError(400, 'Invalid status. Use APPROVED or REJECTED');
  }

  const artist = await Artist.findByIdAndUpdate(id, { $set: { status } }, { new: true }).select('-refreshToken');
  if (!artist) throw new ApiError(404, 'Artist not found');

  artist.onboardingProgress = buildOnboardingProgress(artist);
  artist.isLive = artist.onboardingProgress.allDone;
  await artist.save({ validateBeforeSave: false });

  res.status(200).json(new ApiResponse(200, artist, `Artist ${status.toLowerCase()}`));
});

export const deleteArtist = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const artist = await Artist.findByIdAndDelete(id);
  if (!artist) throw new ApiError(404, 'Artist not found');
  res.status(200).json(new ApiResponse(200, {}, 'Artist deleted'));
});

/** Upload-only: returns S3 URL without updating any artist */
export const uploadProfilePhotoAdmin = asyncHandler(async (req, res) => {
  if (!req.file?.location) throw new ApiError(400, 'No file uploaded');
  res.status(200).json(
    new ApiResponse(200, { fileSavedUrl: req.file.location }, 'Profile photo uploaded')
  );
});

/** Upload-only: returns S3 URL without updating any artist */
export const uploadAadharAdmin = asyncHandler(async (req, res) => {
  if (!req.file?.location) throw new ApiError(400, 'No file uploaded');
  res.status(200).json(
    new ApiResponse(200, { fileSavedUrl: req.file.location }, 'Aadhar card uploaded')
  );
});

export const uploadPanCardAdmin = asyncHandler(async (req, res) => {
  if (!req.file?.location) throw new ApiError(400, 'No file uploaded');
  res.status(200).json(
    new ApiResponse(200, { fileSavedUrl: req.file.location }, 'PAN card uploaded')
  );
});

const parseExperienceYears = (experience) => {
  if (experience === undefined || experience === null || experience === '') return undefined;
  if (typeof experience === 'number') return experience;
  const text = String(experience).trim().toLowerCase();
  if (text.includes('more than 15')) return 16;
  const numbers = text.match(/(\d+)/g);
  if (!numbers?.length) return undefined;
  return parseInt(numbers[numbers.length - 1], 10);
};

const expertiseToCategory = {
  Ramleela: 'Ramleela',
  Sunderkand: 'Sunderkand',
  'Bhajan sandhya': 'Bhajan sandhya',
  'Bhagwat khatha': 'Bhagwat khatha',
  Rudrabhishek: 'Rudrabhishek',
  'Other services': 'Other',
};

export const createArtist = asyncHandler(async (req, res) => {
  const {
    phone,
    name,
    fullName,
    gender,
    expertise,
    experience,
    experienceYears,
    ramleelaCharacter,
    otherServiceType,
    minimumPrice,
    maximumPrice,
    basePrice,
    serviceLocation,
    youtubeLink,
    profilePhoto,
    aadharCard,
  } = req.body;

  const displayName = (name || fullName || '').trim();
  if (!displayName) throw new ApiError(400, 'Full name is required');
  if (!phone || String(phone).trim().length < 10) throw new ApiError(400, 'Valid phone number is required');
  if (!gender) throw new ApiError(400, 'Gender is required');
  if (!expertise) throw new ApiError(400, 'Expertise is required');
  if (!serviceLocation || !String(serviceLocation).trim()) throw new ApiError(400, 'Service location is required');
  if (!profilePhoto || !String(profilePhoto).trim()) throw new ApiError(400, 'Profile photo is required');
  if (!aadharCard || !String(aadharCard).trim()) throw new ApiError(400, 'Aadhar card is required');

  const normalizedPhone = normalizeIndianPhone(phone);
  const existing = await Artist.findOne({ phone: normalizedPhone });
  if (existing) throw new ApiError(409, 'An artist with this phone number already exists');

  const requireCharacter = expertise.toLowerCase().includes('ramleela');
  if (requireCharacter && (!ramleelaCharacter || !String(ramleelaCharacter).trim())) {
    throw new ApiError(400, 'Ramleela character is required when expertise includes Ramleela');
  }
  const requireOtherServiceType = expertise.toLowerCase() === 'other services';
  if (requireOtherServiceType && (!otherServiceType || !String(otherServiceType).trim())) {
    throw new ApiError(400, 'Other service type is required when expertise is Other services');
  }

  const minCandidate = minimumPrice !== undefined ? minimumPrice : basePrice;
  const maxCandidate = maximumPrice !== undefined ? maximumPrice : minimumPrice;
  const min = Number(minCandidate);
  const max = Number(maxCandidate);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new ApiError(400, 'Minimum and maximum price are required and must be valid numbers');
  }
  if (min < 0) throw new ApiError(400, 'Minimum price must be greater than or equal to 0');
  if (max < min) throw new ApiError(400, 'Maximum price must be greater than or equal to minimum price');

  const expYears = experienceYears !== undefined ? experienceYears : parseExperienceYears(experience);
  const category = expertiseToCategory[expertise] || 'Other';

  const artist = await Artist.create({
    phone: normalizedPhone,
    name: displayName,
    gender,
    expertise,
    category,
    ramleelaCharacter: ramleelaCharacter?.trim() || undefined,
    otherServiceType: otherServiceType?.trim() || undefined,
    experienceYears: expYears ?? 0,
    minimumPrice: min,
    maximumPrice: max,
    pricing: {
      basePrice: min,
      minimumPrice: min,
      maximumPrice: max,
      currency: 'INR',
    },
    serviceLocation: String(serviceLocation).trim(),
    youtubeLink: youtubeLink?.trim() || '',
    profilePhoto: String(profilePhoto).trim(),
    aadharCard: String(aadharCard).trim(),
    status: 'PENDING',
    onboardingProgress: {
      applied: true,
      accountSetup: true,
      verified: false,
      allDone: false,
      lastUpdatedAt: new Date(),
    },
    bankVerification: {
      status: BANK_VERIFICATION_STATUS.NOT_SUBMITTED,
    },
    isLive: false,
    location: {},
  });

  res.status(201).json(
    new ApiResponse(201, artist, 'Artist created successfully')
  );
});

const isSameId = (left, right) => String(left) === String(right);

const getBookingAssignedArtists = (booking) => {
  const currentEntries = Array.isArray(booking.assignedArtists) ? [...booking.assignedArtists] : [];
  const hasLegacyArtist = booking.artist && !currentEntries.some((entry) => isSameId(entry.artist, booking.artist));

  if (!hasLegacyArtist) return currentEntries;

  return [
    {
      artist: booking.artist,
      assignedBy: booking.assignment?.assignedBy,
      assignedAt: booking.assignment?.assignedAt || booking.updatedAt || booking.createdAt || new Date(),
      source: booking.assignment?.source || 'ADMIN',
      note: booking.assignment?.note,
    },
    ...currentEntries,
  ];
};

const syncLegacyAssignmentFields = (booking, assignedArtists) => {
  booking.assignedArtists = assignedArtists;
  const primaryAssignment = assignedArtists[0];

  if (!primaryAssignment) {
    booking.artist = undefined;
    booking.assignment = undefined;
    return;
  }

  booking.artist = primaryAssignment.artist;
  booking.assignment = {
    assignedBy: primaryAssignment.assignedBy,
    assignedAt: primaryAssignment.assignedAt,
    source: primaryAssignment.source,
    note: primaryAssignment.note,
  };
};

const getOrderItemAssignedArtists = (orderItem) => {
  const currentEntries = Array.isArray(orderItem.assignedArtists) ? [...orderItem.assignedArtists] : [];
  const hasLegacyArtist = orderItem.artist && !currentEntries.some((entry) => isSameId(entry.artist, orderItem.artist));

  if (!hasLegacyArtist) return currentEntries;

  return [
    {
      artist: orderItem.artist,
      assignedBy: orderItem.assignment?.assignedBy,
      assignedAt: orderItem.assignment?.assignedAt || new Date(),
      source: orderItem.assignment?.source || 'ADMIN',
      note: orderItem.assignment?.note,
    },
    ...currentEntries,
  ];
};

const syncOrderItemLegacyAssignmentFields = (orderItem, assignedArtists) => {
  orderItem.assignedArtists = assignedArtists;
  const primaryAssignment = assignedArtists[0];

  if (!primaryAssignment) {
    orderItem.artist = undefined;
    orderItem.assignment = undefined;
    return;
  }

  orderItem.artist = primaryAssignment.artist;
  orderItem.assignment = {
    assignedBy: primaryAssignment.assignedBy,
    assignedAt: primaryAssignment.assignedAt,
    source: primaryAssignment.source,
    note: primaryAssignment.note,
  };
};

const buildOrderItemEventDate = (orderItem) => {
  const candidate = orderItem?.date || orderItem?.dateTime;
  const date = candidate ? new Date(candidate) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const buildOrderItemSlot = (orderItem) => {
  return ALL_BOOKING_SLOT_ENUM.includes(orderItem?.slot) ? orderItem.slot : BOOKING_SLOT_ENUM[0];
};

const buildOrderItemTypeLabel = (orderItem) => {
  const type = [orderItem?.serviceName, orderItem?.packageTitle].filter(Boolean).join(' - ');
  return type || 'Order package';
};

const toDateKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const projectOrderForLifecycle = (order) => {
  const data = order?.toObject ? order.toObject() : order;
  const todayKey = toDateKey(new Date());
  const items = (data.items || []).map((item) => {
    const assigned = Boolean(item.artist) || (Array.isArray(item.assignedArtists) && item.assignedArtists.length > 0);
    const eventStarted = Boolean(todayKey && toDateKey(item.date) && todayKey >= toDateKey(item.date));
    let lifecycleStatus = item.status || 'PENDING';
    if (lifecycleStatus === BOOKING_STATUS.UPCOMING && eventStarted && assigned && Number(item.remainingAmount || 0) <= 0) {
      lifecycleStatus = BOOKING_STATUS.ONGOING;
    }
    return {
      ...item,
      lifecycleStatus,
      isAssigned: assigned,
    };
  });
  return {
    ...data,
    items,
    paymentStatusLabel:
      data.paymentStatus === PAYMENT_STATUS.PAID && data.paymentPlan === PAYMENT_PLAN.PARTIAL
        ? 'PARTIALLY_PAID'
        : data.paymentStatus,
  };
};

const hasAssignedOrderArtists = (orderItem) => {
  if (Array.isArray(orderItem?.assignedArtists) && orderItem.assignedArtists.length > 0) return true;
  return Boolean(orderItem?.artist);
};

const resolveOrderItemStatus = ({ orderItem, orderPaymentStatus }) => {
  if (!orderItem) return 'PENDING';
  if (orderItem.status === BOOKING_STATUS.CANCELLED || orderItem.status === BOOKING_STATUS.COMPLETED) {
    return orderItem.status;
  }
  if (orderItem.status === BOOKING_STATUS.ONGOING) return BOOKING_STATUS.ONGOING;
  if (orderItem.status === BOOKING_STATUS.MANUAL_REVIEW) return BOOKING_STATUS.MANUAL_REVIEW;

  const fullyPaid = Number(orderItem.remainingAmount || 0) <= 0 || orderPaymentStatus === PAYMENT_STATUS.PAID;
  if (!fullyPaid) {
    return requiresFullPaymentByEventDate(orderItem.date) ? BOOKING_STATUS.MANUAL_REVIEW : BOOKING_STATUS.PENDING;
  }

  return hasAssignedOrderArtists(orderItem) ? BOOKING_STATUS.UPCOMING : BOOKING_STATUS.PENDING;
};

const ensureOrderItemHappyCode = (orderItem) => {
  const fullyPaid = Number(orderItem?.remainingAmount || 0) <= 0;
  if (!fullyPaid) return;
  if (!hasAssignedOrderArtists(orderItem)) return;
  if (orderItem.happyCode) return;
  orderItem.happyCode = createHappyCode();
  orderItem.happyCodeGeneratedAt = new Date();
};

const findArtistBookingConflict = async ({ artistId, date, slot, excludeBookingId }) => {
  const { startUtc, endUtc, dateKey } = getSlotIntervalUtc(date, slot);
  if (!startUtc || !endUtc || !dateKey) return null;
  return findConflictingBooking({ artistId, startUtc, endUtc, slot, dateKey, excludeBookingId });
};

export const getArtistCalendarForAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { from, to } = req.query;
  if (!from || !to) {
    throw new ApiError(400, 'Query params from and to are required (ISO date strings)');
  }
  const payload = await buildArtistCalendarPayload({ artistId: id, from, to });
  res.status(200).json(new ApiResponse(200, payload, 'Artist calendar loaded'));
});

const normalizeServiceHint = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * When `serviceHint` is non-empty, only artists whose profile category matches the
 * booked service (e.g. "Bhagwat" / "Bhagwat Katha" → artist category Bhagwat Katha).
 */
const artistMatchesServiceHint = (artistCategory, serviceHint) => {
  const hint = normalizeServiceHint(serviceHint);
  if (!hint) return true;

  const catRaw = String(artistCategory || '').trim();
  if (!catRaw) return false;

  const cat = normalizeServiceHint(catRaw);
  if (!cat) return false;

  if (cat === hint) return true;
  if (cat.includes(hint) || hint.includes(cat)) return true;

  const synonymRows = [
    { hints: ['bhagwat', 'bhagwata'], cats: ['bhagwat katha', 'bhagwat khatha'] },
    { hints: ['sunder', 'sundar', 'sundarkand'], cats: ['sunderkand', 'sundarkand'] },
    { hints: ['ramleela', 'ramlila'], cats: ['ramleela'] },
    { hints: ['bhajan'], cats: ['bhajan sandhya'] },
    { hints: ['rudra'], cats: ['rudrabhishek'] },
    { hints: ['ramayan'], cats: ['ramayan path'] },
    { hints: ['other'], cats: ['other'] },
  ];

  for (const row of synonymRows) {
    if (!row.hints.some((h) => hint.includes(h))) continue;
    if (row.cats.some((c) => cat.includes(c) || c.includes(cat))) return true;
  }

  const hintParts = hint.split(' ').filter((t) => t.length >= 3);
  for (const part of hintParts) {
    if (cat.includes(part)) return true;
  }
  return false;
};

/**
 * Approved artists free for a single event date + slot (same rules as assign-artist).
 * Query: date (ISO), slot, excludeBookingId (optional — excludes that booking from overlap checks),
 * serviceType (optional — narrows to artists whose category matches the booked service label).
 */
export const listArtistsAvailableForSlot = asyncHandler(async (req, res) => {
  const { date, slot, excludeBookingId, serviceType, serviceHint } = req.query;
  if (!date || !slot) {
    throw new ApiError(400, 'Query params date and slot are required');
  }
  const dateObj = new Date(String(date));
  if (Number.isNaN(dateObj.getTime())) {
    throw new ApiError(400, 'Invalid date');
  }

  const excludeId =
    excludeBookingId && mongoose.isValidObjectId(String(excludeBookingId))
      ? new mongoose.Types.ObjectId(String(excludeBookingId))
      : undefined;

  const serviceFilterRaw = String(serviceType || serviceHint || '').trim();

  const artists = await Artist.find({ status: 'APPROVED' })
    .select(
      'name phone email category location availability serviceAddresses profilePhoto activationChargeStatus bankVerification.status'
    )
    .lean();

  const checks = await Promise.all(
    artists.map(async (artist) => {
      if (!artistMatchesServiceHint(artist.category, serviceFilterRaw)) {
        return null;
      }
      const availabilityMsg = getArtistAvailabilityConflictMessage(artist, dateObj, String(slot));
      if (availabilityMsg) {
        return null;
      }
      const conflict = await findArtistBookingConflict({
        artistId: artist._id,
        date: dateObj,
        slot: String(slot),
        excludeBookingId: excludeId,
      });
      if (conflict) {
        return null;
      }
      const profileIssues = getArtistProfileAssignmentIssues(artist);
      return {
        _id: artist._id,
        name: artist.name,
        phone: artist.phone,
        email: artist.email,
        category: artist.category,
        location: artist.location,
        serviceAddresses: artist.serviceAddresses || [],
        profilePhoto: artist.profilePhoto,
        profileIssues,
      };
    }),
  );

  const available = checks.filter(Boolean);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        artists: available,
        date: dateObj.toISOString(),
        slot: String(slot),
        serviceTypeFilter: serviceFilterRaw || null,
      },
      'Artists available for slot',
    ),
  );
});

const syncLinkedBookingForOrderItem = async (order, itemIndex, assignedArtists) => {
  const orderItem = order.items[itemIndex];
  if (!orderItem) return;

  const linkedBooking = await Booking.findOne({
    sourceType: 'ORDER_ITEM',
    'sourceRef.orderId': order._id,
    'sourceRef.itemIndex': itemIndex,
  });

  if (!assignedArtists.length) {
    if (!linkedBooking) return;
    syncLegacyAssignmentFields(linkedBooking, []);
    if (linkedBooking.status === 'PENDING' || linkedBooking.status === 'CONFIRMED') {
      linkedBooking.status = 'CANCELLED';
    }
    await linkedBooking.save();
    return;
  }

  const bookingData = {
    user: order.user,
    eventDetails: {
      date: buildOrderItemEventDate(orderItem),
      slot: buildOrderItemSlot(orderItem),
      type: buildOrderItemTypeLabel(orderItem),
    },
    location: {
      address: orderItem.addressDetail || 'Address unavailable',
      houseFloor: orderItem.houseFloor,
      towerBlock: orderItem.towerBlock,
      landmark: orderItem.landmark,
      city: orderItem.city || 'City unavailable',
      state: orderItem.state,
      pinCode: orderItem.pinCode,
    },
    pricing: {
      agreedPrice: Number(orderItem.price || 0),
      currency: order.currency || 'INR',
    },
    paymentStatus: ['PENDING', 'PAID', 'REFUNDED', 'FAILED'].includes(order.paymentStatus)
      ? order.paymentStatus
      : 'PENDING',
    sourceType: 'ORDER_ITEM',
    sourceRef: {
      orderId: order._id,
      itemIndex,
    },
    inventoryCommitted: Number(order.amountPaid || 0) > 0,
  };

  const booking = linkedBooking || new Booking(bookingData);
  booking.user = bookingData.user;
  booking.eventDetails = bookingData.eventDetails;
  booking.location = bookingData.location;
  booking.pricing = bookingData.pricing;
  booking.paymentStatus = bookingData.paymentStatus;
  booking.sourceType = bookingData.sourceType;
  booking.sourceRef = bookingData.sourceRef;
  if (booking.status === 'CANCELLED' || booking.status === 'REJECTED') {
    booking.status = orderItem.status || 'PENDING';
  }

  syncLegacyAssignmentFields(booking, assignedArtists);
  booking.inventoryCommitted = Number(order.amountPaid || 0) > 0;
  booking.status = orderItem.status || booking.status;
  booking.paymentStatus = Number(orderItem.remainingAmount || 0) <= 0 ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PENDING;
  booking.paymentPlan = order.paymentPlan || booking.paymentPlan;
  booking.amountPaid = Number(orderItem.amountPaid || 0);
  booking.remainingAmount = Number(orderItem.remainingAmount || 0);
  if (orderItem.happyCode) {
    booking.happyCode = orderItem.happyCode;
    booking.happyCodeGeneratedAt = orderItem.happyCodeGeneratedAt || booking.happyCodeGeneratedAt || new Date();
  }
  await booking.save();
};

/**
 * When an admin assigns/unassigns from the **booking** screen, the Order document is
 * what the mobile app uses for order-based rows (ORDER_ITEM bookings are not returned
 * from GET /bookings/user). Keep the matching order item in sync.
 */
const toPlainAssignedEntry = (entry) => {
  if (!entry) return null;
  const artistId = entry.artist?._id ?? entry.artist;
  if (artistId == null || artistId === '') return null;
  return {
    artist: artistId,
    assignedBy: entry.assignedBy?._id ?? entry.assignedBy,
    assignedAt: entry.assignedAt,
    source: entry.source,
    note: entry.note,
  };
};

const syncOrderItemFromLinkedBooking = async (booking) => {
  if (!booking || booking.sourceType !== 'ORDER_ITEM') return;
  const orderId = booking.sourceRef?.orderId;
  const itemIndex = booking.sourceRef?.itemIndex;
  if (!orderId || !Number.isInteger(itemIndex) || itemIndex < 0) return;

  const order = await Order.findById(orderId);
  if (!order?.items || itemIndex >= order.items.length) return;

  const assignedArtists = (getBookingAssignedArtists(booking) || [])
    .map(toPlainAssignedEntry)
    .filter(Boolean);
  syncOrderItemLegacyAssignmentFields(order.items[itemIndex], assignedArtists);
  order.markModified('items');
  await order.save();
};

export const getAllBookings = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, includeOrderLinked = 'false' } = req.query;
  const skip = (page - 1) * limit;

  const query = {
    ...(String(includeOrderLinked).toLowerCase() === 'true' ? {} : { sourceType: 'DIRECT_BOOKING' }),
  };
  if (status) query.status = status;

  const [bookings, totalCount] = await Promise.all([
    Booking.find(query)
      .populate('user', 'name phone email')
      .populate('artist', 'name location')
      .populate('assignedArtists.artist', 'name phone category location')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Booking.countDocuments(query),
  ]);

  res.status(200).json(
    new ApiResponse(200, {
      bookings,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    }, 'Bookings fetched')
  );
});

export const getBookingById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const booking = await Booking.findById(id)
    .populate('user', 'name phone email city')
    .populate('artist', 'name phone email location pricing')
    .populate('assignedArtists.artist', 'name phone email category location pricing')
    .populate('paymentId');
  if (!booking) throw new ApiError(404, 'Booking not found');
  res.status(200).json(new ApiResponse(200, booking, 'Booking details fetched'));
});

export const assignArtistToBooking = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { artistId, note, forceAssign = false, allowIncompleteArtistProfile = false } = req.body;

  if (!artistId) throw new ApiError(400, 'artistId is required');

  const [booking, artist] = await Promise.all([
    Booking.findById(id),
    Artist.findById(artistId),
  ]);

  if (!booking) throw new ApiError(404, 'Booking not found');
  if (!artist) throw new ApiError(404, 'Artist not found');
  if (artist.status !== 'APPROVED') {
    throw new ApiError(400, 'Only approved artists can be assigned');
  }

  const profileIssues = getArtistProfileAssignmentIssues(artist);
  if (profileIssues.length && !allowIncompleteArtistProfile) {
    throw new ApiError(
      422,
      "This artist's profile is not fully active (activation and/or bank verification). Confirm to assign anyway.",
      [
        {
          type: 'ARTIST_PROFILE_INCOMPLETE',
          artistId: artist._id,
          artistName: artist.name || 'Artist',
          issues: profileIssues,
        },
      ]
    );
  }

  const availabilityConflict = getArtistAvailabilityConflictMessage(
    artist,
    booking?.eventDetails?.date,
    booking?.eventDetails?.slot
  );
  const bookingConflict = await findArtistBookingConflict({
    artistId: artist._id,
    date: booking?.eventDetails?.date,
    slot: booking?.eventDetails?.slot,
    excludeBookingId: booking._id,
  });
  if (!forceAssign && (availabilityConflict || bookingConflict)) {
    const conflictMessage = availabilityConflict || 'Artist already has another booking for this date and slot';
    throw new ApiError(
      409,
      `${conflictMessage}. This assignment can continue only with forceAssign=true.`,
      [
        {
          type: 'ASSIGNMENT_CONFLICT',
          conflictMessage,
          conflictingBookingId: bookingConflict?._id || null,
        },
      ]
    );
  }

  const assignedArtists = getBookingAssignedArtists(booking);
  const alreadyAssigned = assignedArtists.some((entry) => isSameId(entry.artist, artist._id));
  if (alreadyAssigned) {
    throw new ApiError(409, 'Artist is already assigned to this booking');
  }

  assignedArtists.push({
    artist: artist._id,
    assignedBy: req.user._id,
    assignedAt: new Date(),
    source: 'ADMIN',
    note: note ? String(note).trim() : undefined,
  });

  syncLegacyAssignmentFields(booking, assignedArtists);
  if (booking.paymentStatus === PAYMENT_STATUS.PAID && !booking.happyCode) {
    booking.happyCode = createHappyCode();
    booking.happyCodeGeneratedAt = new Date();
  }

  await booking.save();
  await syncOrderItemFromLinkedBooking(booking);
  await booking.populate('artist', 'name phone category');
  await booking.populate('assignedArtists.artist', 'name phone category location');

  await reconcileBookingPostPaymentSms(booking);
  await createInAppNotification({
    recipientType: 'ARTIST',
    recipientId: artist._id,
    type: NOTIFICATION_TYPE.EVENT_ASSIGNED,
    title: 'New event assigned',
    message: 'Admin has assigned an event to you.',
    meta: {
      referenceDomain: 'BOOKING',
      referenceId: booking._id,
    },
    dedupeBy: 'REFERENCE',
  });

  res.status(200).json(new ApiResponse(200, booking, 'Artist assigned to booking'));
});

export const unassignArtistFromBooking = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { artistId } = req.body;

  if (!artistId) throw new ApiError(400, 'artistId is required');

  const booking = await Booking.findById(id);
  if (!booking) throw new ApiError(404, 'Booking not found');

  const assignedArtists = getBookingAssignedArtists(booking);
  const updatedAssignedArtists = assignedArtists.filter((entry) => !isSameId(entry.artist, artistId));

  if (updatedAssignedArtists.length === assignedArtists.length) {
    throw new ApiError(404, 'Artist is not assigned to this booking');
  }

  syncLegacyAssignmentFields(booking, updatedAssignedArtists);

  await booking.save();
  await syncOrderItemFromLinkedBooking(booking);
  await booking.populate('artist', 'name phone category');
  await booking.populate('assignedArtists.artist', 'name phone category location');

  res.status(200).json(new ApiResponse(200, booking, 'Artist unassigned from booking'));
});

export const cancelBookingByAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  if (!String(reason || '').trim()) {
    throw new ApiError(400, 'Cancellation reason is required');
  }
  const booking = await Booking.findById(id);
  if (!booking) throw new ApiError(404, 'Booking not found');
  booking.status = BOOKING_STATUS.CANCELLED;
  booking.cancelledAt = new Date();
  booking.closure = {
    ...(booking.closure || {}),
    cancellationReason: String(reason).trim(),
    cancelledBy: req.user?._id,
    cancelledByRole: 'ADMIN',
  };
  await booking.save();
  res.status(200).json(new ApiResponse(200, booking, 'Booking cancelled'));
});

export const deleteBookingByAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const booking = await Booking.findByIdAndDelete(id);
  if (!booking) throw new ApiError(404, 'Booking not found');
  res.status(200).json(new ApiResponse(200, {}, 'Booking deleted'));
});

export const getAllOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, paymentStatus = '', search = '' } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const query = {};
  if (paymentStatus) query.paymentStatus = paymentStatus;
  if (search) {
    query.$or = [
      { 'items.serviceName': { $regex: search, $options: 'i' } },
      { 'items.packageTitle': { $regex: search, $options: 'i' } },
    ];
  }

  const [orders, totalCount] = await Promise.all([
    Order.find(query)
      .populate('user', 'name phone email')
      .populate('items.artist', 'name phone category')
      .populate('items.assignedArtists.artist', 'name phone category location')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Order.countDocuments(query),
  ]);

  const projectedOrders = orders.map(projectOrderForLifecycle);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        orders: projectedOrders,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          totalCount,
          totalPages: Math.ceil(totalCount / Number(limit)),
        },
      },
      'Orders fetched'
    )
  );
});

export const getOrderById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const order = await Order.findById(id)
    .populate('user', 'name phone email city')
    .populate('items.artist', 'name phone email category location')
    .populate('items.assignedArtists.artist', 'name phone email category location');
  if (!order) throw new ApiError(404, 'Order not found');
  res.status(200).json(new ApiResponse(200, projectOrderForLifecycle(order), 'Order details fetched'));
});

export const deleteOrderByAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const order = await Order.findByIdAndDelete(id);
  if (!order) throw new ApiError(404, 'Order not found');
  res.status(200).json(new ApiResponse(200, {}, 'Order deleted'));
});

export const assignArtistToOrderItem = asyncHandler(async (req, res) => {
  const { id, itemIndex } = req.params;
  const { artistId, artistIds, note, forceAssign = false, allowIncompleteArtistProfile = false } = req.body;
  const incomingArtistIds = [artistId, ...(Array.isArray(artistIds) ? artistIds : [])]
    .filter(Boolean)
    .map((value) => String(value));
  const uniqueArtistIds = [...new Set(incomingArtistIds)];

  if (!uniqueArtistIds.length) {
    throw new ApiError(400, 'artistId or artistIds is required');
  }

  const [order, artists] = await Promise.all([
    Order.findById(id),
    Artist.find({ _id: { $in: uniqueArtistIds } }),
  ]);
  if (!order) throw new ApiError(404, 'Order not found');
  if (artists.length !== uniqueArtistIds.length) throw new ApiError(404, 'One or more artists were not found');

  const hasUnapprovedArtist = artists.some((artist) => artist.status !== 'APPROVED');
  if (hasUnapprovedArtist) throw new ApiError(400, 'Only approved artists can be assigned');

  const parsedItemIndex = Number(itemIndex);
  if (!Number.isInteger(parsedItemIndex) || parsedItemIndex < 0 || parsedItemIndex >= order.items.length) {
    throw new ApiError(400, 'Invalid item index');
  }

  const targetItem = order.items[parsedItemIndex];
  const targetDate = buildOrderItemEventDate(targetItem);
  const targetSlot = buildOrderItemSlot(targetItem);
  const assignedArtists = getOrderItemAssignedArtists(targetItem);
  const noteValue = note ? String(note).trim() : undefined;
  let addedCount = 0;
  const addedArtistIds = [];
  const assignmentWarnings = [];

  if (!allowIncompleteArtistProfile) {
    const profileErrors = [];
    for (const artist of artists) {
      const alreadyAssigned = assignedArtists.some((entry) => isSameId(entry.artist, artist._id));
      if (alreadyAssigned) continue;
      const issues = getArtistProfileAssignmentIssues(artist);
      if (issues.length) {
        profileErrors.push({
          type: 'ARTIST_PROFILE_INCOMPLETE',
          artistId: artist._id,
          artistName: artist.name || 'Artist',
          issues,
        });
      }
    }
    if (profileErrors.length) {
      throw new ApiError(
        422,
        'One or more selected artists have an incomplete profile (activation and/or bank verification). Confirm to assign anyway.',
        profileErrors
      );
    }
  }

  for (const artist of artists) {
    const alreadyAssigned = assignedArtists.some((entry) => isSameId(entry.artist, artist._id));
    if (alreadyAssigned) continue;

    const availabilityConflict = getArtistAvailabilityConflictMessage(artist, targetDate, targetSlot);
    const bookingConflict = await findArtistBookingConflict({
      artistId: artist._id,
      date: targetDate,
      slot: targetSlot,
    });
    if (availabilityConflict || bookingConflict) {
      assignmentWarnings.push({
        artistId: artist._id,
        artistName: artist.name || 'Artist',
        conflictMessage: availabilityConflict || 'Artist already has another booking for this date and slot',
        conflictingBookingId: bookingConflict?._id || null,
      });
      if (!forceAssign) continue;
    }

    assignedArtists.push({
      artist: artist._id,
      assignedBy: req.user._id,
      assignedAt: new Date(),
      source: 'ADMIN',
      note: noteValue,
    });
    addedCount += 1;
    addedArtistIds.push(artist._id);
  }

  if (!addedCount) {
    const hasWarnings = assignmentWarnings.length > 0;
    if (hasWarnings && !forceAssign) {
      throw new ApiError(
        409,
        'One or more selected artists have availability conflicts. Retry with forceAssign=true to override.',
        assignmentWarnings
      );
    }
    throw new ApiError(409, 'Selected artists are already assigned to this package');
  }

  syncOrderItemLegacyAssignmentFields(targetItem, assignedArtists);
  targetItem.status = resolveOrderItemStatus({
    orderItem: targetItem,
    orderPaymentStatus: order.paymentStatus,
  });
  ensureOrderItemHappyCode(targetItem);

  await order.save();
  await syncLinkedBookingForOrderItem(order, parsedItemIndex, assignedArtists);
  await order.populate('items.artist', 'name phone category');
  await order.populate('items.assignedArtists.artist', 'name phone category location');

  await Promise.all(
    addedArtistIds.map((artistId) =>
      createInAppNotification({
        recipientType: 'ARTIST',
        recipientId: artistId,
        type: NOTIFICATION_TYPE.EVENT_ASSIGNED,
        title: 'New event assigned',
        message: 'Admin has assigned an event package to you.',
        meta: {
          referenceDomain: 'ORDER_ITEM',
          referenceId: `${order._id}:${parsedItemIndex}`,
        },
      })
    )
  );

  res.status(200).json(
    new ApiResponse(
      200,
      {
        order,
        assignmentWarnings,
      },
      'Artist assigned to package'
    )
  );
});

export const unassignArtistFromOrderItem = asyncHandler(async (req, res) => {
  const { id, itemIndex } = req.params;
  const { artistId } = req.body || {};
  const order = await Order.findById(id);
  if (!order) throw new ApiError(404, 'Order not found');

  const parsedItemIndex = Number(itemIndex);
  if (!Number.isInteger(parsedItemIndex) || parsedItemIndex < 0 || parsedItemIndex >= order.items.length) {
    throw new ApiError(400, 'Invalid item index');
  }

  const targetItem = order.items[parsedItemIndex];
  const assignedArtists = getOrderItemAssignedArtists(targetItem);
  const updatedAssignedArtists = artistId
    ? assignedArtists.filter((entry) => !isSameId(entry.artist, artistId))
    : [];

  if (artistId && updatedAssignedArtists.length === assignedArtists.length) {
    throw new ApiError(404, 'Artist is not assigned to this package');
  }

  syncOrderItemLegacyAssignmentFields(targetItem, updatedAssignedArtists);
  targetItem.status = resolveOrderItemStatus({
    orderItem: targetItem,
    orderPaymentStatus: order.paymentStatus,
  });
  if (!hasAssignedOrderArtists(targetItem)) {
    targetItem.happyCode = undefined;
    targetItem.happyCodeGeneratedAt = undefined;
  }

  await order.save();
  await syncLinkedBookingForOrderItem(order, parsedItemIndex, updatedAssignedArtists);
  await order.populate('items.artist', 'name phone category');
  await order.populate('items.assignedArtists.artist', 'name phone category location');

  res.status(200).json(new ApiResponse(200, order, artistId ? 'Artist unassigned from package' : 'All artists unassigned from package'));
});

export const getAllReviews = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (page - 1) * limit;

  const [reviews, totalCount] = await Promise.all([
    Review.find()
      .populate('user', 'name phone')
      .populate('artist', 'name')
      .populate('artists', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Review.countDocuments(),
  ]);

  res.status(200).json(
    new ApiResponse(200, {
      reviews,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    }, 'Reviews fetched')
  );
});

export const deleteReview = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const review = await Review.findById(id);
  if (!review) throw new ApiError(404, 'Review not found');

  const artistIds = Array.from(
    new Set([review.artist, ...(review.artists || [])].filter(Boolean).map((entry) => String(entry)))
  );
  await review.deleteOne();
  await Promise.all(
    artistIds.map(async (artistId) => {
      const remainingReviews = await Review.find({
        $or: [{ artist: artistId }, { artists: artistId }],
      }).select('rating');
      const totalReviews = remainingReviews.length;
      const newAverage =
        totalReviews > 0
          ? remainingReviews.reduce((sum, row) => sum + Number(row.rating || 0), 0) / totalReviews
          : 0;

      await Artist.findByIdAndUpdate(artistId, {
        rating: { averageRating: newAverage, totalReviews },
      });
    })
  );

  res.status(200).json(new ApiResponse(200, {}, 'Review deleted'));
});
