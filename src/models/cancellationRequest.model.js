import mongoose from 'mongoose';

const cancellationRequestSchema = new mongoose.Schema(
  {
    sourceType: {
      type: String,
      enum: ['ORDER', 'BOOKING'],
      required: true,
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      index: true,
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'REFUND_PENDING', 'CLOSED'],
      default: 'PENDING',
      index: true,
    },
    adminAction: {
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      approvedAt: { type: Date },
      rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      rejectedAt: { type: Date },
      rejectionReason: { type: String, trim: true, maxlength: 1000 },
      refundMarkedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      refundMarkedAt: { type: Date },
      refundReference: { type: String, trim: true },
      closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      closedAt: { type: Date },
      closeNote: { type: String, trim: true, maxlength: 1000 },
    },
  },
  { timestamps: true }
);

cancellationRequestSchema.index(
  { sourceType: 1, order: 1, booking: 1, user: 1 },
  { name: 'cancellation_request_lookup_idx' }
);

export const CancellationRequest = mongoose.model('CancellationRequest', cancellationRequestSchema);
