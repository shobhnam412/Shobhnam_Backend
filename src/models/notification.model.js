import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    recipientType: {
      type: String,
      enum: ['USER', 'ARTIST'],
      required: true,
      index: true,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['ADMIN_BROADCAST', 'PAYMENT_PENDING', 'PAYMENT_CLEARED'],
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdByAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

notificationSchema.index({ recipientType: 1, recipientId: 1, isActive: 1, createdAt: -1 });
notificationSchema.index({ type: 1, 'meta.paymentDomain': 1, 'meta.referenceId': 1, isActive: 1 });

export const Notification = mongoose.model('Notification', notificationSchema);
