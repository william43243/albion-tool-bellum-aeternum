import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveTrackingController, callsPerMinute, LIVE_RETENTION_MAX_POINTS_PER_SERIES, LIVE_REQUEST_TIMEOUT_MS, type LiveConfig } from '../lib/liveTrackingController';
import { fetchCurrentPricesLiveBatch } from '../lib/api';
import { createLiveChartProjection, projectLiveChartPoint, unionLiveTimestamps } from '../lib/liveChart';
import type { PriceData } from '../lib/api';

const price = (timestamp = '2026-09-10T12:00:00Z'): PriceData => ({ item_id: 'T4_BAG', city: 'Caerleon', quality: 1, sell_price_min: 100, sell_price_min_date: timestamp, sell_price_max: 100, sell_price_max_date: timestamp, buy_price_min: 90, buy_price_min_date: timestamp, buy_price_max: 90, buy_price_max_date: timestamp });
const config: LiveConfig = { itemIds: ['T4_BAG'], cities: ['Caerleon'], server: 'americas', quality: 1 };
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function fakeClock() {
  let time = 0;
  let id = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    setTimeout: ((callback: () => void, delay = 0) => {
      const next = ++id;
      timers.set(next, { at: time + delay, callback });
      return next;
    }) as unknown as typeof setTimeout,
    clearTimeout: ((key: number) => { timers.delete(key); }) as unknown as typeof clearTimeout,
    now: () => time,
    get delays() { return [...timers.values()].map((timer) => timer.at - time).sort((a, b) => a - b); },
    async next() {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      assert.ok(next, 'expected a scheduled timer');
      timers.delete(next[0]);
      time = next[1].at;
      next[1].callback();
      await flush();
    },
  };
}

test('supports 5s, 1m and 5m cadences and defaults to 1m', () => {
  assert.equal(callsPerMinute('5s'), 12); assert.equal(callsPerMinute('1m'), 1); assert.equal(callsPerMinute('5m'), 0.2);
  const controller = createLiveTrackingController({ fetchPrices: async () => [], setTimeout: (() => 0) as unknown as typeof setTimeout, clearTimeout: () => undefined });
  controller.start(config); assert.equal(controller.getConfig()?.cadence, undefined);
});

test('cancels a stopped request before polling the restarted generation and ignores its late result', async () => {
  let resolveFirst!: (value: PriceData[]) => void;
  let calls = 0;
  const first = new Promise<PriceData[]>((resolve) => { resolveFirst = resolve; });
  const controller = createLiveTrackingController({ fetchPrices: async () => { calls++; if (calls === 1) return first; return [price()]; } });
  controller.start(config); controller.stop(); controller.start({ ...config, cadence: '5s' });
  assert.equal(calls, 1);
  resolveFirst([]); await flush(); await flush();
  assert.equal(calls, 2);
  controller.stop();
});

test('429 suspends without any automatic timer and resume starts exactly one fresh request', async () => {
  let calls = 0; const states: string[] = []; const clock = fakeClock();
  const controller = createLiveTrackingController({ fetchPrices: async () => { calls++; if (calls === 1) throw new Error('API error: 429'); return [price()]; }, onUpdate: (s) => states.push(s.state), ...clock });
  controller.start(config); await controller.pollNow();
  assert.equal(calls, 1); assert.equal(controller.getSnapshot().state, 'suspended'); assert.equal(clock.delays.length, 0); assert.equal(controller.getSnapshot().nextRetryAt, undefined);
  controller.resume(); await controller.pollNow();
  assert.equal(calls, 2); assert.equal(controller.getSnapshot().state, 'running'); assert.ok(states.includes('suspended'));
  controller.stop();
});

test('timeout and 5xx retry, while identical timestamps are not new data', async () => {
  let calls = 0; const clock = fakeClock();
  const controller = createLiveTrackingController({
    fetchPrices: async () => { calls++; if (calls === 1) throw new Error('timeout'); if (calls === 2) throw new Error('API error: 503'); return [price()]; },
    ...clock,
  });
  controller.start(config);
  await flush();
  assert.deepEqual(clock.delays, [1000]);
  await clock.next();
  assert.deepEqual(clock.delays, [2000]);
  await clock.next();
  assert.equal(calls, 3); assert.equal(controller.getSnapshot().status, 'new-data');
  await flush();
  await controller.pollNow();
  assert.equal(controller.getSnapshot().status, 'no-new-data');
  controller.stop();
});

test('unchanged polls aggregate one dashed segment per series from its latest point', async () => {
  const responses = [[price('2026-09-10T12:00:00Z'), price('2026-09-10T12:01:00Z')], [price('2026-09-10T12:02:00Z')], [price('2026-09-10T12:02:00Z')], [price('2026-09-10T12:02:00Z')]];
  const controller = createLiveTrackingController({ fetchPrices: async () => responses.shift() ?? [], now: () => Date.parse('2026-09-10T12:03:00Z') });
  controller.start({ ...config, cadence: '5m' });
  await flush();
  await controller.pollNow();
  await controller.pollNow();
  await controller.pollNow();
  const segments = controller.getSnapshot().dashedSegments;
  assert.equal(segments.length, 1);
  assert.equal(segments[0].from.timestamp, '2026-09-10T12:02:00Z');
  assert.ok(Date.parse(segments[0].to.timestamp) > Date.parse(segments[0].from.timestamp));
  const projectionTimestamps = unionLiveTimestamps([{ timestamps: [segments[0].from.timestamp, segments[0].to.timestamp] }]);
  const projection = createLiveChartProjection(projectionTimestamps, [segments[0].from.value, segments[0].to.value], 400);
  assert.ok(projectLiveChartPoint(segments[0].to.timestamp, segments[0].to.value, projection).x > projectLiveChartPoint(segments[0].from.timestamp, segments[0].from.value, projection).x);
  assert.equal(segments[0].polls, 2);
  controller.stop();
});

test('partial live response marks an omitted series no-data and never draws its dashed continuation', async () => {
  const responses = [[price('2026-09-10T12:00:00Z'), { ...price('2026-09-10T12:00:00Z'), city: 'Bridgewatch' as const }], [price('2026-09-10T12:01:00Z')]];
  const controller = createLiveTrackingController({ fetchPrices: async () => responses.shift() ?? [], now: () => Date.parse('2026-09-10T12:02:00Z') });
  controller.start({ ...config, cities: ['Caerleon', 'Bridgewatch'] });
  await flush();
  await controller.pollNow();
  const snapshot = controller.getSnapshot();
  assert.deepEqual(snapshot.noDataSeries, ['T4_BAG|Bridgewatch|1']);
  assert.equal(snapshot.dashedSegments.some((segment) => segment.key === 'T4_BAG|Bridgewatch|1'), false);
  assert.equal(snapshot.seriesCount, 2);
  controller.stop();
});

test('100 unchanged polls keep one bounded dashed segment and preserve poll count', async () => {
  const controller = createLiveTrackingController({ fetchPrices: async () => [price('2026-09-10T12:00:00Z')], now: () => Date.parse('2026-09-10T13:40:00Z') });
  controller.start(config);
  await flush();
  for (let index = 0; index < 100; index += 1) await controller.pollNow();
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.pollCount, 101);
  assert.equal(snapshot.seriesCount, 1);
  assert.equal(snapshot.dashedSegments.length, 1);
  assert.equal(snapshot.dashedSegments[0].polls, 100);
  controller.stop();
});

test('1000 distinct polls retain a bounded history, the latest point, and the dashed segment', async () => {
  let calls = 0;
  let latestTimestamp = '';
  const controller = createLiveTrackingController({
    fetchPrices: async () => {
      calls += 1;
      if (calls <= 1000) latestTimestamp = new Date(Date.parse('2026-09-10T12:00:00Z') + (calls - 1) * 1_000).toISOString();
      return [price(latestTimestamp)];
    },
    now: () => Date.parse('2026-09-10T13:00:00Z'),
    setTimeout: (() => 0) as unknown as typeof setTimeout,
    clearTimeout: () => undefined,
  });
  controller.start(config);
  await flush();
  for (let index = 1; index < 1000; index += 1) await controller.pollNow();
  const beforeUnchanged = controller.getSnapshot();
  assert.equal(calls, 1000);
  assert.equal(beforeUnchanged.points.length, LIVE_RETENTION_MAX_POINTS_PER_SERIES);
  assert.equal(beforeUnchanged.points.at(-1)?.timestamp, latestTimestamp);
  assert.equal(new Set(beforeUnchanged.points.map((point) => point.timestamp)).size, beforeUnchanged.points.length);

  await controller.pollNow();
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.pollCount, 1001);
  assert.equal(snapshot.points.at(-1)?.timestamp, latestTimestamp);
  assert.equal(snapshot.dashedSegments.length, 1);
  assert.equal(snapshot.dashedSegments[0].from.timestamp, latestTimestamp);
  assert.equal(snapshot.dashedSegments[0].polls, 1);
  controller.stop();
});

test('stopping during network backoff cancels the backoff and allows a restart', async () => {
  let calls = 0; const clock = fakeClock();
  const controller = createLiveTrackingController({
    fetchPrices: async () => { calls++; throw new Error('network timeout'); },
    ...clock,
  });
  controller.start(config); await flush();
  assert.equal(calls, 1); assert.deepEqual(clock.delays, [1000]);
  controller.stop();
  assert.deepEqual(clock.delays, []);
  controller.start({ ...config, cadence: '5m' });
  await flush();
  assert.equal(calls, 2);
  controller.stop();
});

test('Stop cancels a forever-pending native request before a new item and server start', async () => {
  const clock = fakeClock();
  const calls: LiveConfig[] = [];
  const signals: AbortSignal[] = [];
  let resolveOld!: (rows: PriceData[]) => void;
  let active = 0;
  let maximumActive = 0;
  const controller = createLiveTrackingController({ ...clock,
    fetchPrices: (next, signal) => {
      calls.push(next); signals.push(signal);
      maximumActive = Math.max(maximumActive, ++active);
      if (calls.length === 1) {
        signal.addEventListener('abort', () => { active--; }, { once: true });
        // Deliberately never settle on abort: the controller must still release.
        return new Promise((resolve) => { resolveOld = resolve; });
      }
      active--;
      return Promise.resolve([{ ...price(), item_id: next.itemIds[0] }]);
    },
  });
  controller.start(config);
  const oldCompletion = controller.pollNow();
  controller.stop();
  assert.equal(signals[0].aborted, true);
  controller.start({ ...config, server: 'europe', itemIds: ['T5_BAG'] });
  await oldCompletion; await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].server, 'europe');
  assert.deepEqual(calls[1].itemIds, ['T5_BAG']);
  assert.equal(maximumActive, 1);
  resolveOld([price()]); await flush();
  assert.equal(controller.getSnapshot().pollCount, 1);
  assert.deepEqual(controller.getSnapshot().points.map((point) => point.itemId), ['T5_BAG']);
  controller.stop();
  assert.deepEqual(clock.delays, []);
});

test('repeated start and pollNow calls coalesce behind cancellation into the latest configuration', async () => {
  const clock = fakeClock();
  const items: string[] = [];
  const controller = createLiveTrackingController({ ...clock,
    fetchPrices: (next) => {
      items.push(next.itemIds[0]);
      return items.length === 1 ? new Promise(() => {}) : Promise.resolve([]);
    },
  });
  controller.start(config);
  void controller.pollNow(); void controller.pollNow();
  controller.start({ ...config, itemIds: ['T5_BAG'] });
  controller.start({ ...config, itemIds: ['T6_BAG'] });
  await flush();
  assert.deepEqual(items, ['T4_BAG', 'T6_BAG']);
  controller.stop();
});

test('a hung attempt times out, aborts native work and releases inFlight with no unbounded retry', async () => {
  const clock = fakeClock();
  let signal!: AbortSignal;
  let rejectOld!: (error: Error) => void;
  let calls = 0;
  const controller = createLiveTrackingController({ ...clock, maxRetries: 0,
    fetchPrices: (_next, currentSignal) => {
      calls++; signal = currentSignal;
      return new Promise((_resolve, reject) => { rejectOld = reject; });
    },
  });
  controller.start(config);
  assert.deepEqual(clock.delays, [LIVE_REQUEST_TIMEOUT_MS]);
  await clock.next();
  assert.equal(signal.aborted, true);
  assert.equal(controller.inFlight, false);
  assert.equal(controller.getSnapshot().state, 'error');
  assert.equal(controller.getSnapshot().error?.name, 'TimeoutError');
  assert.deepEqual(clock.delays, []);
  await controller.pollNow();
  assert.equal(calls, 1, 'manual pollNow cannot revive an errored request loop');
  rejectOld(new Error('API error: 429')); await flush();
  assert.equal(controller.getSnapshot().state, 'error', 'late rejection cannot overwrite the timeout state');
  controller.stop();
});

test('hung requests use the existing finite retry budget and exponential backoff', async () => {
  const clock = fakeClock();
  let calls = 0; let active = 0; let maximumActive = 0;
  const controller = createLiveTrackingController({ ...clock,
    fetchPrices: (_next, signal) => {
      calls++; maximumActive = Math.max(maximumActive, ++active);
      signal.addEventListener('abort', () => { active--; }, { once: true });
      return new Promise(() => {});
    },
  });
  controller.start(config);
  for (let attempt = 0; attempt < 4; attempt++) {
    assert.deepEqual(clock.delays, [LIVE_REQUEST_TIMEOUT_MS]);
    await clock.next();
    if (attempt < 3) {
      assert.deepEqual(clock.delays, [1000 * 2 ** attempt]);
      await clock.next();
    }
  }
  assert.equal(calls, 4);
  assert.equal(maximumActive, 1);
  assert.equal(active, 0);
  assert.equal(controller.getSnapshot().state, 'error');
  assert.equal(controller.getSnapshot().consecutiveFailures, 4);
  assert.deepEqual(clock.delays, []);
  controller.stop();
});

test('suspend followed immediately by resume does not wait forever on the aborted attempt', async () => {
  const clock = fakeClock();
  let calls = 0; let firstSignal!: AbortSignal;
  const controller = createLiveTrackingController({ ...clock,
    fetchPrices: (_next, signal) => {
      if (++calls === 1) { firstSignal = signal; return new Promise(() => {}); }
      return Promise.resolve([price()]);
    },
  });
  controller.start(config); controller.suspend(); controller.resume();
  await flush();
  assert.equal(firstSignal.aborted, true);
  assert.equal(calls, 2);
  assert.equal(controller.getSnapshot().state, 'running');
  assert.equal(controller.getSnapshot().pollCount, 1);
  controller.stop();
});

test('rate limits, authorization refusals and external aborts never trigger automatic retries', async () => {
  for (const error of [new Error('API error: 429'), new Error('API error: 401'), new Error('API error: 403'), Object.assign(new Error('fetch aborted'), { name: 'AbortError' })]) {
    const clock = fakeClock(); let calls = 0;
    const controller = createLiveTrackingController({ ...clock, fetchPrices: async () => { calls++; throw error; } });
    controller.start(config); await controller.pollNow();
    assert.equal(calls, 1);
    assert.deepEqual(clock.delays, []);
    await controller.pollNow();
    assert.equal(calls, 1);
    assert.equal(controller.getSnapshot().state, error.message.includes('429') ? 'suspended' : 'error');
    controller.stop();
  }
});

test('the controller timeout reaches the actual Live API fetch AbortSignal', async () => {
  const original = globalThis.fetch;
  const clock = fakeClock();
  let nativeSignal!: AbortSignal;
  globalThis.fetch = ((_url, init) => {
    nativeSignal = init!.signal as AbortSignal;
    return new Promise((_resolve, reject) => nativeSignal.addEventListener('abort', () => reject(Object.assign(new Error('native fetch aborted'), { name: 'AbortError' })), { once: true }));
  }) as typeof fetch;
  const controller = createLiveTrackingController({ ...clock, maxRetries: 0,
    fetchPrices: (next, signal) => fetchCurrentPricesLiveBatch(next.itemIds, next.cities, next.server, next.quality, { signal }),
  });
  try {
    controller.start(config);
    await clock.next();
    assert.equal(nativeSignal.aborted, true);
    assert.equal(controller.inFlight, false);
    assert.equal(controller.getSnapshot().error?.name, 'TimeoutError');
  } finally { controller.stop(); globalThis.fetch = original; }
});

test('the deadline also covers a hung JSON body and prevents later chunks after a late body completion', async () => {
  const original = globalThis.fetch;
  const clock = fakeClock();
  let calls = 0;
  let nativeSignal!: AbortSignal;
  let resolveBody!: (rows: unknown[]) => void;
  globalThis.fetch = (async (_url, init) => {
    calls++;
    nativeSignal = init!.signal as AbortSignal;
    return { ok: true, json: () => new Promise((resolve) => { resolveBody = resolve; }) } as Response;
  }) as typeof fetch;
  const controller = createLiveTrackingController({ ...clock, maxRetries: 0,
    fetchPrices: (next, signal) => fetchCurrentPricesLiveBatch(next.itemIds, next.cities, next.server, next.quality, { signal }),
  });
  try {
    controller.start({ ...config, itemIds: ['A'.repeat(2200), 'B'.repeat(2200)] });
    await flush();
    assert.equal(typeof resolveBody, 'function');
    await clock.next();
    assert.equal(nativeSignal.aborted, true);
    assert.equal(controller.inFlight, false);
    assert.equal(controller.getSnapshot().state, 'error');
    resolveBody([]); await flush();
    assert.equal(calls, 1);
    assert.equal(controller.getSnapshot().pollCount, 0);
    assert.deepEqual(clock.delays, []);
  } finally { controller.stop(); globalThis.fetch = original; }
});
