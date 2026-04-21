import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema(
  {
    serviceName: { type: String, required: true },
    packageTitle: { type: String, required: true },
    price: { type: Number, required: true },
    dateTime: { type: String },
    date: { type: Date },
    slot: { type: String, enum: ['6AM-12PM', '12PM-6PM', '6PM-12AM', '12AM-6AM'] },
    addressId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Address',
    },
    addressDetail: { type: String },
    addressLabel: { type: String },
    city: { type: String },
    pinCode: { type: String },
    artist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Artist',
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
        enum: ['ADMIN'],
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
          enum: ['ADMIN'],
        },
        note: {
          type: String,
          trim: true,
        },
      },
    ],
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
    status: {
      type: String,
      enum: ['PENDING', 'UPCOMING', 'ONGOING', 'COMPLETED', 'CANCELLED', 'MANUAL_REVIEW'],
      default: 'PENDING',
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
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    items: {
      type: [orderItemSchema],
      required: true,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    travelingFee: {
      type: Number,
      default: 500,
    },
    grandTotal: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'INR',
    },
    paymentStatus: {
      type: String,
      enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED'],
      default: 'PENDING',
      index: true,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
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
  },
  { timestamps: true }
);

export const Order = mongoose.model('Order', orderSchema);
