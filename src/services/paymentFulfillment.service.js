import { Artist } from '../models/artist.model.js';
import { Booking } from '../models/booking.model.js';
import { Order } from '../models/order.model.js';
import { Payment } from '../models/payment.model.js';
import { User } from '../models/user.model.js';
import {
  BOOKING_STATUS,
  PAYMENT_PLAN,
  PAYMENT_STATUS,
  PAYMENT_TYPE,
  createHappyCode,
  requiresFullPaymentByEventDate,
} from '../utils/bookingLifecycle.js';
import { ApiError } from '../utils/ApiError.js';

export const fulfillActivationPayment = async ({ activationFor, userId, artistId, amount, requestId }) => {
  if (activationFor === 'ARTIST') {
    const artist = await Artist.findById(artistId);
    if (!artist) throw new ApiError(404, 'Artist not found');
    if (artist.activationChargeStatus === 'PAID') return { alreadyApplied: true, artist };

    artist.activationChargeStatus = 'PAID';
    artist.activationChargePaidAt = new Date();
    await artist.save();

    await Payment.create({
      artist: artist._id,
      amount,
      currency: 'INR',
      paymentType: PAYMENT_TYPE.ARTIST_ACTIVATION,
      status: 'SUCCESS',
      metadata: {
        source: 'MANUAL_QR',
        activationFor,
        requestId,
      },
    });
    return { alreadyApplied: false, artist };
  }

  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, 'User not found');
  if (user.activationChargeStatus === 'PAID') return { alreadyApplied: true, user };

  user.activationChargeStatus = 'PAID';
  user.activationChargePaidAt = new Date();
  await user.save();

  await Payment.create({
    user: userId,
    amount,
    currency: 'INR',
    paymentType: PAYMENT_TYPE.ACTIVATION,
    status: 'SUCCESS',
    metadata: {
      source: 'MANUAL_QR',
      activationFor,
      requestId,
    },
  });

  return { alreadyApplied: false, user };
};

const applyOnBooking = async ({ bookingId, amount, paymentType, requestId }) => {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new ApiError(404, 'Booking not found');

  const previousAmountPaid = Number(booking.amountPaid || 0);
  const updatedAmountPaid = previousAmountPaid + Number(amount || 0);
  const totalAmount = Number(booking.pricing?.agreedPrice || 0);
  const remainingAmount = Math.max(0, totalAmount - updatedAmountPaid);
  const fullyPaid = remainingAmount <= 0;

  booking.amountPaid = updatedAmountPaid;
  booking.remainingAmount = remainingAmount;
  booking.paymentStatus = fullyPaid ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PENDING;
  booking.paymentPlan = paymentType === PAYMENT_TYPE.BOOKING_PARTIAL ? PAYMENT_PLAN.PARTIAL : booking.paymentPlan;
  if (updatedAmountPaid > 0) {
    booking.inventoryCommitted = true;
  }
  if (fullyPaid) {
    booking.fullyPaidAt = booking.fullyPaidAt || new Date();
    booking.status = BOOKING_STATUS.UPCOMING;
    if (!booking.happyCode) {
      booking.happyCode = createHappyCode();
      booking.happyCodeGeneratedAt = new Date();
    }
  }
  await booking.save();

  const payment = await Payment.create({
    booking: booking._id,
    user: booking.user,
    artist: booking.artist,
    amount,
    currency: booking.pricing?.currency || 'INR',
    paymentType,
    status: 'SUCCESS',
    metadata: {
      source: 'MANUAL_QR',
      requestId,
    },
  });

  booking.paymentId = payment._id;
  await booking.save();

  return booking;
};

const applyOnOrder = async ({ orderId, amount, paymentType, requestId }) => {
  const order = await Order.findById(orderId);
  if (!order) throw new ApiError(404, 'Order not found');

  const previousAmountPaid = Number(order.amountPaid || 0);
  const updatedAmountPaid = previousAmountPaid + Number(amount || 0);
  const totalAmount = Number(order.grandTotal || 0);
  const remainingAmount = Math.max(0, totalAmount - updatedAmountPaid);
  const fullyPaid = remainingAmount <= 0;

  order.amountPaid = updatedAmountPaid;
  order.remainingAmount = remainingAmount;
  order.paymentStatus = fullyPaid ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PENDING;
  order.paymentPlan = paymentType === PAYMENT_TYPE.ORDER_PARTIAL ? PAYMENT_PLAN.PARTIAL : order.paymentPlan;
  if (fullyPaid) {
    order.fullyPaidAt = order.fullyPaidAt || new Date();
  }

  const totalItemAmount = Number(
    (order.items || []).reduce((sum, item) => sum + Number(item?.price || 0), 0)
  );
  const paidRatio = totalAmount > 0 ? Math.min(updatedAmountPaid / totalAmount, 1) : 0;
  for (const item of order.items || []) {
    const itemPrice = Number(item?.price || 0);
    const proportionalPaid = totalItemAmount > 0 ? itemPrice * paidRatio : 0;
    const nextItemPaid = Math.max(0, Math.min(itemPrice, proportionalPaid));
    const nextItemRemaining = Math.max(0, itemPrice - nextItemPaid);
    item.amountPaid = nextItemPaid;
    item.remainingAmount = nextItemRemaining;
    item.paymentPlan = order.paymentPlan;

    if (nextItemRemaining <= 0) {
      item.fullyPaidAt = item.fullyPaidAt || new Date();
      if (Array.isArray(item.assignedArtists) && item.assignedArtists.length > 0) {
        item.status = BOOKING_STATUS.UPCOMING;
        if (!item.happyCode) {
          item.happyCode = createHappyCode();
          item.happyCodeGeneratedAt = new Date();
        }
      } else {
        item.status = BOOKING_STATUS.PENDING;
      }
    } else {
      item.status = requiresFullPaymentByEventDate(item.date)
        ? BOOKING_STATUS.MANUAL_REVIEW
        : BOOKING_STATUS.PENDING;
    }
  }
  await order.save();

  await Promise.all(
    (order.items || []).map(async (item, itemIndex) => {
      const linkedBooking = await Booking.findOne({
        sourceType: 'ORDER_ITEM',
        'sourceRef.orderId': order._id,
        'sourceRef.itemIndex': itemIndex,
      });
      if (!linkedBooking) return;
      linkedBooking.paymentStatus = Number(item.remainingAmount || 0) <= 0 ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PENDING;
      linkedBooking.paymentPlan = order.paymentPlan || linkedBooking.paymentPlan;
      linkedBooking.amountPaid = Number(item.amountPaid || 0);
      linkedBooking.remainingAmount = Number(item.remainingAmount || 0);
      linkedBooking.status = item.status || linkedBooking.status;
      if (item.happyCode) {
        linkedBooking.happyCode = item.happyCode;
        linkedBooking.happyCodeGeneratedAt = item.happyCodeGeneratedAt || linkedBooking.happyCodeGeneratedAt || new Date();
      }
      await linkedBooking.save();
    })
  );

  const payment = await Payment.create({
    order: order._id,
    user: order.user,
    amount,
    currency: order.currency || 'INR',
    paymentType,
    status: 'SUCCESS',
    metadata: {
      source: 'MANUAL_QR',
      requestId,
    },
  });

  order.paymentId = payment._id;
  await order.save();

  return order;
};

export const fulfillBookingPayment = async ({ targetType, bookingId, orderId, amount, paymentType, requestId }) => {
  if (targetType === 'BOOKING') {
    return applyOnBooking({ bookingId, amount, paymentType, requestId });
  }
  return applyOnOrder({ orderId, amount, paymentType, requestId });
};
