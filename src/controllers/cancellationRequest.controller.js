import mongoose from 'mongoose';
import { Booking } from '../models/booking.model.js';
import { CancellationRequest } from '../models/cancellationRequest.model.js';
import { Order } from '../models/order.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const CANCELLABLE_BOOKING_STATUSES = new Set(['PENDING', 'CONFIRMED', 'UPCOMING', 'MANUAL_REVIEW']);
const NON_CANCELLABLE_BOOKING_STATUSES = new Set(['ONGOING', 'COMPLETED', 'CANCELLED']);
const CANCELLABLE_ORDER_ITEM_STATUSES = new Set(['PENDING', 'UPCOMING', 'MANUAL_REVIEW']);
const NON_CANCELLABLE_ORDER_ITEM_STATUSES = new Set(['ONGOING', 'COMPLETED', 'CANCELLED']);

const normalizeSourceType = (value) => String(value ?? '').trim().toUpperCase();

const toObjectId = (value, fieldName) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new ApiError(400, `${fieldName} is invalid`);
  }
  return new mongoose.Types.ObjectId(value);
};

const ensureBookingIsCancellable = (booking) => {
  const status = booking?.status;
  if (NON_CANCELLABLE_BOOKING_STATUSES.has(status)) {
    throw new ApiError(400, `Booking with status ${status} cannot be cancelled`);
  }
  if (!CANCELLABLE_BOOKING_STATUSES.has(status)) {
    throw new ApiError(400, `Booking with status ${status} is not eligible for cancellation`);
  }
};

const ensureOrderIsCancellable = (order) => {
  const statuses = (order?.items || []).map((item) => item?.status ?? 'PENDING');
  if (!statuses.length) {
    throw new ApiError(400, 'Order has no items to cancel');
  }
  if (statuses.some((status) => NON_CANCELLABLE_ORDER_ITEM_STATUSES.has(status))) {
    throw new ApiError(400, 'Order contains ongoing/completed/cancelled items and cannot be cancelled');
  }
  if (!statuses.some((status) => CANCELLABLE_ORDER_ITEM_STATUSES.has(status))) {
    throw new ApiError(400, 'Order is not eligible for cancellation');
  }
};

const applyApprovalState = async (requestDoc, adminId) => {
  requestDoc.status = 'APPROVED';
  requestDoc.adminAction.approvedBy = adminId;
  requestDoc.adminAction.approvedAt = new Date();
  requestDoc.adminAction.rejectedBy = null;
  requestDoc.adminAction.rejectedAt = null;
  requestDoc.adminAction.rejectionReason = '';
  await requestDoc.save();
};

export const createCancellationRequest = asyncHandler(async (req, res) => {
  const { sourceType, orderId, bookingId, reason } = req.body;
  const normalizedSourceType = normalizeSourceType(sourceType);
  const trimmedReason = String(reason ?? '').trim();

  if (!['ORDER', 'BOOKING'].includes(normalizedSourceType)) {
    throw new ApiError(400, 'sourceType must be ORDER or BOOKING');
  }
  if (!trimmedReason) {
    throw new ApiError(400, 'reason is required');
  }

  const userId = req.user._id;

  if (normalizedSourceType === 'BOOKING') {
    if (!bookingId) throw new ApiError(400, 'bookingId is required for BOOKING cancellation');
    const bookingObjectId = toObjectId(bookingId, 'bookingId');
    const booking = await Booking.findOne({ _id: bookingObjectId, user: userId }).select('_id status');
    if (!booking) throw new ApiError(404, 'Booking not found');
    ensureBookingIsCancellable(booking);

    const existingOpen = await CancellationRequest.findOne({
      sourceType: 'BOOKING',
      booking: booking._id,
      user: userId,
      status: { $in: ['PENDING', 'APPROVED', 'REFUND_PENDING'] },
    });
    if (existingOpen) throw new ApiError(409, 'A cancellation request already exists for this booking');

    const created = await CancellationRequest.create({
      sourceType: 'BOOKING',
      booking: booking._id,
      user: userId,
      reason: trimmedReason,
      status: 'PENDING',
    });

    return res.status(201).json(new ApiResponse(201, created, 'Cancellation request submitted'));
  }

  if (!orderId) throw new ApiError(400, 'orderId is required for ORDER cancellation');
  const orderObjectId = toObjectId(orderId, 'orderId');
  const order = await Order.findOne({ _id: orderObjectId, user: userId }).select('_id items status');
  if (!order) throw new ApiError(404, 'Order not found');
  ensureOrderIsCancellable(order);

  const existingOpen = await CancellationRequest.findOne({
    sourceType: 'ORDER',
    order: order._id,
    user: userId,
    status: { $in: ['PENDING', 'APPROVED', 'REFUND_PENDING'] },
  });
  if (existingOpen) throw new ApiError(409, 'A cancellation request already exists for this order');

  const created = await CancellationRequest.create({
    sourceType: 'ORDER',
    order: order._id,
    user: userId,
    reason: trimmedReason,
    status: 'PENDING',
  });

  return res.status(201).json(new ApiResponse(201, created, 'Cancellation request submitted'));
});

export const listMyCancellationRequests = asyncHandler(async (req, res) => {
  const { status = '' } = req.query;
  const query = { user: req.user._id };
  if (status) query.status = String(status).trim().toUpperCase();

  const rows = await CancellationRequest.find(query)
    .populate('order', '_id paymentStatus grandTotal')
    .populate('booking', '_id status paymentStatus pricing.agreedPrice')
    .sort({ createdAt: -1 });

  res.status(200).json(new ApiResponse(200, rows, 'Cancellation requests fetched'));
});

export const listCancellationRequestsForAdmin = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status = '', sourceType = '', q = '' } = req.query;
  const skip = (Number(page) - 1) * Number(limit);
  const query = {};
  if (status) query.status = String(status).trim().toUpperCase();
  if (sourceType) query.sourceType = normalizeSourceType(sourceType);
  if (q) {
    const regex = new RegExp(String(q).trim(), 'i');
    query.$or = [{ reason: regex }, { 'adminAction.rejectionReason': regex }, { 'adminAction.closeNote': regex }];
  }

  const [rows, total] = await Promise.all([
    CancellationRequest.find(query)
      .populate('user', 'name phone email')
      .populate('order', '_id paymentStatus grandTotal')
      .populate('booking', '_id status paymentStatus pricing.agreedPrice')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    CancellationRequest.countDocuments(query),
  ]);

  res.status(200).json(
    new ApiResponse(200, {
      rows,
      pagination: { page: Number(page), limit: Number(limit), total },
    }, 'Cancellation requests fetched')
  );
});

export const approveCancellationRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const requestDoc = await CancellationRequest.findById(id);
  if (!requestDoc) throw new ApiError(404, 'Cancellation request not found');
  if (requestDoc.status !== 'PENDING') {
    throw new ApiError(400, `Only pending requests can be approved. Current status: ${requestDoc.status}`);
  }
  await applyApprovalState(requestDoc, req.user._id);
  res.status(200).json(new ApiResponse(200, requestDoc, 'Cancellation request approved'));
});

export const rejectCancellationRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const rejectionReason = String(req.body?.reason ?? '').trim();
  if (!rejectionReason) throw new ApiError(400, 'Rejection reason is required');

  const requestDoc = await CancellationRequest.findById(id);
  if (!requestDoc) throw new ApiError(404, 'Cancellation request not found');
  if (requestDoc.status !== 'PENDING') {
    throw new ApiError(400, `Only pending requests can be rejected. Current status: ${requestDoc.status}`);
  }

  requestDoc.status = 'REJECTED';
  requestDoc.adminAction.rejectedBy = req.user._id;
  requestDoc.adminAction.rejectedAt = new Date();
  requestDoc.adminAction.rejectionReason = rejectionReason;
  requestDoc.adminAction.approvedBy = null;
  requestDoc.adminAction.approvedAt = null;
  await requestDoc.save();

  res.status(200).json(new ApiResponse(200, requestDoc, 'Cancellation request rejected'));
});

export const markCancellationRefundDone = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const refundReference = String(req.body?.refundReference ?? '').trim();
  const requestDoc = await CancellationRequest.findById(id);
  if (!requestDoc) throw new ApiError(404, 'Cancellation request not found');
  if (!['APPROVED'].includes(requestDoc.status)) {
    throw new ApiError(400, `Refund can only be recorded after approval. Current status: ${requestDoc.status}`);
  }

  requestDoc.status = 'REFUND_PENDING';
  requestDoc.adminAction.refundMarkedBy = req.user._id;
  requestDoc.adminAction.refundMarkedAt = new Date();
  requestDoc.adminAction.refundReference = refundReference;
  await requestDoc.save();

  if (requestDoc.sourceType === 'BOOKING' && requestDoc.booking) {
    await Booking.updateOne(
      { _id: requestDoc.booking },
      { $set: { status: 'CANCELLED', paymentStatus: 'REFUNDED', cancelledAt: new Date() } }
    );
  }
  if (requestDoc.sourceType === 'ORDER' && requestDoc.order) {
    await Order.updateOne(
      { _id: requestDoc.order },
      { $set: { paymentStatus: 'REFUNDED', 'items.$[].status': 'CANCELLED', 'items.$[].cancelledAt': new Date() } }
    );
  }

  res.status(200).json(new ApiResponse(200, requestDoc, 'Refund marked successfully'));
});

export const closeCancellationRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const closeNote = String(req.body?.note ?? '').trim();
  const requestDoc = await CancellationRequest.findById(id);
  if (!requestDoc) throw new ApiError(404, 'Cancellation request not found');
  if (!['REJECTED', 'REFUND_PENDING'].includes(requestDoc.status)) {
    throw new ApiError(400, `Request cannot be closed from status ${requestDoc.status}`);
  }

  requestDoc.status = 'CLOSED';
  requestDoc.adminAction.closedBy = req.user._id;
  requestDoc.adminAction.closedAt = new Date();
  requestDoc.adminAction.closeNote = closeNote || requestDoc.adminAction.closeNote || '';
  await requestDoc.save();

  res.status(200).json(new ApiResponse(200, requestDoc, 'Cancellation request closed'));
});
