import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { Booking } from '../src/models/booking.model.js';
import { Order } from '../src/models/order.model.js';
import { User } from '../src/models/user.model.js';
import { BOOKING_STATUS, PAYMENT_STATUS } from '../src/utils/bookingLifecycle.js';

const run = async () => {
  await mongoose.connect(env.MONGODB_URI);

  const users = await User.updateMany(
    { activationChargeStatus: { $exists: false } },
    { $set: { activationChargeStatus: 'PENDING' } }
  );

  const bookings = await Booking.find({});
  for (const booking of bookings) {
    if (!booking.bookedAt) booking.bookedAt = booking.createdAt || new Date();
    if (!booking.paymentPlan) booking.paymentPlan = 'FULL';
    const agreed = Number(booking.pricing?.agreedPrice || 0);
    if (booking.paymentStatus === PAYMENT_STATUS.PAID) {
      booking.amountPaid = agreed;
      booking.remainingAmount = 0;
      if (!booking.fullyPaidAt) booking.fullyPaidAt = booking.updatedAt || new Date();
      if (booking.status === BOOKING_STATUS.CONFIRMED) booking.status = BOOKING_STATUS.UPCOMING;
    } else {
      booking.amountPaid = Number(booking.amountPaid || 0);
      booking.remainingAmount = Math.max(0, agreed - booking.amountPaid);
    }
    await booking.save();
  }

  const orders = await Order.find({});
  for (const order of orders) {
    if (!order.bookedAt) order.bookedAt = order.createdAt || new Date();
    if (!order.paymentPlan) order.paymentPlan = 'FULL';
    const total = Number(order.grandTotal || 0);
    if (order.paymentStatus === PAYMENT_STATUS.PAID) {
      order.amountPaid = total;
      order.remainingAmount = 0;
      if (!order.fullyPaidAt) order.fullyPaidAt = order.updatedAt || new Date();
    } else {
      order.amountPaid = Number(order.amountPaid || 0);
      order.remainingAmount = Math.max(0, total - order.amountPaid);
    }
    await order.save();
  }

  console.log(`Backfill completed. users=${users.modifiedCount} bookings=${bookings.length} orders=${orders.length}`);
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
