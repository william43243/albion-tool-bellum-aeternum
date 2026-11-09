import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fetchCurrentPricesLiveBatch, CITIES, MAX_AODP_URL_LENGTH, SERVERS } from '../lib/api';

test('live batch rejects an empty item or city batch before network access', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; throw new Error('unexpected network'); }) as typeof fetch;
  try {
    await assert.rejects(fetchCurrentPricesLiveBatch([], ['Caerleon']), /at least one item/);
    await assert.rejects(fetchCurrentPricesLiveBatch(['T4_BAG'], []), /at least one item and city/);
    assert.equal(called, false);
  } finally { globalThis.fetch = original; }
});

test('live batch builds filtered URL and ignores other items, cities and qualities', async () => {
  const original = globalThis.fetch;
  let url = '';
  globalThis.fetch = (async (input) => {
    url = String(input);
    return new Response(JSON.stringify([
      { item_id: 'T4_BAG', city: 'Caerleon', quality: 2, sell_price_min: 10 },
      { item_id: 'T4_BAG', city: 'Caerleon', quality: 1, sell_price_min: 20 },
      { item_id: 'T5_BAG', city: 'Caerleon', quality: 1, sell_price_min: 30 },
      { item_id: 'T4_BAG', city: 'Bridgewatch', quality: 1, sell_price_min: 40 },
    ]));
  }) as typeof fetch;
  try {
    const result = await fetchCurrentPricesLiveBatch(['T4_BAG'], ['Caerleon'], 'americas', 1);
    assert.match(url, /\/prices\/T4_BAG\.json\?locations=Caerleon&qualities=1/);
    assert.deepEqual(result.map((row) => [row.item_id, row.city, row.quality]), [['T4_BAG', 'Caerleon', 1]]);
  } finally { globalThis.fetch = original; }
});

test('live batch makes two fresh network requests instead of using the regular cache', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify([{ item_id: 'T4_BAG', city: 'Caerleon', quality: 1, sell_price_min: calls }])) }) as typeof fetch;
  try {
    await fetchCurrentPricesLiveBatch(['T4_BAG'], ['Caerleon'], 'americas', 1);
    await fetchCurrentPricesLiveBatch(['T4_BAG'], ['Caerleon'], 'americas', 1);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('an already cancelled live batch never starts a network request', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response('[]'); }) as typeof fetch;
  const abort = new AbortController(); abort.abort();
  try {
    await assert.rejects(fetchCurrentPricesLiveBatch(['T4_BAG'], ['Caerleon'], 'americas', 1, { signal: abort.signal }), { name: 'AbortError' });
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('cancellation during response parsing prevents every remaining batch chunk', async () => {
  const original = globalThis.fetch;
  const abort = new AbortController();
  let calls = 0;
  let finishBody!: (rows: unknown[]) => void;
  const ids = ['A'.repeat(2200), 'B'.repeat(2200)];
  globalThis.fetch = (async (_url, options) => {
    calls++;
    assert.equal(options?.signal, abort.signal);
    assert.equal(options?.cache, 'no-store');
    return { ok: true, json: () => new Promise((resolve) => { finishBody = resolve; }) } as Response;
  }) as typeof fetch;
  try {
    const pending = fetchCurrentPricesLiveBatch(ids, ['Caerleon'], 'americas', 1, { signal: abort.signal });
    await new Promise<void>((resolve) => setImmediate(resolve));
    abort.abort(); finishBody([]);
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('a live batch rate-limit refusal stops later chunks instead of retrying', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => new Response('[]', { status: ++calls === 2 ? 429 : 200 })) as typeof fetch;
  try {
    await assert.rejects(fetchCurrentPricesLiveBatch(['A'.repeat(2200), 'B'.repeat(2200), 'C'.repeat(2200)], ['Caerleon']), /429/);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('History passes the controller cancellation signal to the native Live API path', () => {
  const screen = readFileSync('screens/HistoryScreen.tsx', 'utf8');
  assert.match(screen, /fetchPrices: \(config, signal\) => fetchCurrentPricesLiveBatch\(config\.itemIds, config\.cities, config\.server, config\.quality, \{ signal \}\)/);
});

test('real React Native cache-busting keeps every large catalog chunk within the AODP URL limit', async () => {
  const NativeRequest = createRequire(resolve('package.json'))('whatwg-fetch').Request as new (url: string, options?: RequestInit) => { url: string };
  const ids = (JSON.parse(readFileSync('assets/items-db.json', 'utf8')) as { id: string }[]).slice(0, 1000).map((item) => item.id);
  const original = globalThis.fetch;
  const sent: string[] = [];
  let calls = 0;
  globalThis.fetch = (async (input, options) => {
    const actualUrl = new NativeRequest(String(input), options).url;
    assert.ok(actualUrl.length <= MAX_AODP_URL_LENGTH, `native URL length ${actualUrl.length}`);
    const parsed = new URL(actualUrl);
    assert.ok(parsed.searchParams.has('_'), 'exercise the actual native cache-buster');
    assert.equal(options?.cache, 'no-store', 'keep live freshness instead of dropping the option');
    const encodedIds = parsed.pathname.match(/\/prices\/(.*)\.json$/)![1];
    sent.push(...decodeURIComponent(encodedIds).split(','));
    calls++;
    return new Response('[]');
  }) as typeof fetch;
  try {
    await fetchCurrentPricesLiveBatch(ids, [...CITIES]);
    assert.ok(calls > 1);
    assert.deepEqual(sent, [...new Set(ids)], 'chunking must not omit or duplicate any requested item');
  } finally { globalThis.fetch = original; }
});

test('a single item that cannot fit after native cache-busting is refused before network access', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response('[]'); }) as typeof fetch;
  const prefix = `${SERVERS.americas}/prices/.json?locations=Caerleon&qualities=1`;
  const nearLimitItem = 'A'.repeat(MAX_AODP_URL_LENGTH - prefix.length - 10);
  try {
    await assert.rejects(fetchCurrentPricesLiveBatch([nearLimitItem], ['Caerleon']), /exceeds 4096/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});
