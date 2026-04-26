import { Artist } from '../models/artist.model.js';
import { Booking } from '../models/booking.model.js';
import { BookingHold } from '../models/bookingHold.model.js';
import {
  ALL_BOOKING_SLOT_ENUM,
  BOOKING_SLOT_ENUM,
  getSlotIntervalUtc,
  intervalsOverlap,
  istHmIntervalToUtc,
  istIntervalToUtcExclusiveEnd,
  legacyAvailabilitySlotToInterval,
  mergeArtistDayIntervals,
  normalizeHmToken,
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
  return Booking.findOne(query).select('_id eventDetails status');
};

export const findConflictingHold = async ({ artistId, startUtc, endUtc, userId }) => {
  const now = new Date();
  return BookingHold.findOne({
    artist: artistId,
    state: 'ACTIVE',
    expiresAt: { $gt: now },
    user: { $ne: userId },
    startUtc: { $lt: endUtc },
    endUtc: { $gt: startUtc },
  }).select('_id user expiresAt');
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

export const assertInventoryAvailable = async ({
  artistId,
  dateInput,
  slot,
  userId,
  excludeBookingId,
  ignoreHoldsForUserId,
}) => {
  const { startUtc, endUtc, dateKey } = getSlotIntervalUtc(dateInput, slot);
  if (!startUtc || !endUtc || !dateKey) {
    throw new ApiError(400, 'Invalid date or slot for availability check');
  }

  const bookingHit = await findConflictingBooking({
    artistId,
    startUtc,
    endUtc,
    slot,
    dateKey,
    excludeBookingId,
  });
  if (bookingHit) {
    throw new ApiError(409, 'Artist already has another booking for this date and slot');
  }

  const holdUserId = ignoreHoldsForUserId ?? userId;
  const holdHit = await findConflictingHold({
    artistId,
    startUtc,
    endUtc,
    userId: holdUserId,
  });
  if (holdHit) {
    throw new ApiError(409, 'This time was just reserved by another user. Pick another slot.');
  }

  return { startUtc, endUtc, dateKey };
};

export const createActiveHold = async ({ userId, artistId, dateInput, slot, addressId }) => {
  const artist = await Artist.findById(artistId);
  if (!artist) throw new ApiError(404, 'Artist not found');
  if (artist.status !== 'APPROVED') {
    throw new ApiError(400, 'Artist is not available for booking');
  }

  const msg = getArtistAvailabilityConflictMessage(artist, dateInput, slot);
  if (msg) throw new ApiError(409, msg);

  const { startUtc, endUtc, dateKey } = getSlotIntervalUtc(dateInput, slot);
  if (!startUtc || !endUtc) throw new ApiError(400, 'Invalid date or slot');
  if (startUtc.getTime() < Date.now()) {
    throw new ApiError(400, 'Past date or slot cannot be booked. Please choose an upcoming slot.');
  }

  await BookingHold.updateMany(
    {
      user: userId,
      artist: artistId,
      state: 'ACTIVE',
      startUtc: { $lt: endUtc },
      endUtc: { $gt: startUtc },
    },
    { $set: { state: 'RELEASED' } }
  );

  await assertInventoryAvailable({
    artistId,
    dateInput,
    slot,
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
    slot,
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

export const consumeHoldIfPresent = async ({ holdId, userId, artistId, dateInput, slot }) => {
  if (!holdId) {
    throw new ApiError(400, 'holdId is required to complete booking');
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

  const { startUtc, endUtc } = getSlotIntervalUtc(dateInput, slot);
  if (
    !startUtc ||
    !endUtc ||
    hold.slot !== slot ||
    !intervalsOverlap(hold.startUtc, hold.endUtc, startUtc, endUtc)
  ) {
    throw new ApiError(400, 'holdId does not match the selected date and slot');
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
      .select('startUtc endUtc slot expiresAt')
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
        let bStart = b.eventDetails?.startUtc ? new Date(b.eventDetails.startUtc) : null;
        let bEnd = b.eventDetails?.endUtc ? new Date(b.eventDetails.endUtc) : null;
        if (!bStart || !bEnd) {
          const iv = getSlotIntervalUtc(b.eventDetails.date, b.eventDetails.slot);
          bStart = iv.startUtc;
          bEnd = iv.endUtc;
        }
        return bStart && bEnd && startUtc && endUtc && intervalsOverlap(startUtc, endUtc, bStart, bEnd);
      });
      const holdHit = holds.some((h) => {
        if (toDateKeyInIST(h.startUtc) !== key) return false;
        return startUtc && endUtc && intervalsOverlap(startUtc, endUtc, h.startUtc, h.endUtc);
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
