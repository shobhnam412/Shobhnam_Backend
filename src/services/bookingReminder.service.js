import { Booking } from '../models/booking.model.js';
import { Order } from '../models/order.model.js';
import {
  BOOKING_STATUS,
  PAYMENT_STATUS,
  requiresFullPaymentByEventDate,
} from '../utils/bookingLifecycle.js';
import { createInAppNotification, NOTIFICATION_TYPE } from './notification.service.js';

let bookingReminderTimer = null;

const shouldMarkForManualReview = (booking) => {
  if (!booking?.eventDetails?.date) return false;
  return requiresFullPaymentByEventDate(booking.eventDetails.date);
};

const hasHighRemainingShare = ({ remainingAmount, totalAmount }) => {
  const total = Number(totalAmount || 0);
  if (total <= 0) return false;
  const remaining = Number(remainingAmount || 0);
  return remaining / total >= 0.8;
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
    updates.map(async (booking) => {
      booking.status = BOOKING_STATUS.MANUAL_REVIEW;
      if (!booking.manualReviewAt) booking.manualReviewAt = new Date();
      if (!booking.reminderSentAt) booking.reminderSentAt = new Date();
      await booking.save();

      const shouldNotify = hasHighRemainingShare({
        remainingAmount: booking.remainingAmount,
        totalAmount: booking.pricing?.agreedPrice,
      });
      if (!shouldNotify) return;

      await createInAppNotification({
        recipientType: 'USER',
        recipientId: booking.user,
        type: NOTIFICATION_TYPE.PAYMENT_REMINDER,
        title: 'Payment reminder',
        message: `Payment is pending for your booking. INR ${Number(booking.remainingAmount || 0).toFixed(2)} is still due.`,
        meta: {
          referenceDomain: 'BOOKING',
          referenceId: booking._id,
          reminderType: 'PENDING_PAYMENT_80_PERCENT',
        },
        dedupeBy: 'REFERENCE',
      });
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

        const shouldNotify = hasHighRemainingShare({
          remainingAmount: item.remainingAmount,
          totalAmount: item.price,
        });
        if (!shouldNotify) continue;

        await createInAppNotification({
          recipientType: 'USER',
          recipientId: order.user,
          type: NOTIFICATION_TYPE.PAYMENT_REMINDER,
          title: 'Payment reminder',
          message: `Payment is pending for one of your order items. INR ${Number(item.remainingAmount || 0).toFixed(2)} is still due.`,
          meta: {
            referenceDomain: 'ORDER_ITEM',
            referenceId: `${order._id}:${String(item._id || '')}`,
            reminderType: 'PENDING_PAYMENT_80_PERCENT',
          },
          dedupeBy: 'REFERENCE',
        });
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

