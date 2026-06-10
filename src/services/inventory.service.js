import { Artist } from '../models/artist.model.js';
import { Booking } from '../models/booking.model.js';
import { BookingHold } from '../models/bookingHold.model.js';
import {
  ALL_BOOKING_SLOT_ENUM,
  BOOKING_SLOT_ENUM,
  bookingSlotsList,
  getSlotIntervalUtc,
  getSlotsSpanUtc,
  holdSlotsList,
  intervalsOverlap,
  istHmIntervalToUtc,
  istIntervalToUtcExclusiveEnd,
  legacyAvailabilitySlotToInterval,
  mergeArtistDayIntervals,
  normalizeHmToken,
  normalizeSlotsInput,
  slotsEqual,
  toDateKeyInIST,
} from '../utils/istTime.js';
import { ApiError } from '../utils/ApiError.js';

export const ACTIVE_BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'UPCOMING', 'ONGOING', 'MANUAL_REVIEW'];

const DEFAULT_HOLD_MS = 15 * 60 * 1000;

export const getHoldTtlMs = () => {
  const raw = Number(process.env.BOOKING_HOLD_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HOLD_MS;
};

const artistMatch = (artistId) => ({
  $or: [{ artist: artistId }, { 'assignedArtists.artist': artistId }],
});

const buildLegacySameDaySlotClause = (dateKey, slot) => ({
  $and: [
    {
      $or: [
        { 'eventDetails.startUtc': { $exists: false } },
        { 'eventDetails.endUtc': { $exists: false } },
        { 'eventDetails.startUtc': null },
        { 'eventDetails.endUtc': null },
      ],
    },
    { 'eventDetails.slot': slot },
    {
      $expr: {
        $eq: [
          {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$eventDetails.date',
              timezone: 'Asia/Kolkata',
            },
          },
          dateKey,
        ],
      },
    },
  ],
});

const buildIntervalOverlapClause = (startUtc, endUtc) => ({
  $and: [
    { 'eventDetails.startUtc': { $exists: true, $ne: null } },
    { 'eventDetails.endUtc': { $exists: true, $ne: null } },
    { 'eventDetails.startUtc': { $lt: endUtc } },
    { 'eventDetails.endUtc': { $gt: startUtc } },
  ],
});

const bookingOverlapsRequestedSlot = (booking, dateKey, requestedStartUtc, requestedEndUtc) => {
  const ed = booking?.eventDetails;
  if (!ed) return false;
  const bookingDateKey = toDateKeyInIST(ed.date);
  if (bookingDateKey !== dateKey) return false;

  const slots = bookingSlotsList(ed);
  const refDate = ed.date;
  for (const s of slots) {
    const { startUtc, endUtc } = getSlotIntervalUtc(refDate, s);
    if (startUtc && endUtc && intervalsOverlap(requestedStartUtc, requestedEndUtc, startUtc, endUtc)) {
      return true;
    }
  }
  return false;
};

const holdOverlapsRequestedSlot = (hold, dateKey, requestedStartUtc, requestedEndUtc) => {
  const holdDateKey = hold?.dateKey || toDateKeyInIST(hold?.startUtc);
  if (holdDateKey !== dateKey) return false;

  const refDate = hold.startUtc || `${dateKey}T12:00:00+05:30`;
  for (const s of holdSlotsList(hold)) {
    const { startUtc, endUtc } = getSlotIntervalUtc(refDate, s);
    if (startUtc && endUtc && intervalsOverlap(requestedStartUtc, requestedEndUtc, startUtc, endUtc)) {
      return true;
    }
  }
  return false;
};

export const findConflictingBooking = async ({ artistId, startUtc, endUtc, slot, dateKey, excludeBookingId }) => {
  const query = {
    status: { $in: ACTIVE_BOOKING_STATUSES },
    $and: [
      artistMatch(artistId),
      {
        $or: [buildIntervalOverlapClause(startUtc, endUtc), buildLegacySameDaySlotClause(dateKey, slot)],
      },
    ],
  };
  if (excludeBookingId) {
    query._id = { $ne: excludeBookingId };
  }
  const directHit = await Booking.findOne(query).select('_id eventDetails status');
  if (directHit) return directHit;

  const sameDayQuery = {
    status: { $in: ACTIVE_BOOKING_STATUSES },
    $and: [
      artistMatch(artistId),
      {
        $expr: {
          $eq: [
            {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$eventDetails.date',
                timezone: 'Asia/Kolkata',
              },
            },
            dateKey,
          ],
        },
      },
    ],
  };
  if (excludeBookingId) {
    sameDayQuery._id = { $ne: excludeBookingId };
  }

  const sameDayBookings = await Booking.find(sameDayQuery).select('_id eventDetails status').lean();
  for (const booking of sameDayBookings) {
    if (bookingOverlapsRequestedSlot(booking, dateKey, startUtc, endUtc)) {
      return booking;
    }
  }
  return null;
};

export const findConflictingHold = async ({ artistId, startUtc, endUtc, slot, dateKey, userId }) => {
  const now = new Date();
  const holds = await BookingHold.find({
    artist: artistId,
    state: 'ACTIVE',
    expiresAt: { $gt: now },
    user: { $ne: userId },
  })
    .select('_id user expiresAt startUtc endUtc slot slots dateKey')
    .lean();

  for (const hold of holds) {
    const key = hold.dateKey || toDateKeyInIST(hold.startUtc);
    if (key !== dateKey) continue;
    if (holdOverlapsRequestedSlot(hold, dateKey, startUtc, endUtc)) {
      return hold;
    }
  }
  return null;
};

/**
 * Union of HM intervals for a date across all calendar rows (all schedules).
 * In the unavailability model, entries in `calendarDays[].intervals` represent
 * BLOCKED time windows (artist is NOT available). Legacy `slots` on a row are
 * also treated as blocked ranges and converted to HM ranges then merged.
 * An empty result means the artist has no blocks for that date (fully available).
 */
const unionBlockedHmIntervalsForDateKey = (artist, dateKey) => {
  const rows = (artist?.availability?.calendarDays || []).filter(
    (d) => String(d?.dateKey || '').trim() === dateKey
  );
  const hmList = [];
  for (const row of rows) {
    if (row?.enabled === false) continue;
    if (Array.isArray(row.intervals)) {
      for (const iv of row.intervals) {
        const start = normalizeHmToken(iv?.start);
        const end =
          String(iv?.end || '').trim() === '24:00' ? '24:00' : normalizeHmToken(iv?.end);
        if (start && end) hmList.push({ start, end });
      }
    }
    for (const slot of Array.isArray(row?.slots) ? row.slots : []) {
      const c = legacyAvailabilitySlotToInterval(String(slot || '').trim());
      if (!c) continue;
      hmList.push({
        start: normalizeHmToken(c.start),
        end: c.end === '24:00' ? '24:00' : normalizeHmToken(c.end),
      });
    }
  }
  return mergeArtistDayIntervals(hmList.filter((x) => x.start && x.end));
};

const unionBlockedUtcIntervalsForDateKey = (artist, dateKey) => {
  const mergedHm = unionBlockedHmIntervalsForDateKey(artist, dateKey);
  const out = [];
  for (const iv of mergedHm) {
    if (iv.end === '24:00') {
      const r = istIntervalToUtcExclusiveEnd(dateKey, { start: iv.start, end: '24:00' });
      if (r.startUtc && r.endUtc) out.push({ startUtc: r.startUtc, endUtc: r.endUtc });
    } else {
      const r = istHmIntervalToUtc(dateKey, iv);
      if (r.startUtc && r.endUtc) out.push({ startUtc: r.startUtc, endUtc: r.endUtc });
    }
  }
  return out;
};

/**
 * A 3h product slot is considered blocked by the artist if it has a non-empty
 * intersection with any of the artist's blocked UTC intervals.
 */
const slotOverlapsBlockedIntervals = (slotStart, slotEnd, utcIntervals) => {
  if (!slotStart || !slotEnd) return false;
  return utcIntervals.some(({ startUtc, endUtc }) =>
    intervalsOverlap(slotStart, slotEnd, startUtc, endUtc)
  );
};

export const getArtistAvailabilityConflictMessage = (artist, dateInput, slot) => {
  const availability = artist?.availability || {};
  if (availability.isAvailable === false) {
    return 'Artist is currently unavailable';
  }
  if (!ALL_BOOKING_SLOT_ENUM.includes(slot)) {
    return 'Invalid slot';
  }

  const dateKey = toDateKeyInIST(dateInput);
  const { startUtc, endUtc } = getSlotIntervalUtc(dateInput, slot);
  if (!startUtc || !endUtc) {
    return 'Invalid date or slot for availability check';
  }

  const blockedUtcIntervals = unionBlockedUtcIntervalsForDateKey(artist, dateKey);
  if (slotOverlapsBlockedIntervals(startUtc, endUtc, blockedUtcIntervals)) {
    return `Artist is unavailable for slot ${slot} on ${dateKey}`;
  }
  return '';
};

export const getArtistAvailabilityConflictMessageForSlots = (artist, dateInput, slots) => {
  const normalized = normalizeSlotsInput({ slots });
  if (!normalized.length) {
    return 'At least one time slot is required';
  }
  for (const slot of normalized) {
    const msg = getArtistAvailabilityConflictMessage(artist, dateInput, slot);
    if (msg) return msg;
  }
  return '';
};

export const assertInventoryAvailable = async ({
  artistId,
  dateInput,
  slot,
  slots: slotsInput,
  userId,
  excludeBookingId,
  ignoreHoldsForUserId,
}) => {
  const normalized = normalizeSlotsInput({ slot, slots: slotsInput });
  if (!normalized.length) {
    throw new ApiError(400, 'At least one time slot is required');
  }

  const holdUserId = ignoreHoldsForUserId ?? userId;
  let spanStart = null;
  let spanEnd = null;
  let dateKey = null;

  for (const s of normalized) {
    const { startUtc, endUtc, dateKey: dk } = getSlotIntervalUtc(dateInput, s);
    if (!startUtc || !endUtc || !dk) {
      throw new ApiError(400, 'Invalid date or slot for availability check');
    }
    dateKey = dk;

    const bookingHit = await findConflictingBooking({
      artistId,
      startUtc,
      endUtc,
      slot: s,
      dateKey: dk,
      excludeBookingId,
    });
    if (bookingHit) {
      throw new ApiError(409, 'Artist already has another booking for this date and slot');
    }

    const holdHit = await findConflictingHold({
      artistId,
      startUtc,
      endUtc,
      slot: s,
      dateKey: dk,
      userId: holdUserId,
    });
    if (holdHit) {
      throw new ApiError(409, 'This time was just reserved by another user. Pick another slot.');
    }

    if (!spanStart || startUtc < spanStart) spanStart = startUtc;
    if (!spanEnd || endUtc > spanEnd) spanEnd = endUtc;
  }

  return { startUtc: spanStart, endUtc: spanEnd, dateKey, slots: normalized };
};

export const createActiveHold = async ({ userId, artistId, dateInput, slot, slots: slotsInput, addressId }) => {
  const normalized = normalizeSlotsInput({ slot, slots: slotsInput });
  if (!normalized.length) {
    throw new ApiError(400, 'At least one time slot is required');
  }

  const artist = await Artist.findById(artistId);
  if (!artist) throw new ApiError(404, 'Artist not found');
  if (artist.status !== 'APPROVED') {
    throw new ApiError(400, 'Artist is not available for booking');
  }

  const msg = getArtistAvailabilityConflictMessageForSlots(artist, dateInput, normalized);
  if (msg) throw new ApiError(409, msg);

  const { startUtc, endUtc, dateKey } = getSlotsSpanUtc(dateInput, normalized);
  if (!startUtc || !endUtc) throw new ApiError(400, 'Invalid date or slot');
  if (startUtc.getTime() < Date.now()) {
    throw new ApiError(400, 'Past date or slot cannot be booked. Please choose an upcoming slot.');
  }

  const activeHolds = await BookingHold.find({
    user: userId,
    artist: artistId,
    state: 'ACTIVE',
    expiresAt: { $gt: new Date() },
  }).select('startUtc endUtc slot slots dateKey');

  for (const existing of activeHolds) {
    const key = existing.dateKey || toDateKeyInIST(existing.startUtc);
    for (const s of normalized) {
      const { startUtc: sStart, endUtc: sEnd } = getSlotIntervalUtc(dateInput, s);
      if (holdOverlapsRequestedSlot(existing, key, sStart, sEnd)) {
        existing.state = 'RELEASED';
        await existing.save();
        break;
      }
    }
  }

  await assertInventoryAvailable({
    artistId,
    dateInput,
    slots: normalized,
    userId,
    excludeBookingId: null,
    ignoreHoldsForUserId: null,
  });

  const expiresAt = new Date(Date.now() + getHoldTtlMs());
  const hold = await BookingHold.create({
    user: userId,
    artist: artistId,
    addressId: addressId || undefined,
    startUtc,
    endUtc,
    dateKey,
    slot: normalized[0],
    slots: normalized,
    state: 'ACTIVE',
    expiresAt,
  });

  return hold;
};

export const releaseHoldById = async (holdId, userId) => {
  const hold = await BookingHold.findOne({ _id: holdId, user: userId, state: 'ACTIVE' });
  if (!hold) return null;
  hold.state = 'RELEASED';
  await hold.save();
  return hold;
};

export const consumeHoldIfPresent = async ({ holdId, userId, artistId, dateInput, slot, slots: slotsInput }) => {
  if (!holdId) {
    throw new ApiError(400, 'holdId is required to complete booking');
  }

  const normalized = normalizeSlotsInput({ slot, slots: slotsInput });
  if (!normalized.length) {
    throw new ApiError(400, 'At least one time slot is required');
  }

  const now = new Date();
  const hold = await BookingHold.findOne({
    _id: holdId,
    user: userId,
    artist: artistId,
    state: 'ACTIVE',
    expiresAt: { $gt: now },
  });

  if (!hold) {
    throw new ApiError(409, 'Your slot reservation expired. Go back and select the time again.');
  }

  const holdSlots = holdSlotsList(hold);
  if (!slotsEqual(holdSlots, normalized)) {
    throw new ApiError(400, 'holdId does not match the selected date and slots');
  }

  const holdDateKey = hold.dateKey || toDateKeyInIST(dateInput);
  const requestDateKey = toDateKeyInIST(dateInput);
  if (holdDateKey !== requestDateKey) {
    throw new ApiError(400, 'holdId does not match the selected date and slots');
  }

  hold.state = 'CONSUMED';
  await hold.save();
  return hold;
};

/**
 * Per-day slot map for green/red UI.
 *
 * Unavailability model: each slot defaults to `free` unless:
 *  - the artist's master `isAvailable` switch is off (state=unavailable, reason=artist_offline),
 *  - the slot overlaps an artist-marked blocked interval (state=unavailable, reason=blocked_by_artist),
 *  - there is an active booking on that slot (state=busy, reason=booked), or
 *  - there is an active hold on that slot (state=busy, reason=held).
 */
export const buildArtistCalendarPayload = async ({ artistId, from, to }) => {
  const artist = await Artist.findById(artistId).select('availability name category');
  if (!artist) throw new ApiError(404, 'Artist not found');

  const fromD = new Date(from);
  const toD = new Date(to);
  if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
    throw new ApiError(400, 'Invalid from/to range');
  }

  const rangePadStart = new Date(fromD.getFullYear(), fromD.getMonth(), fromD.getDate(), 0, 0, 0, 0);
  const rangePadEnd = new Date(toD.getFullYear(), toD.getMonth(), toD.getDate(), 23, 59, 59, 999);

  const [bookings, holds] = await Promise.all([
    Booking.find({
      status: { $in: ACTIVE_BOOKING_STATUSES },
      $and: [
        artistMatch(artistId),
        {
          $or: [
            { 'eventDetails.date': { $gte: rangePadStart, $lte: rangePadEnd } },
            {
              'eventDetails.startUtc': { $lte: rangePadEnd },
              'eventDetails.endUtc': { $gte: rangePadStart },
            },
          ],
        },
      ],
    })
      .select('eventDetails status paymentStatus inventoryCommitted')
      .lean(),
    BookingHold.find({
      artist: artistId,
      state: 'ACTIVE',
      expiresAt: { $gt: new Date() },
      startUtc: { $lt: rangePadEnd },
      endUtc: { $gt: rangePadStart },
    })
      .select('startUtc endUtc slot slots dateKey expiresAt')
      .lean(),
  ]);

  const availability = artist.availability || {};
  const artistOffline = availability.isAvailable === false;

  const days = [];
  const cursor = new Date(fromD.getFullYear(), fromD.getMonth(), fromD.getDate());
  const endCursor = new Date(toD.getFullYear(), toD.getMonth(), toD.getDate());
  while (cursor <= endCursor) {
    const key = toDateKeyInIST(cursor);
    const blockedUtcIntervals = artistOffline ? [] : unionBlockedUtcIntervalsForDateKey(artist, key);

    const slotsAvailable = [];
    const slotsStatus = {};
    for (const slot of BOOKING_SLOT_ENUM) {
      const { startUtc, endUtc } = getSlotIntervalUtc(`${key}T12:00:00+05:30`, slot);

      const bookingHit = bookings.some((b) => {
        if (toDateKeyInIST(b.eventDetails?.date) !== key) return false;
        return bookingOverlapsRequestedSlot(b, key, startUtc, endUtc);
      });
      const holdHit = holds.some((h) => {
        const holdKey = h.dateKey || toDateKeyInIST(h.startUtc);
        if (holdKey !== key) return false;
        return holdOverlapsRequestedSlot(h, key, startUtc, endUtc);
      });

      const blockedByArtist = slotOverlapsBlockedIntervals(startUtc, endUtc, blockedUtcIntervals);

      let state = 'free';
      let reason = null;
      if (artistOffline) {
        state = 'unavailable';
        reason = 'artist_offline';
      } else if (blockedByArtist) {
        state = 'unavailable';
        reason = 'blocked_by_artist';
      } else if (bookingHit) {
        state = 'busy';
        reason = 'booked';
      } else if (holdHit) {
        state = 'busy';
        reason = 'held';
      }

      if (state === 'free') slotsAvailable.push(slot);
      slotsStatus[slot] = { state, reason };
    }

    days.push({ dateKey: key, slotsAvailable, slotsStatus });
    cursor.setDate(cursor.getDate() + 1);
  }

  return {
    artistId: String(artistId),
    from: fromD.toISOString(),
    to: toD.toISOString(),
    isAvailable: availability.isAvailable !== false,
    days,
  };
};

export const buildArtistsCalendarIntersectionPayload = async ({ artistIds, from, to }) => {
  const normalizedIds = [...new Set((Array.isArray(artistIds) ? artistIds : []).map((id) => String(id).trim()).filter(Boolean))];
  if (!normalizedIds.length) {
    throw new ApiError(400, 'artistIds is required');
  }

  const artistCalendars = await Promise.all(
    normalizedIds.map((artistId) => buildArtistCalendarPayload({ artistId, from, to }))
  );

  const dayKeySet = new Set();
  for (const calendar of artistCalendars) {
    for (const day of calendar.days || []) {
      if (day?.dateKey) dayKeySet.add(day.dateKey);
    }
  }

  const sortedDayKeys = [...dayKeySet].sort();
  const days = sortedDayKeys.map((dateKey) => {
    const slotsStatus = {};
    const slotsAvailable = [];

    for (const slot of BOOKING_SLOT_ENUM) {
      const slotStates = artistCalendars.map((calendar) => calendar.days?.find((day) => day.dateKey === dateKey)?.slotsStatus?.[slot]);
      const isEveryArtistFree = slotStates.every((entry) => entry?.state === 'free');

      if (isEveryArtistFree) {
        slotsStatus[slot] = { state: 'free', reason: null };
        slotsAvailable.push(slot);
        continue;
      }

      const hasBusy = slotStates.some((entry) => entry?.state === 'busy');
      slotsStatus[slot] = { state: hasBusy ? 'busy' : 'unavailable', reason: 'artist_intersection_blocked' };
    }

    return { dateKey, slotsAvailable, slotsStatus };
  });

  return {
    artistIds: normalizedIds,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    isAvailable: days.some((day) => (day.slotsAvailable || []).length > 0),
    days,
  };
};
