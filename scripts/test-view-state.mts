// Unit tests for the URL hash view-state helpers.
//
//   node --experimental-strip-types scripts/test-view-state.mts
//
// The view-state code decides what ends up in the shareable URL, so
// a bug here means a shared link opens the wrong moment. These
// tests pin the parsing / building / edge cases.

import assert from 'node:assert/strict';
import {
  buildHash,
  EMPTY_VIEW_STATE,
  fromDateKey,
  parseHash,
  sameViewState,
  toDateKey,
} from '../lib/view-state.ts';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}`);
    console.error(`       ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('view-state unit tests\n');

test('toDateKey formats a local date', () => {
  assert.equal(toDateKey(new Date(2022, 8, 29)), '2022-09-29');
  assert.equal(toDateKey(new Date(1990, 10, 1)), '1990-11-01');
  assert.equal(toDateKey(new Date(2026, 0, 5)), '2026-01-05');
});

test('fromDateKey round-trips toDateKey', () => {
  for (const key of ['2022-09-29', '1990-11-01', '2026-01-05']) {
    const d = fromDateKey(key);
    assert.ok(d, `${key} should parse`);
    assert.equal(toDateKey(d), key);
  }
});

test('fromDateKey rejects malformed input instead of throwing', () => {
  for (const bad of [null, '', 'not-a-date', '2022-13-01', '2022/09/29', '20220929']) {
    assert.equal(fromDateKey(bad), null, `${bad} should be null`);
  }
});

test('parseHash reads at and q', () => {
  const s = parseHash('#at=2022-09-29&q=%E5%A8%81%E6%B5%B7');
  assert.equal(s.at, '2022-09-29');
  assert.equal(s.q, '威海');
});

test('parseHash handles a missing leading #', () => {
  assert.equal(parseHash('at=2022-09-29').at, '2022-09-29');
});

test('parseHash returns the empty state for junk', () => {
  assert.deepEqual(parseHash(''), EMPTY_VIEW_STATE);
  assert.deepEqual(parseHash('#'), EMPTY_VIEW_STATE);
  assert.deepEqual(parseHash('#garbage'), EMPTY_VIEW_STATE);
  assert.deepEqual(parseHash('#=&=&='), EMPTY_VIEW_STATE);
});

test('parseHash ignores unknown keys and invalid dates', () => {
  const s = parseHash('#at=not-a-date&foo=bar&q=ok');
  assert.equal(s.at, null);
  assert.equal(s.q, 'ok');
});

test('parseHash decodes + as space and %20 alike', () => {
  assert.equal(parseHash('#q=a+b').q, 'a b');
  assert.equal(parseHash('#q=a%20b').q, 'a b');
});

test('parseHash handles CJK and emoji queries', () => {
  assert.equal(parseHash('#q=%F0%9F%8C%8D%20%E5%A8%81%E6%B5%B7').q, '🌍 威海');
});

test('buildHash writes at and q, and nothing else', () => {
  assert.equal(buildHash({ at: '2022-09-29', q: '威海' }), 'at=2022-09-29&q=%E5%A8%81%E6%B5%B7');
  assert.equal(buildHash(EMPTY_VIEW_STATE), '');
  assert.equal(buildHash({ at: null, q: null }), '');
});

test('buildHash drops an empty query but keeps a date', () => {
  assert.equal(buildHash({ at: '2022-09-29', q: '   ' }), 'at=2022-09-29');
});

test('buildHash round-trips through parseHash', () => {
  const state = { at: '2020-01-02', q: 'a&b=c 东京' };
  assert.deepEqual(parseHash('#' + buildHash(state)), state);
});

test('sameViewState compares by value', () => {
  assert.ok(sameViewState({ at: '2020-01-01', q: 'x' }, { at: '2020-01-01', q: 'x' }));
  assert.ok(!sameViewState({ at: '2020-01-01', q: 'x' }, { at: '2020-01-02', q: 'x' }));
  assert.ok(!sameViewState({ at: '2020-01-01', q: 'x' }, { at: '2020-01-01', q: 'y' }));
});

console.log(`\n${passed} passed`);
if (process.exitCode) console.log('SOME TESTS FAILED');
