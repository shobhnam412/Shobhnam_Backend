import { Artist } from '../models/artist.model.js';
import { ActivationPaymentVerification } from '../models/activationPaymentVerification.model.js';
import { Booking } from '../models/booking.model.js';
import { BookingPaymentVerification } from '../models/bookingPaymentVerification.model.js';
import { Order } from '../models/order.model.js';
import { User } from '../models/user.model.js';
import { createPaymentPendingNotification } from '../services/notification.service.js';
import {
  ACTIVATION_CHARGE_AMOUNT,
  BOOKING_STATUS,
  PAYMENT_PLAN,
  PAYMENT_TYPE,
  calculatePaymentSplit,
  normalizePaymentPlanForEventDate,
  normalizePaymentPlanForOrderItems,
} from '../utils/bookingLifecycle.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const ARTIST_ACTIVATION_CHARGE_AMOUNT = 11;
const AMOUNT_TOLERANCE = 0.01;

const toAmount = (value) => Number(Number(value || 0).toFixed(2));
const isAmountEqual = (received, expected) => Math.abs(toAmount(received) - toAmount(expected)) <= AMOUNT_TOLERANCE;

const getBookingPayable = async ({ bookingId, userId, paymentPlan }) => {
  const booking = await Booking.findOne({ _id: bookingId, user: userId });
  if (!booking) throw new ApiError(404, 'Booking not found');
  if (![BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.UPCOMING, BOOKING_STATUS.MANUAL_REVIEW].includes(booking.status)) {
    throw new ApiError(400, 'Booking is not in a payable state');
  }
  if (booking.paymentStatus === 'PAID') throw new ApiError(400, 'Booking already fully paid');

  const selectedPlan = booking.amountPaid > 0
    ? booking.paymentPlan
    : normalizePaymentPlanForEventDate(paymentPlan || booking.paymentPlan, booking.eventDetails?.date);
  const split = calculatePaymentSplit(booking.pricing.agreedPrice, selectedPlan);
  const payableAmount = booking.amountPaid > 0 ? Math.max(0, booking.remainingAmount || 0) : split.currentPayableAmount;
  if (payableAmount <= 0) throw new ApiError(400, 'No payable amount pending for this booking');
  const paymentType = booking.amountPaid > 0
    ? PAYMENT_TYPE.BOOKING_REMAINING
    : (split.paymentPlan === PAYMENT_PLAN.PARTIAL ? PAYMENT_TYPE.BOOKING_PARTIAL : PAYMENT_TYPE.BOOKING_FULL);

  return {
    targetType: 'BOOKING',
    booking,
    expectedAmount: payableAmount,
    paymentPlan: split.paymentPlan,
    paymentType,
    currency: booking.pricing.currency || 'INR',
  };
};

const getOrderPayable = async ({ orderId, userId, paymentPlan }) => {
  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) throw new ApiError(404, 'Order not found');
  if (order.paymentStatus === 'PAID') throw new ApiError(400, 'Order already fully paid');

  const selectedPlan = order.amountPaid > 0
    ? order.paymentPlan
    : normalizePaymentPlanForOrderItems(paymentPlan || order.paymentPlan, order.items || []);
  const split = calculatePaymentSplit(order.grandTotal, selectedPlan);
  const payableAmount = order.amountPaid > 0 ? Math.max(0, order.remainingAmount || 0) : split.currentPayableAmount;
  if (payableAmount <= 0) throw new ApiError(400, 'No payable amount pending for this order');
  const paymentType = order.amountPaid > 0
    ? PAYMENT_TYPE.ORDER_REMAINING
    : (split.paymentPlan === PAYMENT_PLAN.PARTIAL ? PAYMENT_TYPE.ORDER_PARTIAL : PAYMENT_TYPE.ORDER_FULL);

  return {
    targetType: 'ORDER',
    order,
    expectedAmount: payableAmount,
    paymentPlan: split.paymentPlan,
    paymentType,
    currency: order.currency || 'INR',
  };
};

export const createRazorpayOrder = asyncHandler(async () => {
  throw new ApiError(410, 'Razorpay flow is disabled. Please submit UPI QR payment proof.');
});

export const verifyPayment = asyncHandler(async () => {
  throw new ApiError(410, 'Razorpay verification is disabled. Payments are verified manually by admin.');
});

export const razorpayWebhook = asyncHandler(async (req, res) => {
  res.status(410).send('Razorpay webhook disabled');
});

export const submitBookingPaymentVerification = asyncHandler(async (req, res) => {
  const { bookingId, orderId, paymentPlan, utrNumber, amount } = req.body;
  const screenshotUrl = req.file?.location;

  if (!utrNumber || !String(utrNumber).trim()) throw new ApiError(400, 'UTR number is required');
  if (!amount || Number(amount) <= 0) throw new ApiError(400, 'Amount is required');
  if (!screenshotUrl) throw new ApiError(400, 'Payment screenshot is required');
  if ((!bookingId && !orderId) || (bookingId && orderId)) {
    throw new ApiError(400, 'Provide either bookingId or orderId');
  }

  const user = await User.findById(req.user._id).select('activationChargeStatus');
  if (!user) throw new ApiError(404, 'User not found');
  if (user.activationChargeStatus !== 'PAID') {
    throw new ApiError(403, `Activation charge is pending. Please pay INR ${ACTIVATION_CHARGE_AMOUNT} first.`);
  }

  const payable = bookingId
    ? await getBookingPayable({ bookingId, userId: req.user._id, paymentPlan })
    : await getOrderPayable({ orderId, userId: req.user._id, paymentPlan });
  const submittedAmount = toAmount(amount);
  if (!isAmountEqual(submittedAmount, payable.expectedAmount)) {
    throw new ApiError(
      400,
      `Invalid booking payment amount. Expected INR ${payable.expectedAmount} for this payment step.`
    );
  }

  const duplicatePending = await BookingPaymentVerification.findOne({
    user: req.user._id,
    status: 'PENDING',
    ...(payable.targetType === 'BOOKING' ? { booking: payable.booking._id } : { order: payable.order._id }),
  });
  if (duplicatePending) {
    throw new ApiError(409, 'A payment verification request is already pending for this item');
  }

  const request = await BookingPaymentVerification.create({
    user: req.user._id,
    booking: payable.targetType === 'BOOKING' ? payable.booking._id : undefined,
    order: payable.targetType === 'ORDER' ? payable.order._id : undefined,
    targetType: payable.targetType,
    paymentPlan: payable.paymentPlan,
    paymentType: payable.paymentType,
    amount: submittedAmount,
    expectedAmount: payable.expectedAmount,
    currency: payable.currency,
    utrNumber: String(utrNumber).trim(),
    screenshotUrl,
    status: 'PENDING',
    submittedAt: new Date(),
    metadata: {
      source: 'USER_APP',
    },
  });

  await createPaymentPendingNotification({
    recipientType: 'USER',
    recipientId: req.user._id,
    paymentDomain: payable.targetType === 'BOOKING' ? 'BOOKING' : 'ORDER',
    referenceId: payable.targetType === 'BOOKING' ? payable.booking._id : payable.order._id,
    title: 'Payment verification pending',
    message: 'Your payment proof is under review by admin. It will be removed once approved.',
    meta: {
      verificationRequestId: request._id,
      targetType: payable.targetType,
    },
  });

  res.status(201).json(new ApiResponse(201, request, 'Payment verification request submitted'));
});

export const getMyBookingPaymentVerificationStatus = asyncHandler(async (req, res) => {
  const { bookingId, orderId } = req.query;
  if ((!bookingId && !orderId) || (bookingId && orderId)) {
    throw new ApiError(400, 'Provide either bookingId or orderId');
  }

  const query = {
    user: req.user._id,
    ...(bookingId ? { booking: bookingId } : { order: orderId }),
  };

  const latest = await BookingPaymentVerification.findOne(query).sort({ createdAt: -1 });
  res.status(200).json(new ApiResponse(200, latest || null, 'Payment verification status fetched'));
});

export const submitActivationPaymentVerification = asyncHandler(async (req, res) => {
  const { activationFor = 'USER', utrNumber, amount } = req.body;
  const screenshotUrl = req.file?.location;

  if (!utrNumber || !String(utrNumber).trim()) throw new ApiError(400, 'UTR number is required');
  if (!amount || Number(amount) <= 0) throw new ApiError(400, 'Amount is required');
  if (!screenshotUrl) throw new ApiError(400, 'Payment screenshot is required');

  const normalizedFor = activationFor === 'ARTIST' ? 'ARTIST' : 'USER';
  const expectedAmount = normalizedFor === 'ARTIST' ? ARTIST_ACTIVATION_CHARGE_AMOUNT : ACTIVATION_CHARGE_AMOUNT;
  const submittedAmount = toAmount(amount);
  if (!isAmountEqual(submittedAmount, expectedAmount)) {
    throw new ApiError(400, `Activation charge must be exactly INR ${expectedAmount}.`);
  }

  let query;
  let alreadyPaid = false;
  if (normalizedFor === 'ARTIST') {
    if (req.user.role !== 'ARTIST') throw new ApiError(403, 'Only artist can submit artist activation request');
    const artist = await Artist.findById(req.user._id).select('activationChargeStatus');
    if (!artist) throw new ApiError(404, 'Artist not found');
    alreadyPaid = artist.activationChargeStatus === 'PAID';
    query = { activationFor: 'ARTIST', artist: req.user._id };
  } else {
    if (req.user.role !== 'USER') throw new ApiError(403, 'Only user can submit activation request');
    const user = await User.findById(req.user._id).select('activationChargeStatus');
    if (!user) throw new ApiError(404, 'User not found');
    alreadyPaid = user.activationChargeStatus === 'PAID';
    query = { activationFor: 'USER', user: req.user._id };
  }
  if (alreadyPaid) throw new ApiError(400, 'Activation charge already paid');

  const duplicatePending = await ActivationPaymentVerification.findOne({
    ...query,
    status: 'PENDING',
  });
  if (duplicatePending) {
    throw new ApiError(409, 'An activation payment verification request is already pending');
  }

  const request = await ActivationPaymentVerification.create({
    ...query,
    activationFor: normalizedFor,
    amount: submittedAmount,
    currency: 'INR',
    utrNumber: String(utrNumber).trim(),
    screenshotUrl,
    status: 'PENDING',
    submittedAt: new Date(),
    metadata: {
      expectedAmount,
    },
  });

  await createPaymentPendingNotification({
    recipientType: normalizedFor,
    recipientId: normalizedFor === 'ARTIST' ? req.user._id : req.user._id,
    paymentDomain: 'ACTIVATION',
    referenceId: normalizedFor === 'ARTIST' ? req.user._id : req.user._id,
    title: 'Activation payment pending',
    message: 'Your activation payment proof is pending admin approval.',
    meta: {
      verificationRequestId: request._id,
      activationFor: normalizedFor,
    },
  });

  res.status(201).json(new ApiResponse(201, request, 'Activation payment verification request submitted'));
});

export const getMyActivationPaymentVerificationStatus = asyncHandler(async (req, res) => {
  const activationFor = req.query.activationFor === 'ARTIST' ? 'ARTIST' : 'USER';
  const query = activationFor === 'ARTIST'
    ? { activationFor, artist: req.user._id }
    : { activationFor, user: req.user._id };
  const latest = await ActivationPaymentVerification.findOne(query).sort({ createdAt: -1 });
  res.status(200).json(new ApiResponse(200, latest || null, 'Activation payment verification status fetched'));
});
