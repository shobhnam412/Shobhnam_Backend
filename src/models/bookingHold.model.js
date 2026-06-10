import mongoose from 'mongoose';
import {
  ALL_BOOKING_SLOT_ENUM,
  BOOKING_SLOT_ENUM,
  getSlotsSpanUtc,
  normalizeSlotsInput,
} from '../utils/istTime.js';

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
      enum: ALL_BOOKING_SLOT_ENUM,
      required: true,
    },
    slots: {
      type: [{ type: String, enum: BOOKING_SLOT_ENUM }],
      default: undefined,
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

bookingHoldSchema.pre('validate', function bookingHoldSlotsPreValidate() {
  const normalized = normalizeSlotsInput({
    slot: this.slot,
    slots: this.slots,
  });
  if (!normalized.length) return;

  this.slots = normalized;
  this.slot = normalized[0];

  const refDate = this.startUtc || new Date();
  const { startUtc, endUtc, dateKey } = getSlotsSpanUtc(refDate, normalized);
  if (startUtc && endUtc) {
    this.startUtc = startUtc;
    this.endUtc = endUtc;
    if (dateKey) this.dateKey = dateKey;
  }
});

export const BookingHold = mongoose.model('BookingHold', bookingHoldSchema);
