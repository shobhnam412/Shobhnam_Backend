import { User } from '../models/user.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('-password -refreshToken');
  if (!user) throw new ApiError(404, 'User not found');
  res.status(200).json(
    new ApiResponse(200, user, 'User profile fetched successfully')
  );
});

export const updateUserProfile = asyncHandler(async (req, res) => {
  const { name, city } = req.body;
  const updates = {};

  if (name) updates.name = name;
  if (city) updates.city = city;
  
  // If file was uploaded via S3 Multer
  if (req.file) {
    updates.profilePhoto = req.file.location;
  }

  const updatedUser = await User.findByIdAndUpdate(
    req.user._id,
    { $set: updates },
    { new: true, runValidators: true }
  ).select('-password -refreshToken');

  if (!updatedUser) {
    throw new ApiError(404, 'User not found');
  }

  res.status(200).json(
    new ApiResponse(200, updatedUser, 'Profile updated successfully')
  );
});
