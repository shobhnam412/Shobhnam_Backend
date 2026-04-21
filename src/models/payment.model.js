import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema(
  {
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
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    artist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Artist',
      validate: {
        validator: function validatePaymentOwner(value) {
          return Boolean(this.user || value);
        },
        message: 'Payment requires either user or artist',
      },
    },
    razorpayOrderId: {
      type: String,
      index: true,
    },
    razorpayPaymentId: {
      type: String,
    },
    razorpaySignature: {
      type: String,
    },
    amount: {
      type: Number,
      required: true,
    },
    paymentType: {
      type: String,
      enum: ['ACTIVATION', 'ARTIST_ACTIVATION', 'BOOKING_FULL', 'BOOKING_PARTIAL', 'BOOKING_REMAINING', 'ORDER_FULL', 'ORDER_PARTIAL', 'ORDER_REMAINING'],
      default: 'ORDER_FULL',
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    currency: {
      type: String,
      default: 'INR',
    },
    status: {
      type: String,
      enum: ['CREATED', 'SUCCESS', 'FAILED', 'REFUNDED'],
      default: 'CREATED',
    },
  },
  { timestamps: true }
);

export const Payment = mongoose.model('Payment', paymentSchema);
