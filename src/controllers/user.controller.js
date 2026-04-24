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
  const { name, city, profilePhoto } = req.body;
  const updates = {};

  if (typeof name === 'string' && name.trim()) updates.name = name.trim();
  if (typeof city === 'string' && city.trim()) updates.city = city.trim();
  
  // If file was uploaded via S3 Multer
  if (req.file) {
    updates.profilePhoto = req.file.location;
  }
  // Fallback: allow direct profilePhoto URL string update from body.
  else if (typeof profilePhoto === 'string' && profilePhoto.trim()) {
    updates.profilePhoto = profilePhoto.trim();
  }

  if (Object.keys(updates).length === 0) {
    throw new ApiError(400, 'No valid fields provided for update');
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
