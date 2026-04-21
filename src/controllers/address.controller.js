import { Address } from '../models/address.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const normalizeAddressPayload = (payload = {}) => {
  const incomingType = String(payload.addressType ?? 'HOME').trim().toUpperCase();
  const allowedAddressTypes = ['HOME', 'WORK', 'OTHER', 'TEMPORARY'];
  const addressType = allowedAddressTypes.includes(incomingType) ? incomingType : null;
  if (!addressType) {
    throw new ApiError(400, 'Invalid address type');
  }

  const normalized = {
    addressType,
    saveAs: String(payload.saveAs ?? '').trim(),
    houseFloor: String(payload.houseFloor ?? '').trim(),
    towerBlock: String(payload.towerBlock ?? '').trim(),
    landmark: String(payload.landmark ?? '').trim(),
    recipientName: String(payload.recipientName ?? '').trim(),
    recipientPhone: String(payload.recipientPhone ?? '').trim(),
    city: String(payload.city ?? 'New Delhi').trim() || 'New Delhi',
    state: String(payload.state ?? 'Delhi').trim() || 'Delhi',
    pinCode: String(payload.pinCode ?? '').trim(),
    isDefault: Boolean(payload.isDefault),
  };

  if (!normalized.saveAs) {
    throw new ApiError(400, 'Address label is required');
  }
  if (!normalized.houseFloor) {
    throw new ApiError(400, 'House number / floor is required');
  }
  if (!normalized.recipientName) {
    throw new ApiError(400, 'Recipient name is required');
  }
  if (!normalized.recipientPhone) {
    throw new ApiError(400, 'Recipient phone number is required');
  }

  return normalized;
};

export const createAddress = asyncHandler(async (req, res) => {
  const payload = normalizeAddressPayload(req.body);

  if (payload.isDefault) {
    await Address.updateMany({ user: req.user._id }, { $set: { isDefault: false } });
  }

  const createdAddress = await Address.create({
    user: req.user._id,
    ...payload,
  });

  res.status(201).json(new ApiResponse(201, createdAddress, 'Address created successfully'));
});

export const listUserAddresses = asyncHandler(async (req, res) => {
  const addresses = await Address.find({ user: req.user._id }).sort({ isDefault: -1, createdAt: -1 });

  res.status(200).json(new ApiResponse(200, addresses, 'Addresses fetched successfully'));
});

export const updateAddress = asyncHandler(async (req, res) => {
  const payload = normalizeAddressPayload(req.body);
  const { id } = req.params;

  const existingAddress = await Address.findOne({ _id: id, user: req.user._id });
  if (!existingAddress) {
    throw new ApiError(404, 'Address not found');
  }

  if (payload.isDefault) {
    await Address.updateMany({ user: req.user._id, _id: { $ne: id } }, { $set: { isDefault: false } });
  }

  Object.assign(existingAddress, payload);
  await existingAddress.save();

  res.status(200).json(new ApiResponse(200, existingAddress, 'Address updated successfully'));
});

export const deleteAddress = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existingAddress = await Address.findOne({ _id: id, user: req.user._id });
  if (!existingAddress) {
    throw new ApiError(404, 'Address not found');
  }

  await existingAddress.deleteOne();

  res.status(200).json(new ApiResponse(200, null, 'Address deleted successfully'));
});
