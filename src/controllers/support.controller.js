import { Artist } from '../models/artist.model.js';
import { SupportRequest } from '../models/supportRequest.model.js';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const createSupportRequestByType = (type) =>
  asyncHandler(async (req, res) => {
    const { subject, message } = req.body || {};
    const normalizedSubject = String(subject || '').trim();
    const normalizedMessage = String(message || '').trim();
    if (!normalizedSubject) throw new ApiError(400, 'Subject is required');
    if (!normalizedMessage) throw new ApiError(400, 'Message is required');

    const senderType = req.user?.role === 'ARTIST' ? 'ARTIST' : 'USER';
    const request = await SupportRequest.create({
      type,
      senderType,
      senderId: req.user?._id,
      subject: normalizedSubject,
      message: normalizedMessage,
      status: 'OPEN',
    });

    res.status(201).json(new ApiResponse(201, request, `${type} request submitted successfully`));
  });

export const submitHelpRequest = createSupportRequestByType('HELP');
export const submitFeedbackRequest = createSupportRequestByType('FEEDBACK');

export const getMySupportRequests = asyncHandler(async (req, res) => {
  const senderType = req.user?.role === 'ARTIST' ? 'ARTIST' : 'USER';
  const requests = await SupportRequest.find({
    senderType,
    senderId: req.user?._id,
  }).sort({ createdAt: -1 });

  res.status(200).json(new ApiResponse(200, requests, 'Support requests fetched successfully'));
});

const mapSenderDetails = async (requests) => {
  const userIds = requests.filter((item) => item.senderType === 'USER').map((item) => item.senderId);
  const artistIds = requests.filter((item) => item.senderType === 'ARTIST').map((item) => item.senderId);

  const [users, artists] = await Promise.all([
    userIds.length ? User.find({ _id: { $in: userIds } }).select('_id name phone') : [],
    artistIds.length ? Artist.find({ _id: { $in: artistIds } }).select('_id name phone') : [],
  ]);

  const userMap = new Map(users.map((item) => [String(item._id), item]));
  const artistMap = new Map(artists.map((item) => [String(item._id), item]));

  return requests.map((request) => {
    const sender = request.senderType === 'USER'
      ? userMap.get(String(request.senderId))
      : artistMap.get(String(request.senderId));

    return {
      ...request.toObject(),
      sender: sender
        ? {
          _id: sender._id,
          name: sender.name,
          phone: sender.phone,
          role: request.senderType,
        }
        : null,
    };
  });
};

export const getSupportRequestsForAdmin = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, type = '', status = '', q = '' } = req.query;
  const normalizedPage = Math.max(Number(page) || 1, 1);
  const normalizedLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const skip = (normalizedPage - 1) * normalizedLimit;

  const query = {};
  if (type) query.type = type;
  if (status) query.status = status;
  if (q) {
    query.$or = [
      { subject: { $regex: q, $options: 'i' } },
      { message: { $regex: q, $options: 'i' } },
    ];
  }

  const [requests, totalCount] = await Promise.all([
    SupportRequest.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(normalizedLimit)
      .populate('resolvedBy', 'name email'),
    SupportRequest.countDocuments(query),
  ]);

  const items = await mapSenderDetails(requests);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        requests: items,
        pagination: {
          page: normalizedPage,
          limit: normalizedLimit,
          totalCount,
          totalPages: Math.ceil(totalCount / normalizedLimit),
        },
      },
      'Support requests fetched'
    )
  );
});

export const resolveSupportRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const request = await SupportRequest.findById(id);
  if (!request) throw new ApiError(404, 'Support request not found');

  if (request.status === 'RESOLVED') {
    return res.status(200).json(new ApiResponse(200, request, 'Support request already resolved'));
  }

  request.status = 'RESOLVED';
  request.resolvedBy = req.user?._id;
  request.resolvedAt = new Date();
  await request.save();

  res.status(200).json(new ApiResponse(200, request, 'Support request resolved successfully'));
});
