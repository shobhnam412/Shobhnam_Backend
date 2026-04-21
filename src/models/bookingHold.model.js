import mongoose from 'mongoose';

const bookingHoldSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    artist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Artist',
      required: true,
      index: true,
    },
    addressId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Address',
    },
    startUtc: { type: Date, required: true, index: true },
    endUtc: { type: Date, required: true, index: true },
    dateKey: { type: String, trim: true, index: true },
    slot: {
      type: String,
      enum: ['6AM-12PM', '12PM-6PM', '6PM-12AM', '12AM-6AM'],
      required: true,
    },
    state: {
      type: String,
      enum: ['ACTIVE', 'CONSUMED', 'RELEASED'],
      default: 'ACTIVE',
      index: true,
    },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

bookingHoldSchema.index({ artist: 1, state: 1, expiresAt: 1 });

export const BookingHold = mongoose.model('BookingHold', bookingHoldSchema);
