import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalyticsTransport } from '../lib/analyticsTransport';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const response = (status: number, retryAfter: string | null = null) => ({ status, headers: { get: () => retryAfter } });
const options = { retryDelaysMs: [5, 10], timeoutMs: 15, maxAgeMs: 150 };

test('transport never queues undecided or stale consent; revocation cancels retries', async () => {
  let generation: number | null = null, calls = 0;
  const transport = new AnalyticsTransport(async () => { calls++; throw new Error('offline'); }, token => token !== null && token === generation, options);
  transport.send('/event', '{}', null);
  generation = 1;
  await sleep(25);
  assert.equal(calls, 0);
  transport.send('/event', '{}', 1);
  generation = null;
  transport.clear();
  generation = 2;
  await sleep(35);
  assert.equal(calls, 1);
});

test('network and retryable HTTP failures are retried, success stops and preserves payload', async () => {
  const bodies: string[] = [];
  const transport = new AnalyticsTransport(async (_url, init) => {
    bodies.push(init.body);
    if (bodies.length === 1) throw new Error('offline');
    return response(bodies.length === 2 ? 503 : 204);
  }, token => token === 1, options);
  transport.send('/event', '{"name":"map"}', 1);
  await sleep(65);
  assert.deepEqual(bodies, Array(3).fill('{"name":"map"}'));
});

test('permanent errors and successful responses are never retried', async () => {
  for (const status of [204, 400, 401, 403, 404, 413]) {
    let calls = 0;
    const transport = new AnalyticsTransport(async () => { calls++; return response(status); }, () => true, options);
    transport.send('/event', '{}', 1);
    await sleep(25);
    assert.equal(calls, 1, String(status));
  }
});

test('retry budget and server Retry-After are bounded by event lifetime', async () => {
  let calls = 0;
  const transport = new AnalyticsTransport(async () => { calls++; return response(429); }, () => true, options);
  transport.send('/event', '{}', 1);
  await sleep(65);
  assert.equal(calls, 3);
  let throttled = 0;
  const limited = new AnalyticsTransport(async () => { throttled++; return response(429, '120'); }, () => true, options);
  limited.send('/event', '{}', 1);
  await sleep(30);
  assert.equal(throttled, 1);
});

test('in-flight calls abort on revocation, and a stuck fetch cannot hold the queue forever', async () => {
  let calls = 0, aborted = 0;
  const transport = new AnalyticsTransport(async (_url, init) => {
    calls++; init.signal.addEventListener('abort', () => { aborted++; });
    return new Promise(() => {});
  }, () => true, { ...options, maxPending: 2, maxConcurrent: 1, retryDelaysMs: [] });
  transport.send('/event', '{}', 1);
  transport.send('/event', '{}', 1);
  transport.send('/event', '{}', 1);
  assert.equal(calls, 1);
  await sleep(40);
  assert.equal(calls, 2);
  assert.equal(aborted, 2);
  transport.send('/event', '{}', 1);
  transport.clear();
  await sleep(5);
  assert.equal(aborted, 3);
});

test('consent generation is checked again before retry even without clear', async () => {
  let valid = true, calls = 0;
  const transport = new AnalyticsTransport(async () => { calls++; return response(503); }, () => valid, options);
  transport.send('/event', '{}', 1);
  valid = false;
  await sleep(35);
  assert.equal(calls, 1);
});
