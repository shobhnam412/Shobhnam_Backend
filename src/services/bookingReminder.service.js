import { Booking } from '../models/booking.model.js';
import { Order } from '../models/order.model.js';
import {
  BOOKING_STATUS,
  PAYMENT_STATUS,
  requiresFullPaymentByEventDate,
} from '../utils/bookingLifecycle.js';

let bookingReminderTimer = null;

const shouldMarkForManualReview = (booking) => {
  if (!booking?.eventDetails?.date) return false;
  return requiresFullPaymentByEventDate(booking.eventDetails.date);
};

export const runBookingReminderSweep = async () => {
  const candidates = await Booking.find({
    status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.UPCOMING] },
    paymentStatus: { $ne: PAYMENT_STATUS.PAID },
    remainingAmount: { $gt: 0 },
  });

  const updates = candidates.filter(shouldMarkForManualReview);
  if (!updates.length) return 0;

  await Promise.all(
    updates.map((booking) => {
      booking.status = BOOKING_STATUS.MANUAL_REVIEW;
      if (!booking.manualReviewAt) booking.manualReviewAt = new Date();
      if (!booking.reminderSentAt) booking.reminderSentAt = new Date();
      return booking.save();
    })
  );

  const orderCandidates = await Order.find({
    paymentStatus: { $ne: PAYMENT_STATUS.PAID },
    remainingAmount: { $gt: 0 },
  });

  let updatedOrderItems = 0;
  await Promise.all(
    orderCandidates.map(async (order) => {
      let hasUpdates = false;
      for (const item of order.items || []) {
        const shouldEscalate = requiresFullPaymentByEventDate(item?.date);
        const isUnpaid = Number(item?.remainingAmount || 0) > 0;
        if (!shouldEscalate || !isUnpaid) continue;
        if (item.status !== BOOKING_STATUS.MANUAL_REVIEW) {
          item.status = BOOKING_STATUS.MANUAL_REVIEW;
          updatedOrderItems += 1;
          hasUpdates = true;
        }
      }
      if (hasUpdates) {
        await order.save();
      }
    })
  );

  return updates.length + updatedOrderItems;
};

export const startBookingReminderWorker = () => {
  if (bookingReminderTimer) return;
  bookingReminderTimer = setInterval(() => {
    runBookingReminderSweep().catch((error) => {
      console.error('Booking reminder sweep failed:', error?.message || error);
    });
  }, 60 * 60 * 1000);
};

