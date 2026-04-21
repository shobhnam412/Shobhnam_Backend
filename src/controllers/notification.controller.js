import { Notification } from '../models/notification.model.js';
import { createAdminBroadcastNotifications } from '../services/notification.service.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getMyNotifications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const normalizedPage = Math.max(Number(page) || 1, 1);
  const normalizedLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const skip = (normalizedPage - 1) * normalizedLimit;

  const recipientType = req.user?.role === 'ARTIST' ? 'ARTIST' : 'USER';
  const recipientId = req.user?._id;

  const query = { recipientType, recipientId, isActive: true };
  const [notifications, totalCount] = await Promise.all([
    Notification.find(query).sort({ createdAt: -1 }).skip(skip).limit(normalizedLimit),
    Notification.countDocuments(query),
  ]);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        notifications,
        pagination: {
          page: normalizedPage,
          limit: normalizedLimit,
          totalCount,
          totalPages: Math.ceil(totalCount / normalizedLimit),
        },
      },
      'Notifications fetched successfully'
    )
  );
});

export const markNotificationAsRead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const recipientType = req.user?.role === 'ARTIST' ? 'ARTIST' : 'USER';
  const notification = await Notification.findOneAndUpdate(
    {
      _id: id,
      recipientType,
      recipientId: req.user?._id,
      isActive: true,
    },
    { $set: { isRead: true } },
    { new: true }
  );

  if (!notification) throw new ApiError(404, 'Notification not found');
  res.status(200).json(new ApiResponse(200, notification, 'Notification marked as read'));
});

export const markAllNotificationsAsRead = asyncHandler(async (req, res) => {
  const recipientType = req.user?.role === 'ARTIST' ? 'ARTIST' : 'USER';
  const result = await Notification.updateMany(
    { recipientType, recipientId: req.user?._id, isActive: true, isRead: false },
    { $set: { isRead: true } }
  );

  res.status(200).json(new ApiResponse(200, { updatedCount: result.modifiedCount || 0 }, 'All notifications marked as read'));
});

export const createAdminBroadcastNotification = asyncHandler(async (req, res) => {
  const { title, message, target = 'ALL' } = req.body || {};
  const normalizedTitle = String(title || '').trim();
  const normalizedMessage = String(message || '').trim();
  const normalizedTarget = ['USERS', 'ARTISTS', 'ALL'].includes(String(target || '').toUpperCase())
    ? String(target).toUpperCase()
    : '';

  if (!normalizedTitle) throw new ApiError(400, 'Title is required');
  if (!normalizedMessage) throw new ApiError(400, 'Message is required');
  if (!normalizedTarget) throw new ApiError(400, 'Target must be one of USERS, ARTISTS, ALL');

  const result = await createAdminBroadcastNotifications({
    title: normalizedTitle,
    message: normalizedMessage,
    target: normalizedTarget,
    createdByAdmin: req.user?._id,
  });

  res.status(201).json(new ApiResponse(201, result, 'Broadcast notification sent successfully'));
});

export const getAdminNotifications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, type = '', recipientType = '' } = req.query;
  const normalizedPage = Math.max(Number(page) || 1, 1);
  const normalizedLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const skip = (normalizedPage - 1) * normalizedLimit;

  const query = {};
  if (type) query.type = type;
  if (recipientType) query.recipientType = recipientType;

  const [notifications, totalCount] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(normalizedLimit)
      .populate('createdByAdmin', 'name email'),
    Notification.countDocuments(query),
  ]);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        notifications,
        pagination: {
          page: normalizedPage,
          limit: normalizedLimit,
          totalCount,
          totalPages: Math.ceil(totalCount / normalizedLimit),
        },
      },
      'Admin notifications fetched'
    )
  );
});
