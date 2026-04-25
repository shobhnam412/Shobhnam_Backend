import { Artist } from '../models/artist.model.js';
import { Notification } from '../models/notification.model.js';
import { User } from '../models/user.model.js';

export const NOTIFICATION_TYPE = {
  ADMIN_BROADCAST: 'ADMIN_BROADCAST',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAYMENT_CLEARED: 'PAYMENT_CLEARED',
  SERVICE_BOOKED: 'SERVICE_BOOKED',
  ACTIVATION_VERIFIED: 'ACTIVATION_VERIFIED',
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  EVENT_ASSIGNED: 'EVENT_ASSIGNED',
  EVENT_COMPLETED: 'EVENT_COMPLETED',
  BANK_VERIFIED: 'BANK_VERIFIED',
  PAYMENT_REMINDER: 'PAYMENT_REMINDER',
};

const toObjectIdString = (value) => String(value || '');

const buildPaymentPendingQuery = ({ recipientType, recipientId, paymentDomain, referenceId }) => ({
  recipientType,
  recipientId,
  type: NOTIFICATION_TYPE.PAYMENT_PENDING,
  isActive: true,
  ...(paymentDomain ? { 'meta.paymentDomain': paymentDomain } : {}),
  ...(referenceId ? { 'meta.referenceId': toObjectIdString(referenceId) } : {}),
});

const buildUniqueQuery = ({ recipientType, recipientId, type, dedupeBy, meta = {} }) => {
  if (!dedupeBy) return null;
  if (dedupeBy === 'REFERENCE') {
    const referenceDomain = String(meta.referenceDomain || '').trim();
    const referenceId = toObjectIdString(meta.referenceId);
    if (!referenceDomain || !referenceId) return null;
    return {
      recipientType,
      recipientId,
      type,
      isActive: true,
      'meta.referenceDomain': referenceDomain,
      'meta.referenceId': referenceId,
    };
  }
  return null;
};

export const createPaymentPendingNotification = async ({
  recipientType,
  recipientId,
  paymentDomain,
  referenceId,
  title,
  message,
  meta = {},
}) => {
  const query = buildPaymentPendingQuery({ recipientType, recipientId, paymentDomain, referenceId });
  return Notification.findOneAndUpdate(
    query,
    {
      $set: {
        title,
        message,
        type: NOTIFICATION_TYPE.PAYMENT_PENDING,
        isActive: true,
        isRead: false,
        meta: {
          ...meta,
          paymentDomain,
          referenceId: referenceId ? toObjectIdString(referenceId) : undefined,
        },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

export const deactivatePaymentPendingNotifications = async ({
  recipientType,
  recipientId,
  paymentDomain,
  referenceId,
}) => {
  const query = buildPaymentPendingQuery({ recipientType, recipientId, paymentDomain, referenceId });
  const result = await Notification.updateMany(query, {
    $set: {
      isActive: false,
      isRead: true,
      expiresAt: new Date(),
    },
  });
  return result.modifiedCount || 0;
};

export const createInAppNotification = async ({
  recipientType,
  recipientId,
  type,
  title,
  message,
  meta = {},
  dedupeBy = null,
}) => {
  const payload = {
    recipientType,
    recipientId,
    type,
    title,
    message,
    isActive: true,
    isRead: false,
    meta: {
      ...meta,
      referenceId: meta.referenceId ? toObjectIdString(meta.referenceId) : meta.referenceId,
    },
  };

  const uniqueQuery = buildUniqueQuery({ recipientType, recipientId, type, dedupeBy, meta: payload.meta });
  if (!uniqueQuery) {
    return Notification.create(payload);
  }

  return Notification.findOneAndUpdate(
    uniqueQuery,
    { $set: payload },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const mapRecipients = async (target) => {
  if (target === 'USERS' || target === 'ALL') {
    const users = await User.find({ role: 'USER' }).select('_id');
    const userRecipients = users.map((item) => ({
      recipientType: 'USER',
      recipientId: item._id,
    }));
    if (target !== 'ALL') return userRecipients;

    const artists = await Artist.find().select('_id');
    const artistRecipients = artists.map((item) => ({
      recipientType: 'ARTIST',
      recipientId: item._id,
    }));
    return [...userRecipients, ...artistRecipients];
  }

  const artists = await Artist.find().select('_id');
  return artists.map((item) => ({
    recipientType: 'ARTIST',
    recipientId: item._id,
  }));
};

export const createAdminBroadcastNotifications = async ({
  target,
  title,
  message,
  createdByAdmin,
  meta = {},
}) => {
  const recipients = await mapRecipients(target);
  if (!recipients.length) return { insertedCount: 0 };

  const now = new Date();
  const docs = recipients.map((recipient) => ({
    ...recipient,
    type: NOTIFICATION_TYPE.ADMIN_BROADCAST,
    title,
    message,
    isRead: false,
    isActive: true,
    createdByAdmin,
    meta: {
      ...meta,
      target,
    },
    createdAt: now,
    updatedAt: now,
  }));

  const inserted = await Notification.insertMany(docs, { ordered: false });
  return { insertedCount: inserted.length };
};
