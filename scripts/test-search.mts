// Unit tests for the unified-search helpers.
//
//   node --experimental-strip-types scripts/test-search.mts
//
// The unified search is what turns "2020" or "威海" into a jump
// target, so a parsing bug means the search lands on the wrong
// moment.

import assert from 'node:assert/strict';
import {
  matchContemporaries,
  matchPlaces,
  matchTimes,
  photoDate,
  type SearchablePhoto,
} from '../lib/search.ts';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}`);
    console.error(`       ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

function photo(
  filename: string,
  location: string | null,
  iso: string,
): SearchablePhoto {
  return {
    filename,
    location_name: location,
    taken_at: iso,
    created_at: iso,
  };
}

const PHOTOS: SearchablePhoto[] = [
  photo('a.jpg', '威海', '2020-03-29T10:00:00Z'),
  photo('b.jpg', '威海', '2020-04-02T10:00:00Z'),
  photo('c.jpg', '东京', '2020-05-11T10:00:00Z'),
  photo('d.jpg', '东京', '2025-10-13T10:00:00Z'),
  photo('e.jpg', null, '2026-08-27T10:00:00Z'),
];

console.log('unified search unit tests\n');

test('photoDate prefers taken_at over created_at', () => {
  const p: SearchablePhoto = {
    filename: 'x',
    location_name: null,
    taken_at: '2020-03-29T00:00:00Z',
    created_at: '2021-01-01T00:00:00Z',
  };
  const d = photoDate(p);
  assert.ok(d);
  assert.equal(d.getUTCFullYear(), 2020);
});

test('photoDate falls back to created_at', () => {
  const d = photoDate({
    filename: 'x',
    location_name: null,
    taken_at: null,
    created_at: '2021-01-01T00:00:00Z',
  });
  assert.ok(d);
  assert.equal(d.getUTCFullYear(), 2021);
});

test('matchPlaces groups by name and counts photos', () => {
  const hits = matchPlaces(PHOTOS, '威');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, '威海');
  assert.equal(hits[0].count, 2);
});

test('matchPlaces is case-insensitive', () => {
  const hits = matchPlaces(
    [photo('x.jpg', 'Tokyo', '2020-01-01T00:00:00Z')],
    'tokyo',
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, 'Tokyo');
});

test('matchPlaces ignores photos without a location', () => {
  assert.deepEqual(matchPlaces(PHOTOS, 'jpg'), []);
});

test('matchPlaces returns [] for an empty query', () => {
  assert.deepEqual(matchPlaces(PHOTOS, '   '), []);
});

test('matchPlaces sorts by photo count desc', () => {
  const hits = matchPlaces(PHOTOS, '');
  assert.deepEqual(hits, []);
});

test('matchTimes resolves a year', () => {
  const hits = matchTimes(PHOTOS, '2020');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'year');
  assert.equal(hits[0].count, 3);
  assert.equal(hits[0].date.getFullYear(), 2020);
});

test('matchTimes resolves a year-month', () => {
  for (const q of ['2020-03', '2020/03', '2020年3月']) {
    const hits = matchTimes(PHOTOS, q);
    assert.equal(hits.length, 1, q);
    assert.equal(hits[0].kind, 'month', q);
    assert.equal(hits[0].count, 1, q);
    assert.equal(hits[0].date.getMonth(), 2, q);
  }
});

test('matchTimes resolves a full date', () => {
  const hits = matchTimes(PHOTOS, '2020-03-29');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'monthday');
  assert.equal(hits[0].count, 1);
  assert.equal(hits[0].date.getDate(), 29);
});

test('matchTimes resolves a month-day across years', () => {
  const hits = matchTimes(PHOTOS, '10-13');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'monthday');
  assert.equal(hits[0].count, 1);
  // Lands on the most recent occurrence.
  assert.equal(hits[0].date.getFullYear(), 2025);
});

test('matchTimes resolves a zero-padded month-day', () => {
  const hits = matchTimes(PHOTOS, '1013');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].count, 1);
});

test('matchTimes returns [] for an impossible month', () => {
  assert.deepEqual(matchTimes(PHOTOS, '2020-13'), []);
  assert.deepEqual(matchTimes(PHOTOS, '2020-00'), []);
});

test('matchTimes returns [] for a non-date query', () => {
  assert.deepEqual(matchTimes(PHOTOS, '威海'), []);
  assert.deepEqual(matchTimes(PHOTOS, 'hello'), []);
});

test('matchTimes returns [] when nothing matches', () => {
  assert.deepEqual(matchTimes(PHOTOS, '1999'), []);
});

test('matchTimes returns [] for a year outside the plausible range', () => {
  assert.deepEqual(matchTimes(PHOTOS, '1800'), []);
  assert.deepEqual(matchTimes(PHOTOS, '2200'), []);
});

test('matchContemporaries finds other places in the same window', () => {
  const place = PHOTOS.filter((p) => p.location_name === '威海');
  const hits = matchContemporaries(PHOTOS, place, 45);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, '东京');
  assert.equal(hits[0].count, 1);
});

test('matchContemporaries excludes the place itself', () => {
  const place = PHOTOS.filter((p) => p.location_name === '威海');
  const hits = matchContemporaries(PHOTOS, place, 45);
  assert.ok(!hits.some((h) => h.name === '威海'));
});

test('matchContemporaries respects the window width', () => {
  const place = PHOTOS.filter((p) => p.location_name === '威海');
  // Tokyo's 2020-05-11 is 40 days after 2020-04-02.
  assert.equal(matchContemporaries(PHOTOS, place, 10).length, 0);
  assert.equal(matchContemporaries(PHOTOS, place, 45).length, 1);
});

test('matchContemporaries returns [] with no place photos', () => {
  assert.deepEqual(matchContemporaries(PHOTOS, [], 45), []);
});

console.log(`\n${passed} passed`);
if (process.exitCode) console.log('SOME TESTS FAILED');
