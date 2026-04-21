/** @typedef {'6AM-12PM' | '12PM-6PM' | '6PM-12AM' | '12AM-6AM'} BookingSlotEnum */

export const BOOKING_SLOT_ENUM = ['6AM-12PM', '12PM-6PM', '6PM-12AM', '12AM-6AM'];

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
 * @param {string|Date} dateInput
 * @param {BookingSlotEnum} slot
 */
export const getSlotIntervalUtc = (dateInput, slot) => {
  const dateKey = toDateKeyInIST(dateInput);
  if (!dateKey || !BOOKING_SLOT_ENUM.includes(slot)) {
    return { startUtc: null, endUtc: null, dateKey: dateKey || null };
  }

  const istMid = (key, h, min = 0) => {
    const hh = String(h).padStart(2, '0');
    const mm = String(min).padStart(2, '0');
    return new Date(`${key}T${hh}:${mm}:00+05:30`);
  };

  if (slot === '6AM-12PM') {
    return { startUtc: istMid(dateKey, 6), endUtc: istMid(dateKey, 12), dateKey };
  }
  if (slot === '12PM-6PM') {
    return { startUtc: istMid(dateKey, 12), endUtc: istMid(dateKey, 18), dateKey };
  }
  if (slot === '6PM-12AM') {
    const nextKey = addDaysToDateKey(dateKey, 1);
    return { startUtc: istMid(dateKey, 18), endUtc: istMid(nextKey, 0), dateKey };
  }
  // 12AM-6AM
  return { startUtc: istMid(dateKey, 0), endUtc: istMid(dateKey, 6), dateKey };
};

export const intervalsOverlap = (aStart, aEnd, bStart, bEnd) => {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  const as = aStart.getTime();
  const ae = aEnd.getTime();
  const bs = bStart.getTime();
  const be = bEnd.getTime();
  return as < be && bs < ae;
};
