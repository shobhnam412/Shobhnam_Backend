import { Artist } from '../models/artist.model.js';
import { Booking } from '../models/booking.model.js';
import { Order } from '../models/order.model.js';
import { User } from '../models/user.model.js';
import { sendServiceCompleted } from '../services/fast2sms.service.js';
import {
  BOOKING_STATUS,
  PAYMENT_STATUS,
  calculatePaymentSplit,
  normalizePaymentPlanForEventDate,
  requiresFullPaymentByEventDate,
} from '../utils/bookingLifecycle.js';
import {
  assertInventoryAvailable,
  consumeHoldIfPresent,
  createActiveHold,
  findConflictingBooking,
  getArtistAvailabilityConflictMessage,
  releaseHoldById,
} from '../services/inventory.service.js';
import { getSlotIntervalUtc, toDateKeyInIST } from '../utils/istTime.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const normalizeBookingStatusForClient = (booking) => {
  if (!booking) return booking;
  const normalized = booking.toObject ? booking.toObject() : { ...booking };
  if (normalized.status === BOOKING_STATUS.CONFIRMED) {
    normalized.status = normalized.paymentStatus === PAYMENT_STATUS.PAID ? BOOKING_STATUS.UPCOMING : BOOKING_STATUS.CONFIRMED;
  }
  return normalized;
};

const syncOrderItemStatusFromLinkedBooking = async ({ bookingId, status, timestamps = {} }) => {
  if (!bookingId || !status) return;

  const booking = await Booking.findById(bookingId).select('sourceType sourceRef');
  if (!booking || booking.sourceType !== 'ORDER_ITEM') return;

  const orderId = booking.sourceRef?.orderId;
  const itemIndex = booking.sourceRef?.itemIndex;
  if (!orderId || !Number.isInteger(itemIndex) || itemIndex < 0) return;

  const order = await Order.findById(orderId);
  if (!order?.items || itemIndex >= order.items.length) return;

  const orderItem = order.items[itemIndex];
  orderItem.status = status;
  if (timestamps.ongoingAt) {
    orderItem.ongoingAt = timestamps.ongoingAt;
  }
  if (timestamps.closedAt) {
    orderItem.closedAt = timestamps.closedAt;
  }
  if (timestamps.happyCodeVerifiedAt) {
    orderItem.happyCodeVerifiedAt = timestamps.happyCodeVerifiedAt;
  }

  order.markModified('items');
  await order.save();
};

export const createBookingHold = asyncHandler(async (req, res) => {
  const { artistId, date, slot, addressId } = req.body;
  if (!artistId) throw new ApiError(400, 'artistId is required');
  if (!date) throw new ApiError(400, 'date is required');
  if (!slot) throw new ApiError(400, 'slot is required');

  const hold = await createActiveHold({
    userId: req.user._id,
    artistId,
    dateInput: date,
    slot,
    addressId,
  });

  res.status(201).json(
    new ApiResponse(
      201,
      { holdId: hold._id, expiresAt: hold.expiresAt, slot: hold.slot },
      'Slot reserved temporarily'
    )
  );
});

export const deleteBookingHold = asyncHandler(async (req, res) => {
  const { holdId } = req.params;
  await releaseHoldById(holdId, req.user._id);
  res.status(200).json(new ApiResponse(200, {}, 'Reservation released'));
});

export const createBooking = asyncHandler(async (req, res) => {
  const {
    artistId,
    holdId,
    date,
    slot,
    type,
    expectedAudienceSize,
    specialRequirements,
    addressId,
    address,
    houseFloor,
    towerBlock,
    landmark,
    city,
    state,
    pinCode,
    addressLabel,
    recipientName,
    recipientPhone,
    agreedPrice,
    assignmentSource,
    assignmentNote,
    paymentPlan = 'FULL',
  } = req.body;

  if (!artistId) throw new ApiError(400, 'artistId is required');
  if (!date) throw new ApiError(400, 'date is required');
  if (!slot) throw new ApiError(400, 'slot is required');
  if (!type) throw new ApiError(400, 'type is required');
  if (!address || !city) throw new ApiError(400, 'address and city are required');

  const artist = await Artist.findById(artistId);
  if (!artist) throw new ApiError(404, 'Artist not found');
  if (artist.status !== 'APPROVED') throw new ApiError(400, 'Artist is not available for booking');
  const availabilityConflict = getArtistAvailabilityConflictMessage(artist, date, slot);
  if (availabilityConflict) throw new ApiError(409, availabilityConflict);

  await assertInventoryAvailable({
    artistId,
    dateInput: date,
    slot,
    userId: req.user._id,
    excludeBookingId: null,
    ignoreHoldsForUserId: req.user._id,
  });

  await consumeHoldIfPresent({
    holdId,
    userId: req.user._id,
    artistId,
    dateInput: date,
    slot,
  });

  const { startUtc, endUtc, dateKey } = getSlotIntervalUtc(date, slot);
  const raceConflict = await findConflictingBooking({
    artistId,
    startUtc,
    endUtc,
    slot,
    dateKey,
    excludeBookingId: null,
  });
  if (raceConflict) {
    throw new ApiError(409, 'Artist already has another booking for this date and slot');
  }

  const user = await User.findById(req.user._id).select('activationChargeStatus');
  if (!user) throw new ApiError(404, 'User not found');
  if (user.activationChargeStatus !== 'PAID') {
    throw new ApiError(403, 'Activation charge is pending. Please complete activation payment first.');
  }

  const source = assignmentSource === 'RAMLEELA_CUSTOMIZATION' ? 'RAMLEELA_CUSTOMIZATION' : 'ADMIN';
  const resolvedPrice = Number.isFinite(Number(agreedPrice)) ? Number(agreedPrice) : artist.pricing.basePrice;
  const normalizedPaymentPlan = normalizePaymentPlanForEventDate(paymentPlan, date);
  const split = calculatePaymentSplit(resolvedPrice, normalizedPaymentPlan);

  const newBooking = await Booking.create({
    user: req.user._id,
    artist: artistId,
    eventDetails: { date, slot, type, expectedAudienceSize, specialRequirements },
    location: {
      addressId,
      address,
      houseFloor,
      towerBlock,
      landmark,
      city,
      state,
      pinCode,
      saveAs: addressLabel,
      recipientName,
      recipientPhone,
    },
    pricing: { agreedPrice: resolvedPrice, currency: artist.pricing.currency },
    status: 'PENDING',
    paymentStatus: 'PENDING',
    paymentPlan: split.paymentPlan,
    amountPaid: 0,
    remainingAmount: resolvedPrice,
    bookedAt: new Date(),
    assignment: {
      assignedBy: req.user._id,
      assignedAt: new Date(),
      source,
      note: assignmentNote ? String(assignmentNote).trim() : undefined,
    },
    assignedArtists: [
      {
        artist: artistId,
        assignedBy: req.user._id,
        assignedAt: new Date(),
        source,
        note: assignmentNote ? String(assignmentNote).trim() : undefined,
      },
    ],
    inventoryCommitted: false,
  });

  res.status(201).json(
    new ApiResponse(
      201,
      {
        ...newBooking.toObject(),
        paymentPlanLockedToFull: requiresFullPaymentByEventDate(date),
      },
      'Booking request sent successfully'
    )
  );
});

export const respondToBooking = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'CONFIRMED' or 'REJECTED'

  if (!['CONFIRMED', 'REJECTED'].includes(status)) {
    throw new ApiError(400, 'Invalid status. Can only be CONFIRMED or REJECTED');
  }

  const booking = await Booking.findOne({
    _id: id,
    $or: [
      { artist: req.user._id },
      { 'assignedArtists.artist': req.user._id },
    ],
  }).populate('user', 'name phone');
  if (!booking) throw new ApiError(404, 'Booking not found or not assigned to you');

  if (booking.status !== 'PENDING') {
    throw new ApiError(400, `Cannot change status from ${booking.status}`);
  }

  booking.status = status === 'CONFIRMED' ? BOOKING_STATUS.CONFIRMED : BOOKING_STATUS.REJECTED;
  await booking.save();

  res.status(200).json(new ApiResponse(200, booking, `Booking successfully ${status}`));
});

export const completeBooking = asyncHandler(async (req, res) => {
  if (req.user.role !== 'USER') {
    throw new ApiError(403, 'Artists must complete ongoing bookings using happy code verification');
  }

  const { id } = req.params;
  
  const query = { _id: id, user: req.user._id };

  const booking = await Booking.findOne(query);
  if (!booking) throw new ApiError(404, 'Booking not found');

  if (booking.status !== BOOKING_STATUS.ONGOING) {
    throw new ApiError(400, 'Only ongoing bookings can be marked as completed');
  }

  booking.status = BOOKING_STATUS.COMPLETED;
  booking.closedAt = new Date();
  await booking.save();

  res.status(200).json(new ApiResponse(200, booking, 'Booking marked as completed'));
});

export const getUserBookings = asyncHandler(async (req, res) => {
  const { includeOrderLinked = 'false' } = req.query;
  const query = {
    user: req.user._id,
    ...(String(includeOrderLinked).toLowerCase() === 'true' ? {} : { sourceType: 'DIRECT_BOOKING' }),
  };

  const docs = await Booking.find(query)
    .populate('artist', 'name category profilePhoto pricing')
    .populate('assignedArtists.artist', 'name category profilePhoto pricing')
    .sort({ createdAt: -1 });

  const bookings = docs.map(normalizeBookingStatusForClient);
  res.status(200).json(new ApiResponse(200, bookings, 'User bookings fetched'));
});

export const getArtistBookings = asyncHandler(async (req, res) => {
  /** Artists must see ORDER_ITEM linked bookings from cart/checkout; default includes all source types. */
  const { includeOrderLinked = 'true' } = req.query;
  const docs = await Booking.find({
    ...(String(includeOrderLinked).toLowerCase() === 'true' ? {} : { sourceType: 'DIRECT_BOOKING' }),
    $or: [
      { artist: req.user._id },
      { 'assignedArtists.artist': req.user._id },
    ],
  })
    .populate('user', 'name city profilePhoto phone')
    .sort({ createdAt: -1 });

  const bookings = docs.map(normalizeBookingStatusForClient);
  res.status(200).json(new ApiResponse(200, bookings, 'Artist bookings fetched'));
});

export const getAllBookingsAdmin = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, includeOrderLinked = 'false' } = req.query;
  const query = {
    ...(String(includeOrderLinked).toLowerCase() === 'true' ? {} : { sourceType: 'DIRECT_BOOKING' }),
  };
  if (status) query.status = status;

  const skip = (page - 1) * limit;

  const [docs, totalCount] = await Promise.all([
    Booking.find(query)
      .populate('user', 'name phone')
      .populate('artist', 'name category phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Booking.countDocuments(query)
  ]);
  const bookings = docs.map(normalizeBookingStatusForClient);

  res.status(200).json(
    new ApiResponse(200, {
      bookings,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalCount,
        totalPages: Math.ceil(totalCount / limit)
      }
    }, 'All bookings fetched successfully')
  );
});

export const markBookingOngoing = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const booking = await Booking.findOne({
    _id: id,
    $or: [{ artist: req.user._id }, { 'assignedArtists.artist': req.user._id }],
  }).populate('user', 'phone');
  if (!booking) throw new ApiError(404, 'Booking not found or not assigned to you');
  if (booking.paymentStatus !== PAYMENT_STATUS.PAID) {
    throw new ApiError(400, 'Booking must be fully paid before marking as ongoing');
  }
  if (![BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.UPCOMING].includes(booking.status)) {
    throw new ApiError(400, 'Only upcoming bookings can be started');
  }
  const eventDateKey = toDateKeyInIST(booking?.eventDetails?.date);
  const todayKey = toDateKeyInIST(new Date());
  if (!eventDateKey || !todayKey) {
    throw new ApiError(400, 'Invalid event date for this booking');
  }
  if (todayKey < eventDateKey) {
    throw new ApiError(400, 'Event can only be started on the booking date');
  }

  booking.status = BOOKING_STATUS.ONGOING;
  booking.ongoingAt = new Date();
  booking.closure = {
    ...(booking.closure || {}),
    requestedByArtistAt: new Date(),
  };
  await booking.save();
  await syncOrderItemStatusFromLinkedBooking({
    bookingId: booking._id,
    status: BOOKING_STATUS.ONGOING,
    timestamps: {
      ongoingAt: booking.ongoingAt,
    },
  });
  res.status(200).json(new ApiResponse(200, normalizeBookingStatusForClient(booking), 'Booking marked as ongoing'));
});

export const completeBookingWithHappyCode = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { happyCode } = req.body;
  if (!/^\d{4}$/.test(String(happyCode || ''))) {
    throw new ApiError(400, 'Happy code must be a 4-digit code');
  }

  const booking = await Booking.findOne({
    _id: id,
    $or: [{ artist: req.user._id }, { 'assignedArtists.artist': req.user._id }],
  }).populate('user', 'phone');
  if (!booking) throw new ApiError(404, 'Booking not found or not assigned to you');
  if (booking.status !== BOOKING_STATUS.ONGOING) {
    throw new ApiError(400, 'Only ongoing bookings can be completed with happy code');
  }
  if (booking.happyCode !== String(happyCode)) {
    throw new ApiError(400, 'Invalid happy code');
  }

  booking.status = BOOKING_STATUS.COMPLETED;
  booking.closedAt = new Date();
  booking.happyCodeVerifiedAt = new Date();
  booking.closure = {
    ...(booking.closure || {}),
    closedBy: req.user._id,
    closedByRole: 'ARTIST',
  };
  await booking.save();
  await syncOrderItemStatusFromLinkedBooking({
    bookingId: booking._id,
    status: BOOKING_STATUS.COMPLETED,
    timestamps: {
      closedAt: booking.closedAt,
      happyCodeVerifiedAt: booking.happyCodeVerifiedAt,
    },
  });

  if (!booking.smsNotifications?.serviceCompletedSentAt && booking.user?.phone) {
    await sendServiceCompleted({
      phone: booking.user.phone,
      orderId: String(booking._id),
    });
    booking.smsNotifications = {
      ...(booking.smsNotifications || {}),
      serviceCompletedSentAt: new Date(),
    };
    await booking.save();
  }

  res.status(200).json(new ApiResponse(200, normalizeBookingStatusForClient(booking), 'Booking completed successfully'));
});
