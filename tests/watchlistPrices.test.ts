import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CITIES, fetchCurrentPricesBatch, type PriceData } from '../lib/api';
import { summarizeWatchlistPrices } from '../lib/watchlistPrices';

const item = 'T4_WATCHLIST_COVERAGE_TEST';
const missingDate = '0001-01-01T00:00:00';
const empty = (city: string): PriceData => ({
  item_id: item, city, quality: 1,
  buy_price_min: 0, buy_price_max: 0, sell_price_min: 0, sell_price_max: 0,
  buy_price_min_date: missingDate, buy_price_max_date: missingDate,
  sell_price_min_date: missingDate, sell_price_max_date: missingDate,
});
const observed = (city: string, side: 'buy' | 'sell'): PriceData => side === 'buy'
  ? { ...empty(city), buy_price_max: 123, buy_price_max_date: '2026-11-05T00:35:00' }
  : { ...empty(city), sell_price_min: 234, sell_price_min_date: '2026-11-05T02:20:00' };

test('seven API placeholder rows mean zero cities with data', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(CITIES.map(empty)))) as typeof fetch;
  try {
    const prices = await fetchCurrentPricesBatch([item], [...CITIES], 'americas', 1);
    assert.equal(prices.length, 7, 'reproduces the API Cartesian-product placeholders');
    assert.deepEqual(summarizeWatchlistPrices(prices, item, 1), { hasResponse: true, count: 0 });
  } finally { globalThis.fetch = original; }
});

test('a bid-only or ask-only city counts once with that sides own timestamp', () => {
  const prices = [observed('Martlock', 'buy'), observed('Caerleon', 'sell')];
  assert.deepEqual(summarizeWatchlistPrices(prices, item, 1), { hasResponse: true, count: 2 });
});

test('duplicates and two sides with distinct dates still count one city', () => {
  const price = { ...observed('Martlock', 'buy'), sell_price_min: 234, sell_price_min_date: '2026-11-05T02:20:00' };
  assert.deepEqual(summarizeWatchlistPrices([price, price, observed('Martlock', 'sell')], item, 1), { hasResponse: true, count: 1 });
});

test('a valid timestamp on the opposite empty side cannot rescue an invalid observation', () => {
  const price = { ...empty('Martlock'), buy_price_max: 123, sell_price_min_date: '2026-11-05T02:20:00' };
  assert.equal(summarizeWatchlistPrices([price], item, 1).count, 0);
});

test('positive prices with sentinel, empty or invalid dates do not count', () => {
  for (const date of [missingDate, '', 'not-a-date']) {
    const price = { ...empty('Martlock'), buy_price_max: 123, sell_price_min: 234, buy_price_max_date: date, sell_price_min_date: date };
    assert.equal(summarizeWatchlistPrices([price], item, 1).count, 0);
  }
});

test('zero, negative and non-finite prices never count despite valid dates', () => {
  for (const value of [0, -1, Infinity, NaN]) {
    const price = { ...observed('Martlock', 'buy'), buy_price_max: value };
    assert.equal(summarizeWatchlistPrices([price], item, 1).count, 0);
  }
});

test('coverage does not invent a freshness cutoff or require synchronous sides', () => {
  const price = { ...observed('Martlock', 'buy'), buy_price_max_date: '2025-01-01T00:00:00' };
  assert.equal(summarizeWatchlistPrices([price], item, 1).count, 1);
});

test('other items, qualities and unsupported cities cannot inflate the count', () => {
  const prices = [observed('Martlock', 'sell'),
    { ...observed('Caerleon', 'sell'), item_id: 'T4_OTHER' },
    { ...observed('Thetford', 'buy'), quality: 5 }, observed('Unknown', 'buy')];
  assert.deepEqual(summarizeWatchlistPrices(prices, item, 1), { hasResponse: true, count: 1 });
});

test('missing responses stay distinguishable from a response with zero observed cities', () => {
  assert.deepEqual(summarizeWatchlistPrices([], item, 1), { hasResponse: false, count: 0 });
});

test('the watchlist renders coverage rather than raw response length', () => {
  const source = readFileSync('screens/MarketplaceScreen.tsx', 'utf8');
  assert.match(source, /summarizeWatchlistPrices\(watchResults, entry\.itemId, entry\.quality\)/);
  assert.match(source, /hasResponse \? `\$\{count\} \$\{cityCountLabel\}`/);
  assert.match(source, /cities with data/);
});
