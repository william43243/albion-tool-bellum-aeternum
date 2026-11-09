import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { alignHistoryByTimestamp, historyActivity, weightedAverage } from '../lib/aodpTime';
import { formatDataAge } from '../lib/api';
import { parseUserNumber } from '../lib/numberParsing';

test('parses French grouped amounts and decimal commas without magnitude loss', () => {
  assert.deepEqual(parseUserNumber('1 500 000', false, 'fr'), { value: 1500000, valid: true, ambiguous: false });
  assert.deepEqual(parseUserNumber('1.500.000', false, 'fr'), { value: 1500000, valid: true, ambiguous: false });
  assert.deepEqual(parseUserNumber('1,5', false, 'fr'), { value: 1.5, valid: true, ambiguous: false });
});

test('uses locale semantics instead of guessing separator meaning', () => {
  assert.equal(parseUserNumber('1.500', false, 'fr').value, 1500);
  assert.equal(parseUserNumber('1.500', false, 'en').value, 1.5);
  assert.equal(parseUserNumber('1,500', false, 'fr').value, 1.5);
  assert.equal(parseUserNumber('1,500', false, 'en').value, 1500);
});

test('rejects malformed grouping and fractional integers', () => {
  assert.deepEqual(parseUserNumber('12.34.567', false, 'fr'), { value: 0, valid: false, ambiguous: true });
  assert.deepEqual(parseUserNumber('12,5', true, 'fr'), { value: 0, valid: false, ambiguous: true });
  assert.equal(parseUserNumber('9007199254740992', true, 'fr').valid, false);
});

test('aligns sparse history by timestamp without zeros or repeated values', () => {
  const a = { item_id: 'T4', location: 'Caerleon', quality: 1, data: [{ timestamp: '2026-01-01T00:00:00Z', avg_price: 10, item_count: 2 }, { timestamp: '2026-01-03T00:00:00Z', avg_price: 30, item_count: 1 }] };
  const b = { item_id: 'T4', location: 'Martlock', quality: 1, data: [{ timestamp: '2026-01-02T00:00:00Z', avg_price: 20, item_count: 1 }] };
  const aligned = alignHistoryByTimestamp([a, b]);
  assert.deepEqual(aligned.timestamps, ['2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z']);
  assert.deepEqual(aligned.series['T4:Caerleon:q1'], [10, null, 30]);
  assert.equal(weightedAverage(a.data), (10 * 2 + 30) / 3);
  assert.equal(historyActivity({ ...a, data: [] }).status, 'unknown');
});

test('formats changing data age with a local display independently of the host timezone', () => {
  const timestamp = '2026-09-09T00:00:00Z';
  const dayAfter = Date.parse('2026-09-10T00:00:00Z');
  const twoDaysAfter = Date.parse('2026-09-11T00:00:00Z');
  const originalTimezone = process.env.TZ;
  try {
    // The input instant and elapsed age are UTC-based. The parenthesized date
    // intentionally uses the device's local date/time, including date rollover.
    for (const [timezone, localDisplay] of [
      ['UTC', '9/9 00:00'],
      ['America/Los_Angeles', '8/9 17:00'],
      ['America/Toronto', '8/9 20:00'],
      ['Europe/Paris', '9/9 02:00'],
      ['Asia/Kolkata', '9/9 05:30'],
    ]) {
      process.env.TZ = timezone;
      assert.equal(formatDataAge(timestamp, 'fr', dayAfter), `1d (${localDisplay})`, timezone);
      assert.equal(formatDataAge(timestamp, 'fr', twoDaysAfter), `2d (${localDisplay})`, timezone);
      assert.equal(formatDataAge('2026-09-09T00:00:00', 'fr', dayAfter), `1d (${localDisplay})`, `${timezone}: AODP offset omitted`);
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('data age uses elapsed time across daylight-saving jumps and repeated local hours', () => {
  const originalTimezone = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    // Spring: 01:30 PST to 03:30 PDT is one elapsed hour, not two.
    assert.equal(formatDataAge('2026-03-08T09:30:00Z', 'fr', Date.parse('2026-03-08T10:30:00Z')), '1h (8/3 01:30)');
    assert.equal(formatDataAge('2026-03-08T09:30:00Z', 'fr', Date.parse('2026-03-09T09:30:00Z')), '1d (8/3 01:30)');
    // Fall: 01:30 PDT to the repeated 01:30 PST is still one elapsed hour.
    assert.equal(formatDataAge('2026-11-01T08:30:00Z', 'fr', Date.parse('2026-11-01T09:30:00Z')), '1h (1/11 01:30)');
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('calculation screens never bypass localized parsing or integer quantities', () => {
  const crafting = readFileSync('screens/CraftingScreen.tsx', 'utf8');
  const flipping = readFileSync('screens/FlippingScreen.tsx', 'utf8');
  const marketplace = readFileSync('screens/MarketplaceScreen.tsx', 'utf8');
  for (const source of [crafting, flipping, marketplace]) {
    assert.doesNotMatch(source, /parseFloat\(|parseInt\(/);
    assert.match(source, /parseUserNumber\(/);
    assert.match(source, /integer/);
  }
});
