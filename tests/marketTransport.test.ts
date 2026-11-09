import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { configureMarketTransport, marketFetch, type NativeMarketTransport } from '../lib/marketTransport';

after(() => configureMarketTransport(false));

test('native market responses retain status and rate limit headers', async () => {
  configureMarketTransport(true, { request: async () => ({ status: 429, body: '', retryAfter: '120', rateLimitReset: null }), cancel() {} });
  const result = await marketFetch('https://example.test');
  assert.equal(result.ok, false);
  assert.equal(result.status, 429);
  assert.equal(result.headers.get('Retry-After'), '120');
});

test('native market success decodes returned JSON', async () => {
  configureMarketTransport(true, { request: async () => ({ status: 200, body: '[{"city":"Martlock"}]', retryAfter: null, rateLimitReset: null }), cancel() {} });
  assert.deepEqual(await (await marketFetch('https://example.test')).json(), [{ city: 'Martlock' }]);
});

test('Android fails closed if native market transport is missing', async () => {
  configureMarketTransport(true, null);
  await assert.rejects(marketFetch('https://example.test'), /transport unavailable/);
});

test('abort cancels the native request and returns AbortError', async () => {
  let cancelled = '';
  let rejectRequest!: (error: Error) => void;
  const transport: NativeMarketTransport = {
    request: () => new Promise((_resolve, reject) => { rejectRequest = reject; }),
    cancel: id => { cancelled = id; rejectRequest(new Error('cancelled')); },
  };
  configureMarketTransport(true, transport);
  const controller = new AbortController();
  const result = marketFetch('https://example.test', { signal: controller.signal });
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
  assert.match(cancelled, /^market-/);
});
