import mongoose from 'mongoose';
import { ALL_BOOKING_SLOT_ENUM, getSlotIntervalUtc } from '../utils/istTime.js';

const bookingSchema = new mongoose.Schema(
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
      index: true,
    },
    eventDetails: {
      date: { type: Date, required: true },
      slot: { type: String, enum: ALL_BOOKING_SLOT_ENUM, required: true },
      startUtc: { type: Date },
      endUtc: { type: Date },
      type: { type: String, required: true }, // array of strings maybe? e.g. 'Ramleela', 'Sundarkand'
      expectedAudienceSize: { type: Number },
      specialRequirements: { type: String },
    },
    location: {
      addressId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Address',
      },
      address: { type: String, required: true },
      city: { type: String, required: true },
      pinCode: { type: String },
      saveAs: { type: String },
      recipientName: { type: String },
      recipientPhone: { type: String },
    },
    pricing: {
      agreedPrice: { type: Number, required: true },
      currency: { type: String, default: 'INR' },
    },
    status: {
      type: String,
      enum: ['PENDING', 'CONFIRMED', 'UPCOMING', 'ONGOING', 'COMPLETED', 'CANCELLED', 'REJECTED', 'MANUAL_REVIEW'],
      default: 'PENDING',
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ['PENDING', 'PAID', 'REFUNDED', 'FAILED'],
      default: 'PENDING',
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment', // Resolves when payment module is built
    },
    paymentPlan: {
      type: String,
      enum: ['FULL', 'PARTIAL'],
      default: 'FULL',
    },
    amountPaid: {
      type: Number,
      default: 0,
    },
    remainingAmount: {
      type: Number,
      default: 0,
    },
    fullyPaidAt: {
      type: Date,
    },
    bookedAt: {
      type: Date,
      default: Date.now,
    },
    ongoingAt: {
      type: Date,
    },
    closedAt: {
      type: Date,
    },
    cancelledAt: {
      type: Date,
    },
    reminderSentAt: {
      type: Date,
    },
    manualReviewAt: {
      type: Date,
    },
    happyCode: {
      type: String,
      minlength: 4,
      maxlength: 4,
    },
    happyCodeGeneratedAt: {
      type: Date,
    },
    happyCodeVerifiedAt: {
      type: Date,
    },
    closure: {
      requestedByArtistAt: {
        type: Date,
      },
      closedBy: {
        type: mongoose.Schema.Types.ObjectId,
      },
      closedByRole: {
        type: String,
        enum: ['USER', 'ARTIST', 'ADMIN'],
      },
      cancellationReason: {
        type: String,
        trim: true,
      },
      cancelledBy: {
        type: mongoose.Schema.Types.ObjectId,
      },
      cancelledByRole: {
        type: String,
        enum: ['USER', 'ARTIST', 'ADMIN'],
      },
    },
    assignment: {
      assignedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      assignedAt: {
        type: Date,
      },
      source: {
        type: String,
        enum: ['ADMIN', 'RAMLEELA_CUSTOMIZATION'],
      },
      note: {
        type: String,
        trim: true,
      },
    },
    assignedArtists: [
      {
        artist: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Artist',
          required: true,
        },
        assignedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        assignedAt: {
          type: Date,
          default: Date.now,
        },
        source: {
          type: String,
          enum: ['ADMIN', 'RAMLEELA_CUSTOMIZATION'],
        },
        note: {
          type: String,
          trim: true,
        },
      },
    ],
    sourceType: {
      type: String,
      enum: ['DIRECT_BOOKING', 'ORDER_ITEM'],
      default: 'DIRECT_BOOKING',
      index: true,
    },
    sourceRef: {
      orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
      },
      itemIndex: {
        type: Number,
      },
    },
    inventoryCommitted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

bookingSchema.pre('validate', function bookingIntervalPreValidate(next) {
  try {
    if (this.eventDetails?.date && this.eventDetails?.slot) {
      const { startUtc, endUtc } = getSlotIntervalUtc(this.eventDetails.date, this.eventDetails.slot);
      if (startUtc && endUtc) {
        this.eventDetails.startUtc = startUtc;
        this.eventDetails.endUtc = endUtc;
      }
    }
  } catch (err) {
    return next(err);
  }
  next();
});

export const Booking = mongoose.model('Booking', bookingSchema);
