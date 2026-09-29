'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  distanceMeters,
  isWithinRadius,
  isValidCoordinates,
  findNearest,
  formatDistance,
  slugify,
  uniqueSlug,
  formatOrderNumber,
  deriveBranchPrefix,
  escapeMarkdownV2,
  normalizePagination,
  buildPaginationMeta,
} = require('../dist/index.js');

const CHILONZOR = { latitude: 41.2756, longitude: 69.2035 };
const YUNUSOBOD = { latitude: 41.3628, longitude: 69.2896 };

test('distanceMeters matches a known great-circle distance', () => {
  const d = distanceMeters(CHILONZOR, YUNUSOBOD);
  // ~12 km across Tashkent; allow a small tolerance.
  assert.ok(d > 11500 && d < 12500, `expected ~12 km, got ${d} m`);
  assert.equal(distanceMeters(CHILONZOR, CHILONZOR), 0);
});

test('isWithinRadius treats a null radius as unlimited', () => {
  assert.equal(isWithinRadius(CHILONZOR, YUNUSOBOD, 5000), false);
  assert.equal(isWithinRadius(CHILONZOR, YUNUSOBOD, 20000), true);
  assert.equal(isWithinRadius(CHILONZOR, YUNUSOBOD, null), true);
});

test('isValidCoordinates rejects out-of-range and missing values', () => {
  assert.equal(isValidCoordinates(CHILONZOR), true);
  assert.equal(isValidCoordinates({ latitude: 91, longitude: 0 }), false);
  assert.equal(isValidCoordinates({ latitude: 0 }), false);
  assert.equal(isValidCoordinates({ latitude: NaN, longitude: 0 }), false);
});

test('findNearest picks the closest candidate', () => {
  const result = findNearest(CHILONZOR, [YUNUSOBOD, { latitude: 41.28, longitude: 69.21 }]);
  assert.ok(result);
  assert.equal(result.item.latitude, 41.28);
  assert.equal(findNearest(CHILONZOR, []), null);
});

test('formatDistance switches units at a kilometre', () => {
  assert.equal(formatDistance(640), '640 m');
  assert.equal(formatDistance(1240), '1.2 km');
});

test('slugify transliterates Cyrillic and strips punctuation', () => {
  assert.equal(slugify('Chilonzor filiali'), 'chilonzor-filiali');
  assert.equal(slugify('Чилонзор'), 'chilonzor');
  assert.equal(slugify('  Pizza & Drinks!  '), 'pizza-drinks');
});

test('uniqueSlug appends a suffix until free', () => {
  const taken = new Set(['chilonzor', 'chilonzor-2']);
  assert.equal(uniqueSlug('Chilonzor', taken), 'chilonzor-3');
  assert.equal(uniqueSlug('Yunusobod', taken), 'yunusobod');
});

test('order number formatting matches TZ §41', () => {
  assert.equal(formatOrderNumber(1054), '#1054');
  assert.equal(formatOrderNumber(1054, 'CH'), 'CH-1054');
  assert.equal(deriveBranchPrefix('Chilonzor'), 'CH');
});

test('escapeMarkdownV2 neutralises Telegram formatting characters', () => {
  assert.equal(escapeMarkdownV2('a_b*c'), 'a\\_b\\*c');
});

test('normalizePagination clamps page and limit', () => {
  // A meaningless page/limit of 0 falls back to the defaults rather than
  // producing an empty result set.
  assert.deepEqual(normalizePagination({ page: 0, limit: 0 }), {
    page: 1,
    limit: 20,
    skip: 0,
    take: 20,
  });
  assert.equal(normalizePagination({ limit: 10000 }).limit, 100);
  assert.equal(normalizePagination({ limit: 'abc' }).limit, 20);
  assert.equal(normalizePagination().limit, 20);
  assert.equal(normalizePagination({ page: 3, limit: 25 }).skip, 50);
});

test('buildPaginationMeta computes page flags', () => {
  const meta = buildPaginationMeta(45, { page: 2, limit: 20 });
  assert.deepEqual(meta, {
    page: 2,
    limit: 20,
    total: 45,
    totalPages: 3,
    hasNext: true,
    hasPrev: true,
  });
});
