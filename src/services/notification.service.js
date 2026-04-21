import { Artist } from '../models/artist.model.js';
import { Notification } from '../models/notification.model.js';
import { User } from '../models/user.model.js';

export const NOTIFICATION_TYPE = {
  ADMIN_BROADCAST: 'ADMIN_BROADCAST',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAYMENT_CLEARED: 'PAYMENT_CLEARED',
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
