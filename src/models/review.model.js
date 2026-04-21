import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema(
  {
    artist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Artist',
      index: true,
    },
    artists: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Artist',
        required: true,
      },
    ],
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
    reviewScope: {
      type: String,
      enum: ['BOOKING', 'ORDER'],
      required: true,
      index: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

reviewSchema.index(
  { user: 1, booking: 1 },
  { unique: true, partialFilterExpression: { booking: { $exists: true } } }
);
reviewSchema.index(
  { user: 1, order: 1 },
  { unique: true, partialFilterExpression: { order: { $exists: true } } }
);

export const Review = mongoose.model('Review', reviewSchema);
