import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../config/env.js';

const AVAILABILITY_DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/** @deprecated Weekly template; stored empty for new saves. */
const AVAILABILITY_SLOT_OPTIONS = ['6AM-12PM', '12PM-6PM', '6PM-12AM', '12AM-6AM'];

const availabilityDaySchema = new mongoose.Schema(
  {
    day: {
      type: String,
      enum: AVAILABILITY_DAY_NAMES,
      required: true,
    },
    enabled: {
      type: Boolean,
      default: false,
    },
    slots: [
      {
        type: String,
        enum: AVAILABILITY_SLOT_OPTIONS,
      },
    ],
  },
  { _id: false }
);

const availabilityScheduleSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      trim: true,
      required: true,
    },
    name: {
      type: String,
      trim: true,
      required: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    days: {
      type: [availabilityDaySchema],
      default: [],
    },
  },
  { _id: false }
);

const availabilityIntervalSchema = new mongoose.Schema(
  {
    start: { type: String, trim: true, required: true },
    end: { type: String, trim: true, required: true },
  },
  { _id: false }
);

const availabilityCalendarDaySchema = new mongoose.Schema(
  {
    dateKey: {
      type: String,
      trim: true,
      required: true,
    },
    scheduleId: {
      type: String,
      trim: true,
      default: '',
    },
    /** Artist `serviceAddresses` subdocument _id (not User Address collection). */
    serviceAddressId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    /** @deprecated Use serviceAddressId; kept so legacy documents still load. */
    addressId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    /**
     * Unavailability model: intervals represent BLOCKED time windows for this
     * dateKey (artist is NOT available during these intervals). When `enabled`
     * is false, the entire row is ignored. Absence of a row for a date means
     * the artist is fully available that day.
     */
    intervals: {
      type: [availabilityIntervalSchema],
      default: [],
    },
    /** @deprecated Prefer intervals; converted when read if intervals empty. Also treated as blocked ranges. */
    slots: [
      {
        type: String,
        enum: AVAILABILITY_SLOT_OPTIONS,
      },
    ],
  },
  { _id: false }
);

const serviceAddressSchema = new mongoose.Schema(
  {
    addressType: {
      type: String,
      enum: ['HOME', 'WORK', 'OTHER', 'TEMPORARY'],
      default: 'HOME',
    },
    saveAs: { type: String, trim: true, required: true, maxlength: 40 },
    houseFloor: { type: String, trim: true, required: true, maxlength: 160 },
    towerBlock: { type: String, trim: true, maxlength: 120 },
    landmark: { type: String, trim: true, maxlength: 200 },
    recipientName: { type: String, trim: true, maxlength: 100 },
    recipientPhone: { type: String, trim: true, maxlength: 20 },
    mapAddress: { type: String, trim: true },
    city: { type: String, trim: true, default: 'New Delhi', maxlength: 80 },
    state: { type: String, trim: true, default: 'Delhi', maxlength: 80 },
    pinCode: { type: String, trim: true, maxlength: 12 },
    latitude: { type: Number },
    longitude: { type: Number },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const artistSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
    },
    profilePhoto: {
      type: String, // S3 URL
    },
    bio: {
      type: String,
      trim: true,
    },
    category: {
      type: String,
      enum: [
        'Ramleela',
        'Sundarkand',
        'Sunderkand',
        'Bhagwat Katha',
        'Bhagwat khatha',
        'Bhajan sandhya',
        'Rudrabhishek',
        'Ramayan Path',
        'Other',
      ],
    },
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Other'],
    },
    expertise: {
      type: String,
      trim: true,
    },
    ramleelaCharacter: {
      type: String,
      trim: true,
    },
    otherServiceType: {
      type: String,
      trim: true,
    },
    aadharCard: {
      type: String, // S3 URL
    },
    bankDetails: {
      accountHolderName: {
        type: String,
        trim: true,
      },
      bankName: {
        type: String,
        trim: true,
      },
      accountNumber: {
        type: String,
        trim: true,
      },
      ifscCode: {
        type: String,
        trim: true,
        uppercase: true,
      },
      panCardUrl: {
        type: String,
        trim: true,
      },
    },
    bankVerification: {
      status: {
        type: String,
        enum: ['NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED'],
        default: 'NOT_SUBMITTED',
      },
      submittedAt: {
        type: Date,
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
      },
    },
    activationChargeStatus: {
      type: String,
      enum: ['PENDING', 'PAID'],
      default: 'PENDING',
      index: true,
    },
    activationChargePaidAt: {
      type: Date,
    },
    serviceLocation: {
      type: String,
      trim: true,
    },
    serviceLocationDetails: {
      addressType: { type: String, enum: ['Home', 'Work', 'Other', 'Temporary'] },
      saveAs: { type: String, trim: true },
      houseFloor: { type: String, trim: true },
      towerBlock: { type: String, trim: true },
      landmark: { type: String, trim: true },
      recipientName: { type: String, trim: true },
      recipientPhone: { type: String, trim: true },
      mapAddress: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      pinCode: { type: String, trim: true },
      latitude: { type: Number },
      longitude: { type: Number },
    },
    /** Saved service locations for availability + booking context (subdocs with own _id). */
    serviceAddresses: {
      type: [serviceAddressSchema],
      default: [],
    },
    youtubeLink: {
      type: String,
      trim: true,
    },
    pricing: {
      basePrice: {
        type: Number,
        default: 0,
      },
      minimumPrice: {
        type: Number,
        default: 0,
      },
      maximumPrice: {
        type: Number,
        default: 0,
      },
      currency: {
        type: String,
        default: 'INR',
      }
    },
    minimumPrice: {
      type: Number,
      default: 0,
    },
    maximumPrice: {
      type: Number,
      default: 0,
    },
    availability: {
      /**
       * Master switch. `false` means the artist is unavailable for every date
       * and slot (overrides calendarDays entirely). `true` (default) means the
       * artist is available for every date/slot unless explicitly blocked via
       * `calendarDays` entries below.
       */
      isAvailable: {
        type: Boolean,
        default: true
      },
      selectedScheduleId: {
        type: String,
        default: 'default',
      },
      schedules: {
        type: [availabilityScheduleSchema],
        default: () => [
          {
            id: 'default',
            name: 'Default',
            isDefault: true,
            days: [],
          },
        ],
      },
      calendarDays: {
        type: [availabilityCalendarDaySchema],
        default: [],
      },
    },
    experienceYears: {
      type: Number,
      default: 0,
    },
    languages: [{
      type: String,
    }],
    location: {
      city: { type: String },
      state: { type: String },
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
    },
    onboardingProgress: {
      applied: { type: Boolean, default: false },
      accountSetup: { type: Boolean, default: false },
      verified: { type: Boolean, default: false },
      allDone: { type: Boolean, default: false },
      lastUpdatedAt: { type: Date },
    },
    isLive: {
      type: Boolean,
      default: false,
    },
    rating: {
      averageRating: { type: Number, default: 0 },
      totalReviews: { type: Number, default: 0 },
    },
    refreshToken: {
      type: String,
      select: false,
    },
  },
  { timestamps: true }
);

// Generate Access Token (Roles included)
artistSchema.methods.generateAccessToken = function () {
  return jwt.sign(
    {
      _id: this._id,
      role: 'ARTIST',
    },
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    }
  );
};

// Generate Refresh Token
artistSchema.methods.generateRefreshToken = function () {
  return jwt.sign(
    {
      _id: this._id,
    },
    env.JWT_REFRESH_SECRET,
    {
      expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    }
  );
};

export const Artist = mongoose.model('Artist', artistSchema);
