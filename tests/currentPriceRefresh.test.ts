import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchCurrentPrices, type PriceData } from '../lib/api';

function quote(item: string, value: number): PriceData {
  return {
    item_id: item, city: 'Martlock', quality: 1,
    sell_price_min: value, sell_price_max: value,
    buy_price_min: value - 1, buy_price_max: value - 1,
    sell_price_min_date: '2026-11-05T02:20:00', sell_price_max_date: '2026-11-05T02:20:00',
    buy_price_min_date: '2026-11-05T00:35:00', buy_price_max_date: '2026-11-05T00:35:00',
  };
}

test('explicit refresh bypasses app/HTTP cache, then updates the ordinary cached result', async () => {
  const original = globalThis.fetch;
  const item = 'T4_REFRESH_CACHE_TEST';
  const requests: (RequestInit | undefined)[] = [];
  globalThis.fetch = (async (_url, options) => {
    requests.push(options);
    return new Response(JSON.stringify([quote(item, 100 + requests.length)]));
  }) as typeof fetch;
  try {
    assert.equal((await fetchCurrentPrices(item, ['Martlock']))[0].sell_price_min, 101);
    assert.equal((await fetchCurrentPrices(item, ['Martlock']))[0].sell_price_min, 101);
    assert.equal(requests.length, 1);
    const refreshed = await fetchCurrentPrices(item, ['Martlock'], 'americas', 1, { forceRefresh: true });
    assert.equal(requests.length, 2);
    assert.equal(requests[1]?.cache, 'no-store');
    assert.equal(refreshed[0].sell_price_min, 102);
    // A new HTTP response must not invent a newer market observation date.
    assert.equal(refreshed[0].sell_price_min_date, '2026-11-05T02:20:00');
    assert.equal(refreshed[0].buy_price_max_date, '2026-11-05T00:35:00');
    assert.equal((await fetchCurrentPrices(item, ['Martlock']))[0].sell_price_min, 102);
    assert.equal(requests.length, 2);
  } finally { globalThis.fetch = original; }
});

test('a failed refresh rejects instead of disguising stale cached prices as fresh', async () => {
  const original = globalThis.fetch;
  const item = 'T4_REFRESH_FAILURE_TEST';
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 2 ? new Response('', { status: 503 }) : new Response(JSON.stringify([quote(item, calls)]));
  }) as typeof fetch;
  try {
    await fetchCurrentPrices(item, ['Martlock']);
    await assert.rejects(fetchCurrentPrices(item, ['Martlock'], 'americas', 1, { forceRefresh: true }), /503/);
    assert.equal(calls, 2, 'no automatic retries');
    assert.equal((await fetchCurrentPrices(item, ['Martlock']))[0].sell_price_min, 1);
    assert.equal((await fetchCurrentPrices(item, ['Martlock'], 'americas', 1, { forceRefresh: true }))[0].sell_price_min, 3);
  } finally { globalThis.fetch = original; }
});

test('simultaneous ordinary/refresh calls share one cache-bypassing network request', async () => {
  const original = globalThis.fetch;
  const item = 'T4_REFRESH_CONCURRENT_TEST';
  let calls = 0;
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>((res) => { resolve = res; });
  globalThis.fetch = (async (_url, options) => {
    assert.equal(options?.cache, 'no-store');
    calls += 1; return pending;
  }) as typeof fetch;
  try {
    const first = fetchCurrentPrices(item, ['Martlock'], 'americas', 1);
    const second = fetchCurrentPrices(item, ['Martlock'], 'americas', 1, { forceRefresh: true });
    const third = fetchCurrentPrices(item, ['Martlock'], 'americas', 1, { forceRefresh: true });
    assert.equal(calls, 1);
    resolve(new Response(JSON.stringify([quote(item, 123)])));
    assert.deepEqual(await first, await second);
    assert.deepEqual(await second, await third);
  } finally { globalThis.fetch = original; }
});

test('refresh preserves item, city, quality and server selection', async () => {
  const original = globalThis.fetch;
  const item = 'T4_REFRESH_FILTER_TEST';
  let url = '';
  globalThis.fetch = (async (input) => {
    url = String(input);
    return new Response(JSON.stringify([
      quote(item, 100),
      { ...quote(item, 200), quality: 5 },
      { ...quote(item, 300), city: 'Caerleon' },
      quote('T4_OTHER_ITEM', 400),
    ]));
  }) as typeof fetch;
  try {
    const result = await fetchCurrentPrices(item, ['Martlock'], 'europe', 5, { forceRefresh: true });
    assert.match(url, /^https:\/\/europe\.albion-online-data\.com\/.*locations=Martlock&qualities=5$/);
    assert.equal(result.length, 1);
    assert.equal(result[0].sell_price_min, 200);
  } finally { globalThis.fetch = original; }
});

for (const header of ['RateLimit-Reset', 'Retry-After', 'missing'] as const) {
  test(`429 respects ${header} and blocks repeated refreshes without an automatic retry`, async () => {
    const originalFetch = globalThis.fetch;
    const originalNow = Date.now;
    const start = 2_000_000_000_000;
    let now = start;
    Date.now = () => now;
    let calls = 0;
    const seconds = header === 'missing' ? 300 : 60;
    const headers: Record<string, string> = {};
    if (header === 'RateLimit-Reset') headers[header] = String(start / 1000 + seconds);
    if (header === 'Retry-After') headers[header] = String(seconds);
    globalThis.fetch = (async () => {
      calls += 1;
      return calls === 1 ? new Response('', { status: 429, headers }) : new Response('[]');
    }) as typeof fetch;
    try {
      await assert.rejects(fetchCurrentPrices(`T4_LIMIT_${header}`, ['Martlock'], 'asia', 1, { forceRefresh: true }), /429/);
      await assert.rejects(fetchCurrentPrices('T4_DIFFERENT_QUERY', ['Caerleon'], 'asia', 5, { forceRefresh: true }), /429/);
      assert.equal(calls, 1);
      assert.deepEqual(await fetchCurrentPrices('T4_OTHER_SERVER', ['Martlock'], 'europe', 1, { forceRefresh: true }), []);
      assert.equal(calls, 2, 'a different game server is not blocked');
      now = start + seconds * 1000 - 1;
      await assert.rejects(fetchCurrentPrices('T4_DIFFERENT_QUERY', ['Caerleon'], 'asia', 5, { forceRefresh: true }), /429/);
      assert.equal(calls, 2);
      now += 1;
      assert.deepEqual(await fetchCurrentPrices('T4_DIFFERENT_QUERY', ['Caerleon'], 'asia', 5, { forceRefresh: true }), []);
      assert.equal(calls, 3);
    } finally {
      globalThis.fetch = originalFetch;
      Date.now = originalNow;
    }
  });
}
