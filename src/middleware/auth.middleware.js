import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { Artist } from '../models/artist.model.js';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const verifyJWT = asyncHandler(async (req, res, next) => {
  try {
    const token = req.cookies?.accessToken || req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      throw new ApiError(401, 'Unauthorized request');
    }

    const decodedToken = jwt.verify(token, env.JWT_ACCESS_SECRET);

    // Depending on the role encoded in the token, fetch the user/artist
    let user;
    if (decodedToken.role === 'ARTIST') {
      user = await Artist.findById(decodedToken?._id).select('-refreshToken');
      // Pass type specifically to differentiate in later checks if needed
      if (user) user.role = 'ARTIST'; 
    } else {
      user = await User.findById(decodedToken?._id).select('-password -refreshToken');
      // Set roles explicitly (could be USER or ADMIN based on db)
    }

    if (!user) {
      throw new ApiError(401, 'Invalid Access Token');
    }

    req.user = user;
    next();
  } catch (error) {
    throw new ApiError(401, error?.message || 'Invalid access token');
  }
});

// Middleware factory for Role-Based Access Control
export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new ApiError(403, `Role '${req.user?.role}' is not allowed to access this resource`);
    }
    next();
  };
};
