/**
 * One-time migration to support the flip from the "positive availability"
 * model (artists mark when they ARE available) to the "unavailability" model
 * (artists mark when they are NOT available / blocked).
 *
 * Under the new model, each `availability.calendarDays[].intervals` entry
 * represents a BLOCKED time window. Empty calendarDays = artist is fully
 * available for every date and slot.
 *
 * Legacy documents contain calendarDays where intervals mean the OPPOSITE
 * (times the artist was available). If left as-is, every old artist would
 * appear unintentionally blocked during exactly those windows.
 *
 * This script wipes `availability.calendarDays` for every artist so the new
 * model starts from a clean slate. Artists will re-mark their unavailability
 * going forward. We intentionally DO NOT touch:
 *   - availability.isAvailable (master switch)
 *   - availability.schedules (named schedules)
 *   - availability.selectedScheduleId
 *   - serviceAddresses
 *
 * Usage:
 *   node scripts/resetArtistCalendarDays.js
 *   npm run reset:artist-calendar
 */

import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { Artist } from '../src/models/artist.model.js';

const run = async () => {
  await mongoose.connect(env.MONGODB_URI);

  const before = await Artist.countDocuments({
    'availability.calendarDays.0': { $exists: true },
  });

  const result = await Artist.updateMany(
    {},
    { $set: { 'availability.calendarDays': [] } }
  );

  console.log(
    `Reset complete. artistsWithCalendarDaysBefore=${before} matched=${result.matchedCount} modified=${result.modifiedCount}`
  );

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
