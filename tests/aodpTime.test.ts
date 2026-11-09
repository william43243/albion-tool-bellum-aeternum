import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAodpTimestamp } from '../lib/aodpTime';
import { formatDataAge, getMostRecentPriceDate, isObservedPrice } from '../lib/api';
import { classifyLivePoll } from '../lib/liveTracking';
import { unionLiveTimestamps } from '../lib/liveChart';
import type { PriceData } from '../lib/api';

const price: PriceData = {
  item_id: 'T4_BAG', city: 'Caerleon', quality: 1,
  sell_price_min: 100, sell_price_min_date: '2026-11-05T02:00:00',
  sell_price_max: 100, sell_price_max_date: '2026-11-05T02:30:00Z',
  buy_price_min: 90, buy_price_min_date: '0001-01-01T00:00:00',
  buy_price_max: 95, buy_price_max_date: 'not-a-date',
};

test('AODP no-offset dates mean UTC in UTC, Toronto, and Paris', () => {
  const original = process.env.TZ;
  try {
    for (const timezone of ['UTC', 'America/Toronto', 'Europe/Paris']) {
      process.env.TZ = timezone;
      const utc = Date.parse('2026-11-05T02:00:00Z');
      assert.equal(parseAodpTimestamp('2026-11-05T02:00:00'), utc, timezone);
      assert.equal(parseAodpTimestamp('2026-11-05T02:00:00Z'), utc, timezone);
      assert.equal(parseAodpTimestamp('2026-11-05T03:00:00+01:00'), utc, timezone);
      assert.match(formatDataAge(price.sell_price_min_date, 'fr', utc + 30 * 60_000), /^30min /, timezone);
      assert.equal(getMostRecentPriceDate(price), '2026-11-05T02:30:00Z', timezone);
      assert.deepEqual(unionLiveTimestamps([{ timestamps: ['2026-11-05T02:30:00Z', price.sell_price_min_date] }]), [price.sell_price_min_date, '2026-11-05T02:30:00Z'], timezone);
      assert.equal(classifyLivePoll([price], new Map([['T4_BAG|Caerleon|1', '2026-11-05T02:01:00Z']])).status, 'no-new-data', timezone);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test('AODP fractional seconds and explicit offsets are preserved', () => {
  assert.equal(parseAodpTimestamp('2026-11-05T02:00:00.123'), Date.parse('2026-11-05T02:00:00.123Z'));
  assert.equal(parseAodpTimestamp('2026-11-04T21:00:00-05:00'), Date.parse('2026-11-05T02:00:00Z'));
});

test('invalid or sentinel timestamps never become observed prices', () => {
  for (const timestamp of ['', 'not-a-date', '0001-01-01T00:00:00', '0001-01-01T00:00:00Z']) {
    assert.ok(Number.isNaN(parseAodpTimestamp(timestamp)));
    assert.equal(isObservedPrice(100, timestamp), false);
  }
});
