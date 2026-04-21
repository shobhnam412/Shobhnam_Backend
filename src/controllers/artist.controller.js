import mongoose from 'mongoose';
import { Artist } from '../models/artist.model.js';
import { buildArtistCalendarPayload } from '../services/inventory.service.js';
import { ApiError } from '../utils/ApiError.js';
import {
  legacyAvailabilitySlotToInterval,
  mergeArtistDayIntervals,
  normalizeHmToken,
} from '../utils/istTime.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const BANK_VERIFICATION_STATUS = {
  NOT_SUBMITTED: 'NOT_SUBMITTED',
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
};

const isArtistProfileComplete = (artist) =>
  Boolean(
    String(artist?.name || '').trim() &&
      String(artist?.expertise || '').trim() &&
      String(artist?.serviceLocation || '').trim() &&
      String(artist?.profilePhoto || '').trim() &&
      String(artist?.aadharCard || '').trim()
  );

const buildOnboardingProgress = (artist) => {
  const complete = isArtistProfileComplete(artist);
  const verified = artist?.status === 'APPROVED';
  return {
    applied: complete,
    accountSetup: complete,
    verified,
    allDone: verified && complete,
    lastUpdatedAt: new Date(),
  };
};

const getBankVerificationStatus = (artist) =>
  artist?.bankVerification?.status || BANK_VERIFICATION_STATUS.NOT_SUBMITTED;

const normalizeAccountNumber = (value) => String(value || '').replace(/\s+/g, '').trim();

const normalizeIfscCode = (value) => String(value || '').replace(/\s+/g, '').toUpperCase().trim();

const isValidIfscCode = (value) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(value);

export const getMyArtistProfile = asyncHandler(async (req, res) => {
  res.status(200).json(
    new ApiResponse(200, req.user, 'Artist profile fetched successfully')
  );
});

/** Onit-style: single file upload, updates artist and returns URL */
export const uploadProfilePhoto = asyncHandler(async (req, res) => {
  if (!req.file?.location) throw new ApiError(400, 'No file uploaded');

  const artist = await Artist.findByIdAndUpdate(
    req.user._id,
    { $set: { profilePhoto: req.file.location } },
    { new: true }
  ).select('-refreshToken');

  if (!artist) throw new ApiError(404, 'Artist not found');

  res.status(200).json(
    new ApiResponse(200, { fileSavedUrl: req.file.location, artist }, 'Profile photo uploaded')
  );
});

/** Onit-style: single file upload, updates artist and returns URL */
export const uploadAadharCard = asyncHandler(async (req, res) => {
  if (!req.file?.location) throw new ApiError(400, 'No file uploaded');

  const artist = await Artist.findByIdAndUpdate(
    req.user._id,
    { $set: { aadharCard: req.file.location } },
    { new: true }
  ).select('-refreshToken');

  if (!artist) throw new ApiError(404, 'Artist not found');

  res.status(200).json(
    new ApiResponse(200, { fileSavedUrl: req.file.location, artist }, 'Aadhar card uploaded')
  );
});

export const uploadPanCard = asyncHandler(async (req, res) => {
  if (!req.file?.location) throw new ApiError(400, 'No file uploaded');

  const artist = await Artist.findByIdAndUpdate(
    req.user._id,
    { $set: { 'bankDetails.panCardUrl': req.file.location } },
    { new: true }
  ).select('-refreshToken');

  if (!artist) throw new ApiError(404, 'Artist not found');

  res.status(200).json(
    new ApiResponse(200, { fileSavedUrl: req.file.location, artist }, 'PAN card uploaded')
  );
});

export const updateMyBankDetails = asyncHandler(async (req, res) => {
  const {
    accountHolderName,
    bankName,
    accountNumber,
    ifscCode,
    panCardUrl,
  } = req.body;

  const nextAccountHolderName = String(accountHolderName || '').trim();
  const nextBankName = String(bankName || '').trim();
  const nextAccountNumber = normalizeAccountNumber(accountNumber);
  const nextIfscCode = normalizeIfscCode(ifscCode);
  const nextPanCardUrl = String(panCardUrl || '').trim();

  if (!nextAccountHolderName) throw new ApiError(400, 'Account holder name is required');
  if (!nextBankName) throw new ApiError(400, 'Bank name is required');
  if (!nextAccountNumber) throw new ApiError(400, 'Account number is required');
  if (!/^\d{9,18}$/.test(nextAccountNumber)) {
    throw new ApiError(400, 'Account number must be 9 to 18 digits');
  }
  if (!nextIfscCode) throw new ApiError(400, 'IFSC code is required');
  if (!isValidIfscCode(nextIfscCode)) throw new ApiError(400, 'Invalid IFSC code');
  if (!nextPanCardUrl) throw new ApiError(400, 'PAN card upload is required');

  const artist = await Artist.findById(req.user._id).select('-refreshToken');
  if (!artist) throw new ApiError(404, 'Artist not found');

  artist.bankDetails = {
    accountHolderName: nextAccountHolderName,
    bankName: nextBankName,
    accountNumber: nextAccountNumber,
    ifscCode: nextIfscCode,
    panCardUrl: nextPanCardUrl,
  };

  artist.bankVerification = {
    status: BANK_VERIFICATION_STATUS.PENDING,
    submittedAt: new Date(),
    reviewedAt: undefined,
    reviewedBy: undefined,
    rejectionReason: '',
  };

  await artist.save();

  res.status(200).json(
    new ApiResponse(
      200,
      {
        bankDetails: artist.bankDetails,
        bankVerification: artist.bankVerification,
      },
      'Bank details submitted successfully'
    )
  );
});

export const getMyBankVerificationStatus = asyncHandler(async (req, res) => {
  const artist = await Artist.findById(req.user._id).select('-refreshToken');
  if (!artist) throw new ApiError(404, 'Artist not found');

  res.status(200).json(
    new ApiResponse(
      200,
      {
        status: getBankVerificationStatus(artist),
        rejectionReason: artist.bankVerification?.rejectionReason || '',
        submittedAt: artist.bankVerification?.submittedAt || null,
        reviewedAt: artist.bankVerification?.reviewedAt || null,
        bankDetails: artist.bankDetails || {},
        activationChargeStatus: artist.activationChargeStatus || 'PENDING',
        activationChargePaidAt: artist.activationChargePaidAt || null,
      },
      'Bank verification status fetched successfully'
    )
  );
});

// Parse experience string like "10 years" to number
const parseExperienceYears = (experience) => {
  if (experience === undefined || experience === null || experience === '') return undefined;
  if (typeof experience === 'number') return experience;
  const text = String(experience).trim().toLowerCase();
  if (text.includes('more than 15')) return 16;
  const numbers = text.match(/(\d+)/g);
  if (!numbers?.length) return undefined;
  return parseInt(numbers[numbers.length - 1], 10);
};

const isRamleelaExpertise = (value) =>
  String(value || '').trim().toLowerCase().includes('ramleela');

const isOtherServicesExpertise = (value) =>
  String(value || '').trim().toLowerCase() === 'other services';

const normalizeAvailabilitySchedules = (payloadSchedules = []) => {
  if (!Array.isArray(payloadSchedules)) {
    throw new ApiError(400, 'Availability schedules must be an array');
  }
  if (!payloadSchedules.length) {
    throw new ApiError(400, 'At least one availability schedule is required');
  }

  const idSet = new Set();
  const normalized = payloadSchedules.map((schedule, idx) => {
    const fallbackId = idx === 0 ? 'default' : `schedule-${idx}`;
    const scheduleId = String(schedule?.id || fallbackId).trim();
    if (!scheduleId) throw new ApiError(400, 'Each schedule must have an id');
    if (idSet.has(scheduleId)) throw new ApiError(400, 'Schedule ids must be unique');
    idSet.add(scheduleId);

    return {
      id: scheduleId,
      name: String(schedule?.name || (idx === 0 ? 'Default' : `Schedule ${idx}`)).trim() || `Schedule ${idx}`,
      isDefault: idx === 0 ? true : !!schedule?.isDefault,
      days: [],
    };
  });

  normalized[0].id = 'default';
  normalized[0].name = normalized[0].name || 'Default';
  normalized[0].isDefault = true;

  return normalized.map((item, idx) => ({
    ...item,
    isDefault: idx === 0,
  }));
};

const collectIntervalsFromCalendarRow = (row, enabled) => {
  if (!enabled) return [];
  const collected = [];
  if (Array.isArray(row?.intervals)) {
    for (const iv of row.intervals) {
      const start = normalizeHmToken(iv?.start);
      const endToken = String(iv?.end || '').trim() === '24:00' ? '24:00' : normalizeHmToken(iv?.end);
      if (!start || !endToken) continue;
      if (endToken !== '24:00' && !normalizeHmToken(endToken)) continue;
      collected.push({ start, end: endToken });
    }
  }
  if (enabled && !collected.length && Array.isArray(row?.slots)) {
    for (const slot of row.slots) {
      const conv = legacyAvailabilitySlotToInterval(String(slot || '').trim());
      if (!conv) continue;
      const start = normalizeHmToken(conv.start);
      const end =
        conv.end === '24:00' ? '24:00' : normalizeHmToken(conv.end);
      if (start && end) collected.push({ start, end });
    }
  }
  return mergeArtistDayIntervals(collected);
};

/**
 * Calendar rows keyed by (scheduleId|dateKey); merges intervals on collision.
 * @param {unknown[]} rows
 * @param {{ allowedServiceAddressIds: Set<string> }} ctx
 */
const normalizeCalendarDays = (rows = [], ctx) => {
  if (!Array.isArray(rows)) return [];
  const allowed = ctx?.allowedServiceAddressIds ?? new Set();
  const byKey = new Map();

  for (const row of rows) {
    const dateKey = String(row?.dateKey || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    const scheduleIdRaw = String(row?.scheduleId || 'default').trim() || 'default';
    const key = `${scheduleIdRaw}|${dateKey}`;
    const enabled = row?.enabled !== false;
    const rawAddr =
      row?.serviceAddressId ?? row?.addressId ?? row?.serviceAddress ?? undefined;
    let serviceAddressId;
    if (rawAddr && mongoose.Types.ObjectId.isValid(String(rawAddr)) && allowed.size > 0) {
      const sid = String(rawAddr);
      if (allowed.has(sid)) {
        serviceAddressId = new mongoose.Types.ObjectId(sid);
      }
    }

    const intervals = collectIntervalsFromCalendarRow(row, enabled);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        dateKey,
        scheduleId: scheduleIdRaw,
        serviceAddressId,
        enabled,
        intervals: [...intervals],
        slots: [],
      });
      continue;
    }
    existing.enabled = existing.enabled && enabled;
    existing.intervals = mergeArtistDayIntervals([...existing.intervals, ...intervals]);
    if (!existing.serviceAddressId && serviceAddressId) {
      existing.serviceAddressId = serviceAddressId;
    }
  }

  return Array.from(byKey.values()).map((item) => ({
    dateKey: item.dateKey,
    scheduleId: item.scheduleId,
    serviceAddressId: item.serviceAddressId,
    enabled: item.enabled,
    intervals: item.enabled ? mergeArtistDayIntervals(item.intervals) : [],
    slots: [],
  }));
};

const normalizeServiceAddressesPayload = (payload, existing = []) => {
  if (!Array.isArray(payload)) {
    throw new ApiError(400, 'serviceAddresses must be an array');
  }
  const existingById = new Map(
    (Array.isArray(existing) ? existing : []).map((a) => [String(a._id), a])
  );
  const usedDefault = { flag: false };
  return payload.map((row, idx) => {
    let _id;
    if (row?._id && mongoose.Types.ObjectId.isValid(String(row._id))) {
      const sid = String(row._id);
      if (existingById.has(sid)) {
        _id = new mongoose.Types.ObjectId(sid);
      } else {
        throw new ApiError(400, `Unknown service address id: ${sid}`);
      }
    } else {
      _id = new mongoose.Types.ObjectId();
    }

    const addressType = String(row?.addressType || 'HOME').trim().toUpperCase();
    const allowedTypes = ['HOME', 'WORK', 'OTHER', 'TEMPORARY'];
    if (!allowedTypes.includes(addressType)) {
      throw new ApiError(400, 'Invalid service address type');
    }
    const saveAs = String(row?.saveAs || '').trim();
    const houseFloor = String(row?.houseFloor || '').trim();
    const recipientName = String(row?.recipientName || '').trim();
    const recipientPhone = String(row?.recipientPhone || '').trim();
    if (!saveAs) throw new ApiError(400, 'Each service address needs saveAs');
    if (!houseFloor) throw new ApiError(400, 'Each service address needs houseFloor');
    if (!recipientName) throw new ApiError(400, 'Each service address needs recipientName');
    if (!recipientPhone) throw new ApiError(400, 'Each service address needs recipientPhone');

    let isDefault = Boolean(row?.isDefault);
    if (isDefault) {
      if (usedDefault.flag) isDefault = false;
      else usedDefault.flag = true;
    }
    if (idx === 0 && !usedDefault.flag) {
      isDefault = true;
      usedDefault.flag = true;
    }

    return {
      _id,
      addressType,
      saveAs,
      houseFloor,
      towerBlock: String(row?.towerBlock || '').trim(),
      landmark: String(row?.landmark || '').trim(),
      recipientName,
      recipientPhone,
      mapAddress: String(row?.mapAddress || '').trim(),
      city: String(row?.city || 'New Delhi').trim() || 'New Delhi',
      state: String(row?.state || 'Delhi').trim() || 'Delhi',
      pinCode: String(row?.pinCode || '').trim(),
      latitude: row?.latitude !== undefined ? Number(row.latitude) : undefined,
      longitude: row?.longitude !== undefined ? Number(row.longitude) : undefined,
      isDefault,
    };
  });
};

export const updateArtistProfile = asyncHandler(async (req, res) => {
  const {
    name,
    fullName,
    bio,
    category,
    gender,
    expertise,
    ramleelaCharacter,
    otherServiceType,
    experience,
    experienceYears,
    basePrice,
    minimumPrice,
    maximumPrice,
    currency,
    isAvailable,
    availability,
    languages,
    city,
    state,
    serviceLocation,
    serviceLocationDetails,
    serviceAddresses,
    youtubeLink,
    profilePhoto,
    aadharCard,
    accountHolderName,
    bankName,
    accountNumber,
    ifscCode,
    panCardUrl,
  } = req.body;
  const updates = { $set: {}, $unset: {} };
  const availabilityPayloadPresent = availability !== undefined && availability !== null;
  const role = req.user?.role;

  // Flat fields
  const displayName = name || fullName;
  if (displayName) updates.$set.name = displayName;
  if (bio) updates.$set.bio = bio;
  if (category) updates.$set.category = category;
  if (gender) updates.$set.gender = gender;
  if (expertise && role !== 'ARTIST') updates.$set.expertise = expertise;
  if (serviceLocation) updates.$set.serviceLocation = serviceLocation;
  const effectiveExpertise = role === 'ARTIST' ? req.user?.expertise ?? '' : expertise ?? req.user?.expertise ?? '';
  const isExpertiseBeingUpdated = role !== 'ARTIST' && expertise !== undefined;
  const needsRamleelaCharacter = isRamleelaExpertise(effectiveExpertise);
  const needsOtherServiceType = isOtherServicesExpertise(effectiveExpertise);

  if (needsRamleelaCharacter) {
    const nextCharacter = String(ramleelaCharacter || '').trim();
    if (nextCharacter) {
      updates.$set.ramleelaCharacter = nextCharacter;
    } else if (isExpertiseBeingUpdated) {
      throw new ApiError(400, 'Ramleela character is required when expertise is Ramleela');
    }
  } else if (isExpertiseBeingUpdated || ramleelaCharacter !== undefined) {
    updates.$unset.ramleelaCharacter = '';
  }

  if (needsOtherServiceType) {
    const nextOtherServiceType = String(otherServiceType || '').trim();
    if (nextOtherServiceType) {
      updates.$set.otherServiceType = nextOtherServiceType;
    } else if (isExpertiseBeingUpdated) {
      throw new ApiError(400, 'Other service type is required when expertise is Other services');
    }
  } else if (isExpertiseBeingUpdated || otherServiceType !== undefined) {
    updates.$unset.otherServiceType = '';
  }

  if (serviceLocationDetails && typeof serviceLocationDetails === 'object') {
    updates.$set.serviceLocationDetails = serviceLocationDetails;
  }
  if (youtubeLink !== undefined) updates.$set.youtubeLink = youtubeLink || '';

  const expYears = experienceYears !== undefined ? experienceYears : parseExperienceYears(experience);
  if (expYears !== undefined) updates.$set.experienceYears = expYears;

  // S3 URLs from req.body (upload-on-pick flow)
  if (profilePhoto && typeof profilePhoto === 'string' && profilePhoto.trim()) {
    updates.$set.profilePhoto = profilePhoto.trim();
  }
  if (aadharCard && typeof aadharCard === 'string' && aadharCard.trim()) {
    updates.$set.aadharCard = aadharCard.trim();
  }

  // Bank details (for bank verification flow)
  const hasBankPayload =
    accountHolderName !== undefined ||
    bankName !== undefined ||
    accountNumber !== undefined ||
    ifscCode !== undefined ||
    panCardUrl !== undefined;

  if (hasBankPayload) {
    const nextAccountHolderName = String(accountHolderName || '').trim();
    const nextBankName = String(bankName || '').trim();
    const nextAccountNumber = normalizeAccountNumber(accountNumber);
    const nextIfscCode = normalizeIfscCode(ifscCode);
    const nextPanCardUrl = String(panCardUrl || '').trim();

    if (!nextAccountHolderName) throw new ApiError(400, 'Account holder name is required');
    if (!nextBankName) throw new ApiError(400, 'Bank name is required');
    if (!nextAccountNumber || !/^\d{6,18}$/.test(nextAccountNumber)) {
      throw new ApiError(400, 'Account number must be 6 to 18 digits');
    }
    if (!nextIfscCode || !/^[A-Z0-9]{6,15}$/.test(nextIfscCode)) {
      throw new ApiError(400, 'IFSC code is invalid');
    }
    if (!nextPanCardUrl) throw new ApiError(400, 'PAN card upload is required');

    updates.$set['bankDetails.accountHolderName'] = nextAccountHolderName;
    updates.$set['bankDetails.bankName'] = nextBankName;
    updates.$set['bankDetails.accountNumber'] = nextAccountNumber;
    updates.$set['bankDetails.ifscCode'] = nextIfscCode;
    updates.$set['bankDetails.panCardUrl'] = nextPanCardUrl;
    updates.$set['bankVerification.status'] = BANK_VERIFICATION_STATUS.PENDING;
    updates.$set['bankVerification.submittedAt'] = new Date();
    updates.$set['bankVerification.reviewedAt'] = null;
    updates.$set['bankVerification.reviewedBy'] = null;
    updates.$set['bankVerification.rejectionReason'] = '';
  }

  // Nested fields
  if (minimumPrice !== undefined || maximumPrice !== undefined) {
    const min = Number(minimumPrice);
    const max = Number(maximumPrice);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new ApiError(400, 'Minimum and maximum price must be valid numbers');
    }
    if (min < 0) throw new ApiError(400, 'Minimum price must be greater than or equal to 0');
    if (max < min) throw new ApiError(400, 'Maximum price must be greater than or equal to minimum price');
    updates.$set.minimumPrice = min;
    updates.$set.maximumPrice = max;
    updates.$set['pricing.minimumPrice'] = min;
    updates.$set['pricing.maximumPrice'] = max;
    updates.$set['pricing.basePrice'] = min;
  } else if (basePrice !== undefined || currency) {
    if (basePrice !== undefined) {
      const parsedBasePrice = Number(basePrice);
      if (!Number.isFinite(parsedBasePrice) || parsedBasePrice < 0) {
        throw new ApiError(400, 'Base price must be a valid number greater than or equal to 0');
      }
      updates.$set['pricing.basePrice'] = parsedBasePrice;
      updates.$set.minimumPrice = parsedBasePrice;
      if (maximumPrice === undefined) {
        updates.$set.maximumPrice = parsedBasePrice;
      }
    }
    if (currency) updates.$set['pricing.currency'] = currency;
  }

  const needsAvailOrAddresses =
    availabilityPayloadPresent ||
    (serviceAddresses !== undefined && role === 'ARTIST');
  let existingForAvailability = null;
  if (needsAvailOrAddresses && role === 'ARTIST') {
    existingForAvailability = await Artist.findById(req.user._id)
      .select('serviceAddresses availability')
      .lean();
  }

  if (serviceAddresses !== undefined && role === 'ARTIST') {
    const nextAddr = normalizeServiceAddressesPayload(
      serviceAddresses,
      existingForAvailability?.serviceAddresses || []
    );
    updates.$set.serviceAddresses = nextAddr;
    existingForAvailability = {
      ...existingForAvailability,
      serviceAddresses: nextAddr,
    };
  }

  if (availabilityPayloadPresent) {
    if (typeof availability !== 'object') {
      throw new ApiError(400, 'Availability must be an object');
    }
    const nextSchedules = normalizeAvailabilitySchedules(availability?.schedules || []);
    const selectedScheduleIdCandidate = String(availability?.selectedScheduleId || '').trim();
    const selectedScheduleId = nextSchedules.some((scheduleItem) => scheduleItem.id === selectedScheduleIdCandidate)
      ? selectedScheduleIdCandidate
      : 'default';

    const addrList =
      updates.$set.serviceAddresses ||
      existingForAvailability?.serviceAddresses ||
      [];
    const allowedServiceAddressIds = new Set(
      (Array.isArray(addrList) ? addrList : []).map((a) => String(a._id))
    );

    const calendarHasIntervals = (cal) =>
      Array.isArray(cal) &&
      cal.some((row) => row.enabled && Array.isArray(row.intervals) && row.intervals.length > 0);

    let hasAnySlot = false;
    if (availability?.calendarDays !== undefined) {
      const normalizedCal = normalizeCalendarDays(availability.calendarDays, { allowedServiceAddressIds });
      updates.$set['availability.calendarDays'] = normalizedCal;
      hasAnySlot = calendarHasIntervals(normalizedCal);
    } else {
      const existingCal = existingForAvailability?.availability?.calendarDays || [];
      hasAnySlot = existingCal.some((row) => {
        if (row?.enabled === false) return false;
        if (Array.isArray(row?.intervals) && row.intervals.length) return true;
        return Array.isArray(row?.slots) && row.slots.length > 0;
      });
    }

    updates.$set['availability.schedules'] = nextSchedules;
    updates.$set['availability.selectedScheduleId'] = selectedScheduleId;
    updates.$set['availability.isAvailable'] =
      availability?.isAvailable !== undefined ? !!availability.isAvailable : hasAnySlot;
  } else if (isAvailable !== undefined) {
    updates.$set['availability.isAvailable'] = !!isAvailable;
  }

  if (city || state) {
    if (city) updates.$set['location.city'] = city;
    if (state) updates.$set['location.state'] = state;
  }

  // Arrays
  if (languages) {
    updates.$set.languages = Array.isArray(languages) ? languages : [languages];
  }

  if (!Object.keys(updates.$unset).length) {
    delete updates.$unset;
  }

  const updatedArtist = await Artist.findByIdAndUpdate(
    req.user._id,
    updates,
    { new: true, runValidators: true }
  ).select('-refreshToken');

  if (!updatedArtist) {
    throw new ApiError(404, 'Artist not found');
  }

  const nextProgress = buildOnboardingProgress(updatedArtist);
  updatedArtist.onboardingProgress = nextProgress;
  updatedArtist.isLive = nextProgress.allDone;
  if (nextProgress.accountSetup && updatedArtist.status === 'REJECTED') {
    updatedArtist.status = 'PENDING';
  }
  await updatedArtist.save({ validateBeforeSave: false });

  res.status(200).json(
    new ApiResponse(200, updatedArtist, 'Profile updated successfully')
  );
});

export const getArtistCalendarPublic = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { from, to } = req.query;
  if (!from || !to) {
    throw new ApiError(400, 'Query params from and to are required (ISO date strings)');
  }
  const artist = await Artist.findById(id).select('status');
  if (!artist || artist.status !== 'APPROVED') {
    throw new ApiError(404, 'Artist not found');
  }
  const payload = await buildArtistCalendarPayload({ artistId: id, from, to });
  res.status(200).json(new ApiResponse(200, payload, 'Artist calendar loaded'));
});

export const getArtistDetail = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const artist = await Artist.findById(id).select('-refreshToken');

  if (!artist) throw new ApiError(404, 'Artist not found');

  res.status(200).json(
    new ApiResponse(200, artist, 'Artist fetched successfully')
  );
});

export const listArtists = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    category,
    city,
    minPrice,
    maxPrice,
    minRating,
    search
  } = req.query;

  const query = { status: 'APPROVED' }; // Only show approved artists to the public

  if (category) query.category = category;
  if (city) query['location.city'] = { $regex: new RegExp(city, 'i') };
  
  if (minPrice || maxPrice) {
    query['pricing.basePrice'] = {};
    if (minPrice) query['pricing.basePrice'].$gte = Number(minPrice);
    if (maxPrice) query['pricing.basePrice'].$lte = Number(maxPrice);
  }

  if (minRating) {
    query['rating.averageRating'] = { $gte: Number(minRating) };
  }

  if (search) {
    query.name = { $regex: new RegExp(search, 'i') };
  }

  const skip = (page - 1) * limit;

  const [artists, totalCount] = await Promise.all([
    Artist.find(query).skip(skip).limit(Number(limit)).select('-refreshToken'),
    Artist.countDocuments(query)
  ]);

  const totalPages = Math.ceil(totalCount / limit);

  res.status(200).json(
    new ApiResponse(200, {
      artists,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalCount,
        totalPages
      }
    }, 'Artists fetched successfully')
  );
});

export const approveRejectArtist = asyncHandler(async (req, res) => {
  // Admin only
  const { id } = req.params;
  const { status } = req.body; // 'APPROVED' or 'REJECTED'

  if (!['APPROVED', 'REJECTED'].includes(status)) {
    throw new ApiError(400, 'Invalid status update. Choose APPROVED or REJECTED');
  }

  const artist = await Artist.findByIdAndUpdate(
    id,
    { $set: { status } },
    { new: true }
  ).select('-refreshToken');

  if (!artist) throw new ApiError(404, 'Artist not found');

  artist.onboardingProgress = buildOnboardingProgress(artist);
  artist.isLive = artist.onboardingProgress.allDone;
  await artist.save({ validateBeforeSave: false });

  res.status(200).json(
    new ApiResponse(200, artist, `Artist has been ${status.toLowerCase()}`)
  );
});
