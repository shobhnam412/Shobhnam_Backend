import { env } from '../config/env.js';
import jwt from 'jsonwebtoken';
import { Artist } from '../models/artist.model.js';
import { OTP } from '../models/otp.model.js';
import { User } from '../models/user.model.js';
import { sendAuthOtp } from '../services/fast2sms.service.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Normalize phone to E.164 for Indian numbers (Twilio needs +91XXXXXXXXXX)
const normalizePhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return phone;
  if (phone.startsWith('+')) return phone;
  return `+91${digits.slice(-10)}`;
};

const buildPhoneLookupQuery = (phone) => {
  const normalizedPhone = normalizePhone(phone);
  const digits = String(phone || '').replace(/\D/g, '');
  const lastTenDigits = digits.slice(-10);
  const variants = [phone, normalizedPhone, lastTenDigits, `+91${lastTenDigits}`]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter(Boolean);

  return { phone: { $in: [...new Set(variants)] } };
};

const ARTIST_ONBOARDING_TOKEN_EXPIRY = '2h';
const ARTIST_ONBOARDING_PURPOSE = 'ARTIST_ONBOARDING';

const generateArtistOnboardingToken = ({ phone, name }) =>
  jwt.sign(
    {
      purpose: ARTIST_ONBOARDING_PURPOSE,
      phone,
      name: String(name || '').trim() || undefined,
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: ARTIST_ONBOARDING_TOKEN_EXPIRY }
  );

const verifyArtistOnboardingToken = (token) => {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
    if (decoded?.purpose !== ARTIST_ONBOARDING_PURPOSE) {
      throw new ApiError(401, 'Invalid onboarding token');
    }
    return decoded;
  } catch {
    throw new ApiError(401, 'Invalid or expired onboarding token');
  }
};

const parseExperienceYears = (experience) => {
  if (experience === undefined || experience === null || experience === '') return undefined;
  if (typeof experience === 'number') return experience;
  const text = String(experience).trim().toLowerCase();
  if (text.includes('more than 15')) return 16;
  const numbers = text.match(/(\d+)/g);
  if (!numbers?.length) return undefined;
  return parseInt(numbers[numbers.length - 1], 10);
};

const expertiseToCategory = {
  Ramleela: 'Ramleela',
  Sunderkand: 'Sunderkand',
  'Bhajan sandhya': 'Bhajan sandhya',
  'Bhagwat khatha': 'Bhagwat khatha',
  Rudrabhishek: 'Rudrabhishek',
  'Other services': 'Other',
};

// Helper to generate cookies
const generateAccessAndRefreshTokens = async (type, userId) => {
  let user;
  if (type === 'USER') {
    user = await User.findById(userId);
  } else if (type === 'ARTIST') {
    user = await Artist.findById(userId);
  }

  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();

  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });

  return { accessToken, refreshToken };
};

export const sendOtp = asyncHandler(async (req, res) => {
  const { phone } = req.body;
  if (!phone) throw new ApiError(400, 'Phone number is required');

  const normalizedPhone = normalizePhone(phone);
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiryMinutes = Number(env.OTP_EXPIRY_MINUTES || 10);

  // Save OTP in Database
  await OTP.create({
    phone: normalizedPhone,
    otp: otpCode,
    expiresAt: new Date(Date.now() + otpExpiryMinutes * 60000),
  });

  try {
    await sendAuthOtp(normalizedPhone, otpCode);
  } catch (error) {
    throw new ApiError(502, 'Failed to send OTP. Please try again.');
  }

  return res.status(200).json(
    new ApiResponse(200, null, 'OTP sent successfully')
  );
});

export const verifyOtpUser = asyncHandler(async (req, res) => {
  const { phone, otp, name, city } = req.body;
  
  if (!phone || !otp) throw new ApiError(400, 'Phone and OTP are required');

  const normalizedPhone = normalizePhone(phone);
  const record = await OTP.findOne({
    phone: normalizedPhone,
    otp,
    isUsed: false,
    expiresAt: { $gt: new Date() },
  });
  if (!record) throw new ApiError(400, 'Invalid or Expired OTP');
  record.isUsed = true;
  await record.save();

  // Check if User exists by normalized phone variants
  let user = await User.findOne(buildPhoneLookupQuery(normalizedPhone));
  const isExistingUser = !!user;
  let requiresName = false;

  if (!user) {
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    requiresName = true;
    user = await User.create({
      phone: normalizedPhone,
      // Create the user after OTP; app can collect and patch a real name in the next step.
      name: trimmedName || `User ${normalizedPhone.slice(-4)}`,
      city,
      role: 'USER',
    });
  }

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens('USER', user._id);

  const options = { httpOnly: true, secure: true };

  return res
    .status(200)
    .cookie('accessToken', accessToken, options)
    .cookie('refreshToken', refreshToken, options)
    .json(
      new ApiResponse(
        200,
        { user, accessToken, refreshToken, isExistingUser, requiresName },
        'User logged in successfully'
      )
    );
});

export const verifyOtpArtist = asyncHandler(async (req, res) => {
  const { phone, otp, name, category, city } = req.body;
  
  if (!phone || !otp) throw new ApiError(400, 'Phone and OTP are required');

  const normalizedPhone = normalizePhone(phone);
  const record = await OTP.findOne({
    phone: normalizedPhone,
    otp,
    isUsed: false,
    expiresAt: { $gt: new Date() },
  });
  if (!record) throw new ApiError(400, 'Invalid or Expired OTP');
  record.isUsed = true;
  await record.save();

  // Existing artists can log in. First-time artists must complete onboarding first.
  const artist = await Artist.findOne(buildPhoneLookupQuery(normalizedPhone));
  const isExistingArtist = !!artist;

  if (!artist) {
    const onboardingToken = generateArtistOnboardingToken({
      phone: normalizedPhone,
      name,
    });
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          artist: null,
          accessToken: null,
          refreshToken: null,
          isExistingArtist: false,
          requiresArtistForm: true,
          onboardingToken,
        },
        'OTP verified. Complete artist onboarding to continue.'
      )
    );
  }

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens('ARTIST', artist._id);

  const options = { httpOnly: true, secure: true };

  return res
    .status(200)
    .cookie('accessToken', accessToken, options)
    .cookie('refreshToken', refreshToken, options)
    .json(
      new ApiResponse(
        200,
        {
          artist,
          accessToken,
          refreshToken,
          isExistingArtist,
          requiresArtistForm: !isExistingArtist,
        },
        'Artist logged in successfully'
      )
    );
});

export const registerArtistOnboarding = asyncHandler(async (req, res) => {
  const {
    onboardingToken,
    fullName,
    gender,
    expertise,
    experience,
    minimumPrice,
    maximumPrice,
    serviceLocation,
    serviceLocationDetails,
    youtubeLink,
    profilePhoto,
    aadharCard,
    ramleelaCharacter,
    otherServiceType,
  } = req.body;

  if (!onboardingToken) throw new ApiError(400, 'Onboarding token is required');
  const decoded = verifyArtistOnboardingToken(onboardingToken);
  const normalizedPhone = normalizePhone(decoded?.phone);
  if (!normalizedPhone) throw new ApiError(400, 'Invalid onboarding phone');

  const existing = await Artist.findOne(buildPhoneLookupQuery(normalizedPhone));
  if (existing) {
    throw new ApiError(409, 'Artist profile already exists for this phone number');
  }

  const displayName = String(fullName || '').trim();
  if (!displayName) throw new ApiError(400, 'Full name is required');
  if (!gender) throw new ApiError(400, 'Gender is required');
  if (!expertise) throw new ApiError(400, 'Expertise is required');
  if (!serviceLocation || !String(serviceLocation).trim()) throw new ApiError(400, 'Service location is required');
  if (!profilePhoto || !String(profilePhoto).trim()) throw new ApiError(400, 'Profile photo is required');
  if (!aadharCard || !String(aadharCard).trim()) throw new ApiError(400, 'Aadhar card is required');

  const requireCharacter = String(expertise).toLowerCase().includes('ramleela');
  if (requireCharacter && !String(ramleelaCharacter || '').trim()) {
    throw new ApiError(400, 'Ramleela character is required when expertise includes Ramleela');
  }
  const requireOtherServiceType = String(expertise).toLowerCase() === 'other services';
  if (requireOtherServiceType && !String(otherServiceType || '').trim()) {
    throw new ApiError(400, 'Other service type is required when expertise is Other services');
  }

  const min = Number(minimumPrice);
  const max = Number(maximumPrice);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new ApiError(400, 'Minimum and maximum price are required and must be valid numbers');
  }
  if (min < 0) throw new ApiError(400, 'Minimum price must be greater than or equal to 0');
  if (max < min) throw new ApiError(400, 'Maximum price must be greater than or equal to minimum price');

  const expYears = parseExperienceYears(experience);
  const category = expertiseToCategory[expertise] || 'Other';
  const complete = Boolean(
    displayName &&
      String(expertise || '').trim() &&
      String(serviceLocation || '').trim() &&
      String(profilePhoto || '').trim() &&
      String(aadharCard || '').trim()
  );

  const artist = await Artist.create({
    phone: normalizedPhone,
    name: displayName,
    gender,
    expertise,
    category,
    ramleelaCharacter: ramleelaCharacter?.trim() || undefined,
    otherServiceType: otherServiceType?.trim() || undefined,
    experienceYears: expYears ?? 0,
    minimumPrice: min,
    maximumPrice: max,
    pricing: {
      basePrice: min,
      minimumPrice: min,
      maximumPrice: max,
      currency: 'INR',
    },
    serviceLocation: String(serviceLocation).trim(),
    serviceLocationDetails: serviceLocationDetails && typeof serviceLocationDetails === 'object' ? serviceLocationDetails : undefined,
    youtubeLink: String(youtubeLink || '').trim(),
    profilePhoto: String(profilePhoto).trim(),
    aadharCard: String(aadharCard).trim(),
    status: 'PENDING',
    onboardingProgress: {
      applied: complete,
      accountSetup: complete,
      verified: false,
      allDone: false,
      lastUpdatedAt: new Date(),
    },
    bankVerification: {
      status: 'NOT_SUBMITTED',
    },
    activationChargeStatus: 'PENDING',
    isLive: false,
    location: {},
  });

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens('ARTIST', artist._id);
  const options = { httpOnly: true, secure: true };

  return res
    .status(201)
    .cookie('accessToken', accessToken, options)
    .cookie('refreshToken', refreshToken, options)
    .json(
      new ApiResponse(
        201,
        { artist, accessToken, refreshToken },
        'Artist profile created successfully'
      )
    );
});

export const uploadArtistOnboardingProfilePhoto = asyncHandler(async (req, res) => {
  const onboardingToken = String(req.body?.onboardingToken || '').trim();
  if (!onboardingToken) throw new ApiError(400, 'Onboarding token is required');
  verifyArtistOnboardingToken(onboardingToken);
  if (!req.file?.location) throw new ApiError(400, 'No file uploaded');

  return res
    .status(200)
    .json(new ApiResponse(200, { fileSavedUrl: req.file.location }, 'Profile photo uploaded'));
});

export const uploadArtistOnboardingAadhar = asyncHandler(async (req, res) => {
  const onboardingToken = String(req.body?.onboardingToken || '').trim();
  if (!onboardingToken) throw new ApiError(400, 'Onboarding token is required');
  verifyArtistOnboardingToken(onboardingToken);
  if (!req.file?.location) throw new ApiError(400, 'No file uploaded');

  return res
    .status(200)
    .json(new ApiResponse(200, { fileSavedUrl: req.file.location }, 'Aadhar card uploaded'));
});

export const hasDualProfile = asyncHandler(async (req, res) => {
  const current = req.user;
  if (!current) throw new ApiError(401, 'Unauthorized');

  const phone = current.phone;
  if (!phone) throw new ApiError(400, 'Phone not found');

  const phoneQuery = buildPhoneLookupQuery(phone);
  const [userExists, artistExists] = await Promise.all([
    User.findOne(phoneQuery).select('_id'),
    Artist.findOne(phoneQuery).select('_id'),
  ]);

  const hasDualProfileResult = !!(userExists && artistExists);

  return res.status(200).json(
    new ApiResponse(200, { hasDualProfile: hasDualProfileResult }, 'Dual profile check completed')
  );
});

export const switchProfile = asyncHandler(async (req, res) => {
  const current = req.user;
  if (!current) throw new ApiError(401, 'Unauthorized');

  const phone = current.phone;
  if (!phone) throw new ApiError(400, 'Phone not found');
  const phoneQuery = buildPhoneLookupQuery(phone);

  if (current.role === 'ARTIST') {
    const user = await User.findOne(phoneQuery);
    if (!user) throw new ApiError(400, 'No user profile found for this phone number');
    const { accessToken, refreshToken } = await generateAccessAndRefreshTokens('USER', user._id);
    const options = { httpOnly: true, secure: true };
    return res
      .status(200)
      .cookie('accessToken', accessToken, options)
      .cookie('refreshToken', refreshToken, options)
      .json(new ApiResponse(200, { user, accessToken, refreshToken }, 'Switched to user profile'));
  }

  if (current.role === 'USER' || current.role === 'ADMIN') {
    const artist = await Artist.findOne(phoneQuery);
    if (!artist) throw new ApiError(400, 'No artist profile found for this phone number');
    const { accessToken, refreshToken } = await generateAccessAndRefreshTokens('ARTIST', artist._id);
    const options = { httpOnly: true, secure: true };
    return res
      .status(200)
      .cookie('accessToken', accessToken, options)
      .cookie('refreshToken', refreshToken, options)
      .json(new ApiResponse(200, { artist, accessToken, refreshToken }, 'Switched to artist profile'));
  }

  throw new ApiError(400, 'Cannot switch profile');
});

export const adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) throw new ApiError(400, 'Email and password are required');

  const admin = await User.findOne({ email: email.toLowerCase(), role: 'ADMIN' }).select('+password');

  if (!admin) {
    throw new ApiError(401, 'Invalid credentials');
  }

  const isPasswordValid = await admin.isPasswordCorrect(password);
  if (!isPasswordValid) {
    throw new ApiError(401, 'Invalid credentials');
  }

  const token = admin.generateAccessToken();

  const adminData = {
    _id: admin._id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
  };

  return res
    .status(200)
    .json(new ApiResponse(200, { token, admin: adminData }, 'Admin logged in successfully'));
});
