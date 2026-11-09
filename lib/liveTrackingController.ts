import { parseAodpTimestamp } from './aodpTime';
import type { City, Quality, Server, PriceData } from './api';
import { classifyLivePoll, type LivePoint } from './liveTracking';
import type { LiveChartSegment } from './liveChart';

export const LIVE_INTERVALS = { '5s': 5_000, '1m': 60_000, '5m': 300_000 } as const;
/** Retain 20 minutes of 5-second observations per series; the newest point always survives. */
export const LIVE_RETENTION_MAX_POINTS_PER_SERIES = 240;
/** Bound a whole Live attempt, including response-body parsing, on Android. */
export const LIVE_REQUEST_TIMEOUT_MS = 15_000;
export type LiveCadence = keyof typeof LIVE_INTERVALS;
export type LiveControllerState = 'idle' | 'running' | 'suspended' | 'error';
export interface LiveConfig { itemIds: string[]; cities: City[]; server: Server; quality: Quality; cadence?: LiveCadence; }
export interface LiveControllerSnapshot { state: LiveControllerState; status: 'waiting' | 'new-data' | 'no-new-data' | 'no-data' | 'error'; points: LivePoint[]; dashedSegments: LiveChartSegment[]; pollCount: number; seriesCount: number; noDataSeries: string[]; error?: Error; lastPollAt?: number; consecutiveFailures: number; nextRetryAt?: number; }
export interface LiveControllerOptions { fetchPrices: (config: LiveConfig, signal: AbortSignal) => Promise<PriceData[]>; onUpdate?: (snapshot: LiveControllerSnapshot) => void; setTimeout?: typeof globalThis.setTimeout; clearTimeout?: typeof globalThis.clearTimeout; now?: () => number; maxRetries?: number; requestTimeoutMs?: number; }

export function callsPerMinute(cadence: LiveCadence): number { return cadence === '5s' ? 12 : cadence === '1m' ? 1 : 0.2; }
const retryDelay = (failure: number) => Math.min(30_000, 1_000 * 2 ** Math.max(0, failure - 1));
const isRateLimited = (error: Error) => /(?:429|too many requests|rate limit)/i.test(error.message);
const isRetryable = (error: Error) => error.name !== 'AbortError' && /(?:5\d\d|timeout|network|fetch|failed|temporar)/i.test(error.message);

export function createLiveTrackingController(options: LiveControllerOptions) {
  const setTimer = options.setTimeout ?? globalThis.setTimeout;
  const clearTimer = options.clearTimeout ?? globalThis.clearTimeout;
  const now = options.now ?? Date.now;
  const maxRetries = options.maxRetries ?? 3;
  const requestTimeoutMs = Number.isFinite(options.requestTimeoutMs) && options.requestTimeoutMs! > 0
    ? Math.min(options.requestTimeoutMs!, 60_000) : LIVE_REQUEST_TIMEOUT_MS;
  let config: LiveConfig | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let backoffTimer: ReturnType<typeof setTimeout> | undefined;
  let backoffResolve: (() => void) | undefined;
  let generation = 0;
  let inFlight = false;
  let activeRequest: Promise<void> | undefined;
  let cancelAttempt: (() => void) | undefined;
  let snapshot: LiveControllerSnapshot = { state: 'idle', status: 'waiting', points: [], dashedSegments: [], pollCount: 0, seriesCount: 0, noDataSeries: [], consecutiveFailures: 0 };
  const timestamps = new Map<string, string>();
  const allPoints = new Map<string, LivePoint>();
  const currentPoints = () => [...allPoints.values()].sort((a, b) => parseAodpTimestamp(a.timestamp) - parseAodpTimestamp(b.timestamp));
  const retainLatestPoints = (keys: ReadonlySet<string>) => {
    for (const key of keys) {
      const entries = [...allPoints.entries()]
        .filter(([, point]) => point.key === key)
        .sort(([, a], [, b]) => parseAodpTimestamp(b.timestamp) - parseAodpTimestamp(a.timestamp));
      for (const [mapKey] of entries.slice(LIVE_RETENTION_MAX_POINTS_PER_SERIES)) allPoints.delete(mapKey);
    }
  };
  const emit = () => options.onUpdate?.({ ...snapshot, points: currentPoints() });
  const stopTimer = () => {
    if (timer !== undefined) { clearTimer(timer); timer = undefined; }
    if (backoffTimer !== undefined) { clearTimer(backoffTimer); backoffTimer = undefined; }
    if (backoffResolve) { const resolve = backoffResolve; backoffResolve = undefined; resolve(); }
  };
  const fetchAttempt = (pollConfig: LiveConfig): Promise<PriceData[]> => new Promise((resolve, reject) => {
    const abort = new AbortController();
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      if (deadline !== undefined) clearTimer(deadline);
      if (cancelAttempt === cancel) cancelAttempt = undefined;
      complete();
    };
    const abortWith = (error: Error) => {
      if (settled) return;
      // Signal native cancellation before releasing the logical request slot.
      // The explicit rejection also bounds adapters that never settle on abort.
      abort.abort();
      finish(() => reject(error));
    };
    const cancel = () => abortWith(Object.assign(new Error('Live request cancelled'), { name: 'AbortError' }));
    cancelAttempt = cancel;
    deadline = setTimer(() => abortWith(Object.assign(new Error(`Live request timeout after ${requestTimeoutMs}ms`), { name: 'TimeoutError' })), requestTimeoutMs);
    if (settled) return;
    try {
      // Keep both handlers attached so a late response/rejection cannot mutate
      // a newer generation or produce an unhandled rejection after cancellation.
      options.fetchPrices(pollConfig, abort.signal).then(
        (prices) => finish(() => resolve(prices)),
        (error) => finish(() => reject(error)),
      );
    } catch (error) {
      finish(() => reject(error));
    }
  });
  const schedule = (expected: number, delay: number) => {
    stopTimer();
    if (!config || expected !== generation || snapshot.state !== 'running') return;
    timer = setTimer(() => { timer = undefined; void pollNow(expected); }, delay);
  };
  const runPoll = async (expected: number): Promise<void> => {
    if (!config || expected !== generation) return;
    const pollConfig = config;
    let failure = 0;
    while (true) {
      try {
        const prices = await fetchAttempt(pollConfig);
        if (expected !== generation || !config) return;
        const expectedSeries = new Set(config.itemIds.flatMap((itemId) => config!.cities.map((city) => `${itemId}|${city}|${config!.quality}`)));
        const result = classifyLivePoll(prices, timestamps, expectedSeries);
        const previous = new Map(allPoints);
        const newSeries = new Set(result.points.map((point) => point.key));
        for (const point of result.points) { timestamps.set(point.key, point.timestamp); allPoints.set(`${point.key}|${point.timestamp}`, point); }
        retainLatestPoints(newSeries);
        const pollAt = now();
        const latestBySeries = new Map<string, LivePoint>();
        for (const point of previous.values()) {
          const latest = latestBySeries.get(point.key);
          if (!latest || parseAodpTimestamp(point.timestamp) > parseAodpTimestamp(latest.timestamp)) latestBySeries.set(point.key, point);
        }
        const dashedBySeries = new Map<string, LiveChartSegment>();
        for (const segment of snapshot.dashedSegments) dashedBySeries.set(segment.key, segment);
        for (const key of newSeries) dashedBySeries.delete(key);
        for (const key of result.noDataSeries) dashedBySeries.delete(key);
        if (result.status !== 'no-data') {
          for (const from of latestBySeries.values()) {
            if (newSeries.has(from.key) || result.noDataSeries.includes(from.key)) continue;
            const previousSegment = dashedBySeries.get(from.key);
            const toTimestamp = new Date(Math.max(pollAt, parseAodpTimestamp(from.timestamp) + 1)).toISOString();
            dashedBySeries.set(from.key, { key: from.key, city: from.city, color: previousSegment?.color ?? '#FFFFFF', from, to: { ...from, timestamp: toTimestamp }, style: 'dashed', polls: (previousSegment?.polls ?? 0) + 1 });
          }
        }
        const dashedSegments = [...dashedBySeries.values()];
        snapshot = { ...snapshot, state: 'running', status: result.status, noDataSeries: result.noDataSeries, dashedSegments, pollCount: snapshot.pollCount + 1, seriesCount: new Set([...allPoints.values()].map((p) => p.key)).size, lastPollAt: pollAt, error: undefined, consecutiveFailures: 0, nextRetryAt: undefined };
        emit();
        return;
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        if (isRateLimited(error)) {
          if (expected === generation) {
            generation++;
            stopTimer();
            snapshot = { ...snapshot, state: 'suspended', status: 'error', error, nextRetryAt: undefined };
            emit();
          }
          return;
        }
        failure += 1;
        if (!isRetryable(error) || failure > maxRetries || expected !== generation || !config) {
          if (expected === generation) { snapshot = { ...snapshot, state: 'error', status: 'error', error, consecutiveFailures: failure, nextRetryAt: undefined }; emit(); }
          return;
        }
        const delay = retryDelay(failure);
        snapshot = { ...snapshot, state: 'running', status: 'error', error, consecutiveFailures: failure, nextRetryAt: now() + delay };
        emit();
        await new Promise<void>((resolve) => {
          backoffResolve = resolve;
          backoffTimer = setTimer(() => { backoffTimer = undefined; backoffResolve = undefined; resolve(); }, delay);
        });
        if (expected !== generation || !config) return;
      }
    }
  };
  const pollNow = (expected = generation): Promise<void> => {
    if (!config || expected !== generation || snapshot.state !== 'running') return Promise.resolve();
    if (activeRequest) return activeRequest;
    inFlight = true;
    activeRequest = runPoll(expected).finally(() => {
      inFlight = false;
      activeRequest = undefined;
      if (generation === expected && config && snapshot.state === 'running') schedule(expected, LIVE_INTERVALS[config.cadence ?? '1m']);
      else if (config && snapshot.state === 'running') void pollNow(generation);
    });
    return activeRequest;
  };
  return {
    start(next: LiveConfig) {
      stopTimer(); generation++; cancelAttempt?.(); config = { ...next, itemIds: [...new Set(next.itemIds)], cities: [...new Set(next.cities)] };
      allPoints.clear(); timestamps.clear(); snapshot = { state: 'running', status: 'waiting', points: [], dashedSegments: [], pollCount: 0, seriesCount: 0, noDataSeries: [], consecutiveFailures: 0 }; emit();
      void pollNow(generation);
    },
    stop() { generation++; stopTimer(); cancelAttempt?.(); config = undefined; snapshot = { ...snapshot, state: 'idle', status: 'waiting', nextRetryAt: undefined }; emit(); },
    suspend() { generation++; stopTimer(); cancelAttempt?.(); snapshot = { ...snapshot, state: 'suspended', nextRetryAt: undefined }; emit(); },
    resume() {
      if (!config || snapshot.state !== 'suspended') return;
      generation++;
      snapshot = { ...snapshot, state: 'running', status: 'waiting', error: undefined, consecutiveFailures: 0, nextRetryAt: undefined };
      emit();
      void pollNow(generation);
    },
    async pollNow() { await pollNow(generation); },
    getSnapshot() { return { ...snapshot, points: currentPoints() }; },
    getConfig() { return config; },
    get inFlight() { return inFlight; },
  };
}
