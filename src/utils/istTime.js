/** @typedef {string} BookingSlotEnum */

/** Current product: eight 3-hour windows on the IST calendar day (except 9PM–12AM ends at next midnight). */
export const BOOKING_SLOT_ENUM = [
  '6AM-9AM',
  '9AM-12PM',
  '12PM-3PM',
  '3PM-6PM',
  '6PM-9PM',
  '9PM-12AM',
  '12AM-3AM',
  '3AM-6AM',
];

/** Deprecated 6-hour slots; still accepted on existing bookings until migrated. */
export const LEGACY_BOOKING_SLOT_ENUM = ['6AM-12PM', '12PM-6PM', '6PM-12AM', '12AM-6AM'];

export const ALL_BOOKING_SLOT_ENUM = [...BOOKING_SLOT_ENUM, ...LEGACY_BOOKING_SLOT_ENUM];

export const LEGACY_AVAILABILITY_SLOT_ENUM = [...LEGACY_BOOKING_SLOT_ENUM];

export const toDateKeyInIST = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
};

const addDaysToDateKey = (dateKey, days) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  const utcNoon = Date.UTC(y, m - 1, d) + days * 86400000;
  const t = new Date(utcNoon);
  return toDateKeyInIST(t);
};

/**
 * Half-open interval [startUtc, endUtc) for the booking slot on the IST calendar day
 * derived from the client-provided event date instant.
 * Supports current 3h slots and legacy 6h slots on existing records.
 * @param {string|Date} dateInput
 * @param {BookingSlotEnum} slot
 */
export const getSlotIntervalUtc = (dateInput, slot) => {
  const dateKey = toDateKeyInIST(dateInput);
  if (!dateKey || !ALL_BOOKING_SLOT_ENUM.includes(slot)) {
    return { startUtc: null, endUtc: null, dateKey: dateKey || null };
  }

  const istMid = (key, h, min = 0) => {
    const hh = String(h).padStart(2, '0');
    const mm = String(min).padStart(2, '0');
    return new Date(`${key}T${hh}:${mm}:00+05:30`);
  };

  const nextKey = addDaysToDateKey(dateKey, 1);

  // --- Legacy 6h ---
  if (slot === '6AM-12PM') {
    return { startUtc: istMid(dateKey, 6), endUtc: istMid(dateKey, 12), dateKey };
  }
  if (slot === '12PM-6PM') {
    return { startUtc: istMid(dateKey, 12), endUtc: istMid(dateKey, 18), dateKey };
  }
  if (slot === '6PM-12AM') {
    return { startUtc: istMid(dateKey, 18), endUtc: istMid(nextKey, 0), dateKey };
  }
  if (slot === '12AM-6AM') {
    return { startUtc: istMid(dateKey, 0), endUtc: istMid(dateKey, 6), dateKey };
  }

  // --- Current 3h (IST same calendar day except 9PM–12AM) ---
  if (slot === '6AM-9AM') {
    return { startUtc: istMid(dateKey, 6), endUtc: istMid(dateKey, 9), dateKey };
  }
  if (slot === '9AM-12PM') {
    return { startUtc: istMid(dateKey, 9), endUtc: istMid(dateKey, 12), dateKey };
  }
  if (slot === '12PM-3PM') {
    return { startUtc: istMid(dateKey, 12), endUtc: istMid(dateKey, 15), dateKey };
  }
  if (slot === '3PM-6PM') {
    return { startUtc: istMid(dateKey, 15), endUtc: istMid(dateKey, 18), dateKey };
  }
  if (slot === '6PM-9PM') {
    return { startUtc: istMid(dateKey, 18), endUtc: istMid(dateKey, 21), dateKey };
  }
  if (slot === '9PM-12AM') {
    return { startUtc: istMid(dateKey, 21), endUtc: istMid(nextKey, 0), dateKey };
  }
  if (slot === '12AM-3AM') {
    return { startUtc: istMid(dateKey, 0), endUtc: istMid(dateKey, 3), dateKey };
  }
  if (slot === '3AM-6AM') {
    return { startUtc: istMid(dateKey, 3), endUtc: istMid(dateKey, 6), dateKey };
  }

  return { startUtc: null, endUtc: null, dateKey };
};

export const intervalsOverlap = (aStart, aEnd, bStart, bEnd) => {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  const as = aStart.getTime();
  const ae = aEnd.getTime();
  const bs = bStart.getTime();
  const be = bEnd.getTime();
  return as < be && bs < ae;
};

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * @param {string} t
 * @returns {boolean}
 */
export const isValidHm = (t) => HH_MM.test(String(t || '').trim());

/** End-of-day sentinel for intervals that end at next calendar midnight (e.g. 18:00–24:00). */
export const isValidHmEnd = (t) => {
  const s = String(t || '').trim();
  if (s === '24:00') return true;
  return isValidHm(s);
};

/**
 * @param {string} t
 * @returns {string|null} zero-padded HH:mm or "24:00"
 */
export const normalizeHmToken = (t) => {
  const s = String(t || '').trim();
  if (s === '24:00') return '24:00';
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

const hmToMin = (hm) => {
  if (hm === '24:00') return 1440;
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
};

const minToHm = (min) => {
  const capped = Math.min(min, 23 * 60 + 59);
  const h = Math.floor(capped / 60);
  const m = capped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/**
 * Merge overlapping half-open ranges on one IST calendar day (minutes from 00:00, max end 1440).
 * @param {{ start: string, end: string }[]} intervals
 * @returns {{ start: string, end: string }[]}
 */
export const mergeArtistDayIntervals = (intervals) => {
  const ranges = [];
  for (const iv of intervals || []) {
    const start = normalizeHmToken(iv?.start);
    const endRaw = String(iv?.end || '').trim() === '24:00' ? '24:00' : normalizeHmToken(iv?.end);
    if (!start || !endRaw) continue;
    const a = hmToMin(start);
    const b = endRaw === '24:00' ? 1440 : hmToMin(endRaw);
    if (b <= a) continue;
    ranges.push([a, b]);
  }
  if (!ranges.length) return [];
  ranges.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const [a, b] of ranges) {
    const last = merged[merged.length - 1];
    if (!last || a > last[1]) merged.push([a, b]);
    else last[1] = Math.max(last[1], b);
  }
  return merged.map(([a, b]) => ({
    start: minToHm(a),
    end: b >= 1440 ? '24:00' : minToHm(b),
  }));
};

/**
 * IST wall-clock interval on dateKey as UTC instants [start, end) for overlap checks.
 * @param {string} dateKey YYYY-MM-DD
 * @param {{ start: string, end: string }} interval
 * @returns {{ startUtc: Date|null, endUtc: Date|null }}
 */
export const istHmIntervalToUtc = (dateKey, interval) => {
  const start = String(interval?.start || '').trim();
  const end = String(interval?.end || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !isValidHm(start) || !isValidHm(end)) {
    return { startUtc: null, endUtc: null };
  }
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if (eh * 60 + em <= sh * 60 + sm) {
    return { startUtc: null, endUtc: null };
  }
  const pad = (n) => String(n).padStart(2, '0');
  const startUtc = new Date(`${dateKey}T${pad(sh)}:${pad(sm)}:00+05:30`);
  const endUtc = new Date(`${dateKey}T${pad(eh)}:${pad(em)}:00+05:30`);
  if (Number.isNaN(startUtc.getTime()) || Number.isNaN(endUtc.getTime())) {
    return { startUtc: null, endUtc: null };
  }
  return { startUtc, endUtc };
};

/** Legacy calendar / availability slot labels → { start, end } HH:mm same IST day */
export const legacyAvailabilitySlotToInterval = (slot) => {
  const s = String(slot || '').trim();
  const map = {
    '6AM-12PM': { start: '06:00', end: '12:00' },
    '12PM-6PM': { start: '12:00', end: '18:00' },
    '6PM-12AM': { start: '18:00', end: '24:00' },
    '12AM-6AM': { start: '00:00', end: '06:00' },
  };
  if (map[s]) return map[s];
  return null;
};

/**
 * IST interval on dateKey as UTC instants; supports end "24:00" (exclusive midnight next IST day).
 * @param {string} dateKey YYYY-MM-DD
 * @param {{ start: string, end: string }} interval
 */
export const istIntervalToUtcExclusiveEnd = (dateKey, interval) => {
  const start = String(interval?.start || '').trim();
  const end = String(interval?.end || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !isValidHm(start)) {
    return { startUtc: null, endUtc: null };
  }
  if (end === '24:00') {
    const nextKey = addDaysToDateKey(dateKey, 1);
    const startUtc = new Date(`${dateKey}T${start}:00+05:30`);
    const endUtc = new Date(`${nextKey}T00:00:00+05:30`);
    if (Number.isNaN(startUtc.getTime()) || Number.isNaN(endUtc.getTime())) return { startUtc: null, endUtc: null };
    if (endUtc.getTime() <= startUtc.getTime()) return { startUtc: null, endUtc: null };
    return { startUtc, endUtc };
  }
  return istHmIntervalToUtc(dateKey, { start, end });
};
