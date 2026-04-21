import mongoose from 'mongoose';

const bookingPaymentVerificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      index: true,
    },
    targetType: {
      type: String,
      enum: ['BOOKING', 'ORDER'],
      required: true,
      index: true,
    },
    paymentPlan: {
      type: String,
      enum: ['FULL', 'PARTIAL'],
      default: 'FULL',
    },
    paymentType: {
      type: String,
      enum: ['BOOKING_FULL', 'BOOKING_PARTIAL', 'BOOKING_REMAINING', 'ORDER_FULL', 'ORDER_PARTIAL', 'ORDER_REMAINING'],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    expectedAmount: {
      type: Number,
      required: true,
      min: 1,
    },
    currency: {
      type: String,
      default: 'INR',
    },
    utrNumber: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    screenshotUrl: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
      index: true,
    },
    submittedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    reviewedAt: {
      type: Date,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

bookingPaymentVerificationSchema.index({ user: 1, booking: 1, status: 1 });
bookingPaymentVerificationSchema.index({ user: 1, order: 1, status: 1 });
bookingPaymentVerificationSchema.index({ targetType: 1, status: 1, submittedAt: -1 });

export const BookingPaymentVerification = mongoose.model('BookingPaymentVerification', bookingPaymentVerificationSchema);
