// Albion Online Data Project API
// https://www.albion-online-data.com/

import { normalizeAodpTimestamp, parseAodpTimestamp } from './aodpTime';

export const SERVERS = {
  americas: 'https://west.albion-online-data.com/api/v2/stats',
  europe: 'https://europe.albion-online-data.com/api/v2/stats',
  asia: 'https://east.albion-online-data.com/api/v2/stats',
} as const;

export type Server = keyof typeof SERVERS;

const DEFAULT_SERVER: Server = 'americas';

function getBaseUrl(server?: Server): string {
  return SERVERS[server || DEFAULT_SERVER];
}

export const CITIES = [
  'Caerleon',
  'Bridgewatch',
  'Fort Sterling',
  'Lymhurst',
  'Thetford',
  'Martlock',
  'Brecilien',
] as const;

export type City = (typeof CITIES)[number];

export interface PriceData {
  item_id: string;
  city: string;
  quality: number;
  sell_price_min: number;
  sell_price_min_date: string;
  sell_price_max: number;
  sell_price_max_date: string;
  buy_price_min: number;
  buy_price_min_date: string;
  buy_price_max: number;
  buy_price_max_date: string;
}

export interface HistoryDataPoint {
  item_count: number;
  avg_price: number;
  timestamp: string;
}

export interface HistoryResponse {
  location: string;
  item_id: string;
  quality: number;
  data: HistoryDataPoint[];
}

const MAX_PRICE_ROWS = 100;
const MAX_HISTORY_ROWS = 100;
const MAX_HISTORY_POINTS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireSafeNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid AODP ${field}`);
  }
  return value;
}

function requireTimestamp(value: unknown, field: string, required: boolean): string {
  if (!required && (value === '' || value === null || value === undefined)) return '';
  if (typeof value !== 'string') throw new Error(`Invalid AODP ${field}`);
  const normalized = normalizeAodpTimestamp(value);
  if (!normalized) throw new Error(`Invalid AODP ${field}`);
  const timestamp = parseAodpTimestamp(normalized);
  if (timestamp === null || timestamp > Date.now() + 5 * 60_000) {
    throw new Error(`Invalid AODP ${field}`);
  }
  return normalized;
}

function parseApiDateUtc(value: string): number {
  const match = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(value);
  if (!match) throw new Error('Invalid AODP date boundary');
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('Invalid AODP date boundary');
  }
  return timestamp;
}

function validatePricePayload(
  payload: unknown,
  itemId: string,
  cities: City[],
  quality: number
): PriceData[] {
  if (!Array.isArray(payload) || payload.length > MAX_PRICE_ROWS) {
    throw new Error('Invalid AODP price payload');
  }
  const allowedCities = new Set<string>(cities);
  const seen = new Set<string>();
  return payload.map((value) => {
    if (!isRecord(value) || value.item_id !== itemId || typeof value.city !== 'string'
      || !allowedCities.has(value.city) || value.quality !== quality) {
      throw new Error('Incompatible AODP price identity');
    }
    const key = `${value.city}:${value.quality}`;
    if (seen.has(key)) throw new Error('Duplicate AODP price identity');
    seen.add(key);

    const sellMin = requireSafeNonNegativeInteger(value.sell_price_min, 'sell_price_min');
    const sellMax = requireSafeNonNegativeInteger(value.sell_price_max, 'sell_price_max');
    const buyMin = requireSafeNonNegativeInteger(value.buy_price_min, 'buy_price_min');
    const buyMax = requireSafeNonNegativeInteger(value.buy_price_max, 'buy_price_max');
    return {
      item_id: itemId,
      city: value.city,
      quality,
      sell_price_min: sellMin,
      sell_price_min_date: requireTimestamp(value.sell_price_min_date, 'sell_price_min_date', sellMin > 0),
      sell_price_max: sellMax,
      sell_price_max_date: requireTimestamp(value.sell_price_max_date, 'sell_price_max_date', sellMax > 0),
      buy_price_min: buyMin,
      buy_price_min_date: requireTimestamp(value.buy_price_min_date, 'buy_price_min_date', buyMin > 0),
      buy_price_max: buyMax,
      buy_price_max_date: requireTimestamp(value.buy_price_max_date, 'buy_price_max_date', buyMax > 0),
    };
  });
}

function validateHistoryPayload(
  payload: unknown,
  itemId: string,
  cities: City[],
  quality: number,
  startMs: number,
  endExclusiveMs: number
): HistoryResponse[] {
  if (!Array.isArray(payload) || payload.length > MAX_HISTORY_ROWS) {
    throw new Error('Invalid AODP history payload');
  }
  const allowedCities = new Set<string>(cities);
  const seenRows = new Set<string>();
  return payload.map((value) => {
    if (!isRecord(value) || value.item_id !== itemId || typeof value.location !== 'string'
      || !allowedCities.has(value.location) || value.quality !== quality || !Array.isArray(value.data)
      || value.data.length > MAX_HISTORY_POINTS) {
      throw new Error('Incompatible AODP history identity');
    }
    const rowKey = `${value.location}:${value.quality}`;
    if (seenRows.has(rowKey)) throw new Error('Duplicate AODP history identity');
    seenRows.add(rowKey);
    const seenTimestamps = new Set<string>();
    const data = value.data.map((point) => {
      if (!isRecord(point)) throw new Error('Invalid AODP history point');
      const timestamp = requireTimestamp(point.timestamp, 'history timestamp', true);
      if (seenTimestamps.has(timestamp)) throw new Error('Duplicate AODP history timestamp');
      seenTimestamps.add(timestamp);
      return {
        item_count: requireSafeNonNegativeInteger(point.item_count, 'item_count'),
        avg_price: requireSafeNonNegativeInteger(point.avg_price, 'avg_price'),
        timestamp,
      };
    })
      .filter((point) => {
        const timestamp = parseAodpTimestamp(point.timestamp);
        return timestamp !== null && timestamp >= startMs && timestamp < endExclusiveMs;
      })
      .sort((a, b) => (parseAodpTimestamp(a.timestamp) || 0) - (parseAodpTimestamp(b.timestamp) || 0));
    return { location: value.location, item_id: itemId, quality, data };
  });
}

// Cover both headers and body: AbortController alone cannot bound a fetch
// implementation (or body reader) that ignores its signal.
const REQUEST_TIMEOUT_MS = 15_000;

export interface RequestOptions {
  signal?: AbortSignal;
  forceRefresh?: boolean;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('AODP request cancelled');
    error.name = 'AbortError';
    throw error;
  }
}

async function requestJson(url: string, signal?: AbortSignal): Promise<unknown> {
  throwIfAborted(signal);
  const controller = new AbortController();
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      const error = new Error('AODP request cancelled');
      error.name = 'AbortError';
      reject(error);
      controller.abort();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      const error = new Error('AODP request timed out');
      error.name = 'TimeoutError';
      reject(error);
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    const payload = await Promise.race([
      (async () => {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        return await response.json();
      })(),
      timeout,
    ]);
    // Timers can be delayed while the event loop is busy or the app suspended.
    if (Date.now() >= deadline) {
      controller.abort();
      const error = new Error('AODP request timed out');
      error.name = 'TimeoutError';
      throw error;
    }
    throwIfAborted(signal);
    return payload;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

// Simple bounded in-memory cache
const cache: Record<string, { data: any; timestamp: number; ttl: number }> = {};
const PRICE_CACHE_TTL = 60_000;
const HISTORY_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const MAX_CACHE_ENTRIES = 200;

function pruneCache(now = Date.now()): void {
  for (const [key, entry] of Object.entries(cache)) {
    if (now - entry.timestamp >= entry.ttl) {
      delete cache[key];
    }
  }

  const entries = Object.entries(cache);
  if (entries.length <= MAX_CACHE_ENTRIES) return;

  entries
    .sort((a, b) => a[1].timestamp - b[1].timestamp)
    .slice(0, entries.length - MAX_CACHE_ENTRIES)
    .forEach(([key]) => delete cache[key]);
}

function getCached(key: string): any | null {
  pruneCache();
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.timestamp >= entry.ttl) {
    delete cache[key];
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: any, ttl: number): void {
  pruneCache();
  cache[key] = { data, timestamp: Date.now(), ttl };
  pruneCache();
}

/**
 * Fetch current prices for an item across cities
 * GET /api/v2/stats/prices/{itemId}.json?locations={cities}
 */
export async function fetchCurrentPrices(
  itemId: string,
  cities: City[] = [...CITIES],
  server?: Server,
  quality: number = 1,
  options: RequestOptions = {}
): Promise<PriceData[]> {
  throwIfAborted(options.signal);
  quality = Number.isInteger(quality) && quality >= 1 && quality <= 5 ? quality : 1;
  const cacheKey = `prices:${server || DEFAULT_SERVER}:${itemId}:${cities.join(',')}:q${quality}`;
  const cached = options.forceRefresh ? null : getCached(cacheKey);
  if (cached) return cached;

  const locations = cities.join(',');
  const url = `${getBaseUrl(server)}/prices/${encodeURIComponent(itemId)}.json?locations=${encodeURIComponent(locations)}&qualities=${quality}`;

  const payload = await requestJson(url, options.signal);
  throwIfAborted(options.signal);

  const data = validatePricePayload(payload, itemId, cities, quality);
  setCache(cacheKey, data, PRICE_CACHE_TTL);
  return data;
}

/**
 * Fetch historical prices for an item
 * GET /api/v2/stats/history/{itemId}.json?locations={cities}&date={start}&end_date={end}&time-scale={scale}
 * time-scale: 1 = hourly, 24 = daily
 */
export async function fetchPriceHistory(
  itemId: string,
  cities: City[] = [...CITIES],
  startDate: string, // format: M-D-YYYY
  endDate: string,
  timeScale: 1 | 24 = 24,
  server?: Server,
  quality: number = 1,
  options: RequestOptions = {}
): Promise<HistoryResponse[]> {
  throwIfAborted(options.signal);
  quality = Number.isInteger(quality) && quality >= 1 && quality <= 5 ? quality : 1;
  const cacheKey = `history:${server || DEFAULT_SERVER}:${itemId}:${cities.join(',')}:${startDate}:${endDate}:${timeScale}:q${quality}`;
  const cached = options.forceRefresh ? null : getCached(cacheKey);
  if (cached) return cached;

  const startMs = parseApiDateUtc(startDate);
  const endExclusiveMs = parseApiDateUtc(endDate) + 24 * 60 * 60 * 1000;
  if (endExclusiveMs <= startMs) throw new Error('Invalid AODP history window');

  const locations = cities.join(',');
  const url = `${getBaseUrl(server)}/history/${encodeURIComponent(itemId)}.json?locations=${encodeURIComponent(locations)}&date=${startDate}&end_date=${endDate}&time-scale=${timeScale}&qualities=${quality}`;

  const payload = await requestJson(url, options.signal);
  throwIfAborted(options.signal);

  const data = validateHistoryPayload(
    payload, itemId, cities, quality, startMs, endExclusiveMs
  );
  setCache(cacheKey, data, HISTORY_CACHE_TTL);
  return data;
}

/**
 * Format a date to M-D-YYYY for the API
 */
export function formatDateForApi(date: Date): string {
  return `${date.getMonth() + 1}-${date.getDate()}-${date.getFullYear()}`;
}

/**
 * Get date N days ago
 */
export function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/**
 * Format an API date string to a human-readable relative time + absolute time
 * e.g. "il y a 3h (14:32)" or "3h ago (14:32)"
 */
export function formatDataAge(dateStr: string, lang: string = 'en'): string {
  if (!dateStr) return '?';
  const timestamp = parseAodpTimestamp(dateStr);
  if (timestamp === null) return '?';
  const date = new Date(timestamp);

  const now = Date.now();
  const diff = now - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  const time = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  const dateShort = `${date.getDate()}/${date.getMonth() + 1}`;

  let relative: string;
  if (mins < 1) relative = lang === 'fr' ? '<1min' : lang === 'es' ? '<1min' : '<1min';
  else if (mins < 60) relative = `${mins}min`;
  else if (hours < 24) relative = `${hours}h`;
  else relative = `${days}d`;

  if (days >= 1) return `${relative} (${dateShort} ${time})`;
  return `${relative} (${time})`;
}

/**
 * Get the most recent date from a PriceData object
 */
export function getMostRecentPriceDate(price: PriceData): string {
  const dates = [
    price.sell_price_min_date,
    price.sell_price_max_date,
    price.buy_price_min_date,
    price.buy_price_max_date,
  ].filter(Boolean);
  if (dates.length === 0) return '';
  return dates.sort((a, b) => (parseAodpTimestamp(b) || 0) - (parseAodpTimestamp(a) || 0))[0];
}
