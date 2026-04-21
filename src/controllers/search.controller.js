import { Artist } from '../models/artist.model.js';
import { Category } from '../models/category.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Canonical app services (must stay in sync with user app service grid / routes).
 * `key` is the stable id used by the app for navigation; `displayName` is shown on cards.
 * `matchTerms` are substrings matched case-insensitively against the search query.
 */
const CANONICAL_SERVICES = [
  {
    key: 'ramleela',
    displayName: 'Ramleela',
    matchTerms: ['ramleela', 'ram leela', 'ramlila', 'ramlila'],
  },
  {
    key: 'sunderkand',
    displayName: 'Sunderkand',
    matchTerms: ['sunderkand', 'sundarkand', 'sunder kand'],
  },
  {
    key: 'bhajan sandhya',
    displayName: 'Bhajan sandhya',
    matchTerms: ['bhajan', 'sandhya', 'bhajan sandhya', 'bhajan sandya'],
  },
  {
    key: 'bhagwat katha',
    displayName: 'Bhagwat katha',
    matchTerms: [
      'bhagwat',
      'bhagvat',
      'bagwat',
      'bahgwat',
      'katha',
      'bhagwat katha',
      'bhagwat khatha',
    ],
  },
  {
    key: 'rudrabhishek',
    displayName: 'Rudrabhishek',
    matchTerms: ['rudra', 'rudrabhishek', 'rudra abhishek', 'abhishek'],
  },
  {
    key: 'other services',
    displayName: 'Other services',
    matchTerms: ['other', 'other services', 'misc'],
  },
];

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matchCanonicalServices = (rawQuery) => {
  const q = String(rawQuery || '').trim().toLowerCase();
  if (!q) return [];

  const seen = new Set();
  const out = [];
  for (const svc of CANONICAL_SERVICES) {
    const hit = svc.matchTerms.some((term) => {
      const normalizedTerm = String(term || '').trim().toLowerCase();
      if (!normalizedTerm) return false;
      // Support both full phrase queries and short-prefix queries like "Ra".
      return normalizedTerm.includes(q) || q.includes(normalizedTerm);
    });
    if (hit && !seen.has(svc.key)) {
      seen.add(svc.key);
      out.push({ key: svc.key, displayName: svc.displayName });
    }
  }
  return out;
};

export const globalSearch = asyncHandler(async (req, res) => {
  const {
    q = '',
    city = '',
    category = '',
    limit = 8,
  } = req.query;

  const normalizedLimit = Math.min(Math.max(Number(limit) || 8, 1), 25);
  const normalizedQ = String(q || '').trim();
  const normalizedCity = String(city || '').trim();
  const normalizedCategory = String(category || '').trim();

  const query = { status: 'APPROVED' };
  if (normalizedCity) query['location.city'] = { $regex: new RegExp(escapeRegex(normalizedCity), 'i') };

  const categoryRegex = normalizedCategory || normalizedQ;
  if (normalizedCategory) {
    query.$or = [
      { category: { $regex: new RegExp(escapeRegex(normalizedCategory), 'i') } },
      { expertise: { $regex: new RegExp(escapeRegex(normalizedCategory), 'i') } },
    ];
  } else if (normalizedQ) {
    query.$or = [
      { name: { $regex: new RegExp(escapeRegex(normalizedQ), 'i') } },
      { category: { $regex: new RegExp(escapeRegex(normalizedQ), 'i') } },
      { expertise: { $regex: new RegExp(escapeRegex(normalizedQ), 'i') } },
      { 'location.city': { $regex: new RegExp(escapeRegex(normalizedQ), 'i') } },
    ];
  }

  const canonicalServices = matchCanonicalServices(normalizedQ);

  const [artists, serviceCategories] = await Promise.all([
    Artist.find(query)
      .sort({ 'rating.averageRating': -1, createdAt: -1 })
      .limit(normalizedLimit)
      .select('-refreshToken'),
    Category.find({
      isActive: true,
      ...(categoryRegex ? { name: { $regex: new RegExp(escapeRegex(categoryRegex), 'i') } } : {}),
    })
      .sort({ name: 1 })
      .limit(10),
  ]);

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        {
          artists,
          serviceCategories,
          /** Matched app services (always from canonical list; not dependent on DB categories). */
          services: canonicalServices,
          query: normalizedQ,
        },
        'Global search results fetched'
      )
    );
});
