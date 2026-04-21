import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    addressType: {
      type: String,
      enum: ['HOME', 'WORK', 'OTHER', 'TEMPORARY'],
      default: 'HOME',
      required: true,
    },
    saveAs: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },
    houseFloor: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    towerBlock: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    landmark: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    recipientName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    recipientPhone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20,
    },
    city: {
      type: String,
      trim: true,
      default: 'New Delhi',
      maxlength: 80,
    },
    state: {
      type: String,
      trim: true,
      default: 'Delhi',
      maxlength: 80,
    },
    pinCode: {
      type: String,
      trim: true,
      maxlength: 12,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

addressSchema.index({ user: 1, createdAt: -1 });

export const Address = mongoose.model('Address', addressSchema);
