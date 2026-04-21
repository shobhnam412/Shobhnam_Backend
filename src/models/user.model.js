import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../config/env.js';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
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
      sparse: true, // Only unique if exists, useful since phone is primary
      trim: true,
      lowercase: true,
    },
    password: {
      // Used for admin emails
      type: String,
      select: false,
    },
    city: {
      type: String,
      trim: true,
    },
    profilePhoto: {
      type: String, // S3 URL
    },
    role: {
      type: String,
      enum: ['USER', 'ADMIN'],
      default: 'USER',
    },
    refreshToken: {
      type: String,
      select: false,
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
  },
  { timestamps: true }
);

// Hash password before saving (Mongoose 9: no next callback, use async/await)
userSchema.pre('save', async function () {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
});

// Compare password
userSchema.methods.isPasswordCorrect = async function (password) {
  if (!this.password) return false;
  return await bcrypt.compare(password, this.password);
};

// Generate Access Token
userSchema.methods.generateAccessToken = function () {
  return jwt.sign(
    {
      _id: this._id,
      role: this.role,
    },
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    }
  );
};

// Generate Refresh Token
userSchema.methods.generateRefreshToken = function () {
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

export const User = mongoose.model('User', userSchema);
