import { Booking } from '../models/booking.model.js';
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

  return updates.length;
};

export const startBookingReminderWorker = () => {
  if (bookingReminderTimer) return;
  bookingReminderTimer = setInterval(() => {
    runBookingReminderSweep().catch((error) => {
      console.error('Booking reminder sweep failed:', error?.message || error);
    });
  }, 60 * 60 * 1000);
};

