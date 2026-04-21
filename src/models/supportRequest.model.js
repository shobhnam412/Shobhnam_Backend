import mongoose from 'mongoose';

const supportRequestSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['HELP', 'FEEDBACK'],
      required: true,
      index: true,
    },
    senderType: {
      type: String,
      enum: ['USER', 'ARTIST'],
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    subject: {
      type: String,
      trim: true,
      required: true,
    },
    message: {
      type: String,
      trim: true,
      required: true,
    },
    status: {
      type: String,
      enum: ['OPEN', 'RESOLVED'],
      default: 'OPEN',
      index: true,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

supportRequestSchema.index({ type: 1, status: 1, createdAt: -1 });
supportRequestSchema.index({ senderType: 1, senderId: 1, createdAt: -1 });

export const SupportRequest = mongoose.model('SupportRequest', supportRequestSchema);
