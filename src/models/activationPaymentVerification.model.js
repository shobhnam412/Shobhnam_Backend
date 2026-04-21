import mongoose from 'mongoose';

const activationPaymentVerificationSchema = new mongoose.Schema(
  {
    activationFor: {
      type: String,
      enum: ['USER', 'ARTIST'],
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      validate: {
        validator: function validateActivationUser(value) {
          if (this.activationFor !== 'USER') return true;
          return Boolean(value);
        },
        message: 'User activation request requires user reference',
      },
    },
    artist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Artist',
      index: true,
      validate: {
        validator: function validateActivationArtist(value) {
          if (this.activationFor !== 'ARTIST') return true;
          return Boolean(value);
        },
        message: 'Artist activation request requires artist reference',
      },
    },
    amount: {
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

activationPaymentVerificationSchema.index({ activationFor: 1, user: 1, status: 1 });
activationPaymentVerificationSchema.index({ activationFor: 1, artist: 1, status: 1 });
activationPaymentVerificationSchema.index({ activationFor: 1, status: 1, submittedAt: -1 });

export const ActivationPaymentVerification = mongoose.model('ActivationPaymentVerification', activationPaymentVerificationSchema);
