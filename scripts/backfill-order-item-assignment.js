import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { Booking } from '../src/models/booking.model.js';
import { Order } from '../src/models/order.model.js';

const isSameId = (left, right) => String(left) === String(right);

const getOrderItemAssignedArtists = (orderItem) => {
  const currentEntries = Array.isArray(orderItem.assignedArtists) ? [...orderItem.assignedArtists] : [];
  const hasLegacyArtist = orderItem.artist && !currentEntries.some((entry) => isSameId(entry.artist, orderItem.artist));

  if (!hasLegacyArtist) return currentEntries;

  return [
    {
      artist: orderItem.artist,
      assignedBy: orderItem.assignment?.assignedBy,
      assignedAt: orderItem.assignment?.assignedAt || new Date(),
      source: orderItem.assignment?.source || 'ADMIN',
      note: orderItem.assignment?.note,
    },
    ...currentEntries,
  ];
};

const syncOrderItemLegacyAssignmentFields = (orderItem, assignedArtists) => {
  orderItem.assignedArtists = assignedArtists;
  const primaryAssignment = assignedArtists[0];

  if (!primaryAssignment) {
    orderItem.artist = undefined;
    orderItem.assignment = undefined;
    return;
  }

  orderItem.artist = primaryAssignment.artist;
  orderItem.assignment = {
    assignedBy: primaryAssignment.assignedBy,
    assignedAt: primaryAssignment.assignedAt,
    source: primaryAssignment.source,
    note: primaryAssignment.note,
  };
};

const syncLegacyBookingAssignmentFields = (booking, assignedArtists) => {
  booking.assignedArtists = assignedArtists;
  const primaryAssignment = assignedArtists[0];

  if (!primaryAssignment) {
    booking.artist = undefined;
    booking.assignment = undefined;
    return;
  }

  booking.artist = primaryAssignment.artist;
  booking.assignment = {
    assignedBy: primaryAssignment.assignedBy,
    assignedAt: primaryAssignment.assignedAt,
    source: primaryAssignment.source,
    note: primaryAssignment.note,
  };
};

const buildOrderItemEventDate = (orderItem) => {
  const candidate = orderItem?.date || orderItem?.dateTime;
  const date = candidate ? new Date(candidate) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const buildOrderItemSlot = (orderItem) => {
  const validSlots = [
    '6AM-9AM',
    '9AM-12PM',
    '12PM-3PM',
    '3PM-6PM',
    '6PM-9PM',
    '9PM-12AM',
    '12AM-3AM',
    '3AM-6AM',
    '6AM-12PM',
    '12PM-6PM',
    '6PM-12AM',
    '12AM-6AM',
  ];
  return validSlots.includes(orderItem?.slot) ? orderItem.slot : '6AM-9AM';
};

const buildOrderItemTypeLabel = (orderItem) => {
  const type = [orderItem?.serviceName, orderItem?.packageTitle].filter(Boolean).join(' - ');
  return type || 'Order package';
};

const syncLinkedBookingForOrderItem = async (order, itemIndex, assignedArtists) => {
  const orderItem = order.items[itemIndex];
  if (!orderItem) return;

  const linkedBooking = await Booking.findOne({
    sourceType: 'ORDER_ITEM',
    'sourceRef.orderId': order._id,
    'sourceRef.itemIndex': itemIndex,
  });

  if (!assignedArtists.length) {
    if (!linkedBooking) return;
    syncLegacyBookingAssignmentFields(linkedBooking, []);
    if (linkedBooking.status === 'PENDING' || linkedBooking.status === 'CONFIRMED') {
      linkedBooking.status = 'CANCELLED';
    }
    await linkedBooking.save();
    return;
  }

  const bookingData = {
    user: order.user,
    eventDetails: {
      date: buildOrderItemEventDate(orderItem),
      slot: buildOrderItemSlot(orderItem),
      type: buildOrderItemTypeLabel(orderItem),
    },
    location: {
      address: orderItem.addressDetail || 'Address unavailable',
      city: orderItem.city || 'City unavailable',
      pinCode: orderItem.pinCode,
    },
    pricing: {
      agreedPrice: Number(orderItem.price || 0),
      currency: order.currency || 'INR',
    },
    paymentStatus: ['PENDING', 'PAID', 'REFUNDED', 'FAILED'].includes(order.paymentStatus)
      ? order.paymentStatus
      : 'PENDING',
    sourceType: 'ORDER_ITEM',
    sourceRef: {
      orderId: order._id,
      itemIndex,
    },
  };

  const booking = linkedBooking || new Booking(bookingData);
  booking.user = bookingData.user;
  booking.eventDetails = bookingData.eventDetails;
  booking.location = bookingData.location;
  booking.pricing = bookingData.pricing;
  booking.paymentStatus = bookingData.paymentStatus;
  booking.sourceType = bookingData.sourceType;
  booking.sourceRef = bookingData.sourceRef;
  if (booking.status === 'CANCELLED' || booking.status === 'REJECTED') {
    booking.status = 'PENDING';
  }
  syncLegacyBookingAssignmentFields(booking, assignedArtists);
  await booking.save();
};

const run = async () => {
  await connectDB();

  const orders = await Order.find({});
  let ordersTouched = 0;
  let bookingsUpserted = 0;
  let bookingsCancelled = 0;

  for (const order of orders) {
    let orderChanged = false;

    for (let itemIndex = 0; itemIndex < order.items.length; itemIndex += 1) {
      const item = order.items[itemIndex];
      const previousArtistId = item.artist ? String(item.artist) : '';
      const assignedArtists = getOrderItemAssignedArtists(item);
      const previousLength = Array.isArray(item.assignedArtists) ? item.assignedArtists.length : 0;
      syncOrderItemLegacyAssignmentFields(item, assignedArtists);
      const nextArtistId = item.artist ? String(item.artist) : '';
      if (previousLength !== assignedArtists.length || previousArtistId !== nextArtistId) {
        orderChanged = true;
      }

      const existingLinkedBooking = await Booking.findOne({
        sourceType: 'ORDER_ITEM',
        'sourceRef.orderId': order._id,
        'sourceRef.itemIndex': itemIndex,
      });

      await syncLinkedBookingForOrderItem(order, itemIndex, assignedArtists);

      if (!assignedArtists.length && existingLinkedBooking) {
        bookingsCancelled += 1;
      } else if (assignedArtists.length) {
        bookingsUpserted += 1;
      }
    }

    if (orderChanged) {
      await order.save();
      ordersTouched += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        scannedOrders: orders.length,
        ordersTouched,
        bookingsUpserted,
        bookingsCancelled,
      },
      null,
      2
    )
  );

  await mongoose.connection.close();
};

run().catch(async (error) => {
  console.error('Backfill failed', error);
  await mongoose.connection.close();
  process.exit(1);
});
