// Albion Online Data Project API
// https://www.albion-online-data.com/

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

// Simple in-memory cache
const cache: Record<string, { data: any; timestamp: number }> = {};
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function getCached(key: string): any | null {
  const entry = cache[key];
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data;
  }
  return null;
}

function setCache(key: string, data: any): void {
  cache[key] = { data, timestamp: Date.now() };
}

/**
 * Fetch current prices for an item across cities
 * GET /api/v2/stats/prices/{itemId}.json?locations={cities}
 */
export async function fetchCurrentPrices(
  itemId: string,
  cities: City[] = [...CITIES],
  server?: Server
): Promise<PriceData[]> {
  const cacheKey = `prices:${server || DEFAULT_SERVER}:${itemId}:${cities.join(',')}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const locations = cities.join(',');
  const url = `${getBaseUrl(server)}/prices/${encodeURIComponent(itemId)}.json?locations=${encodeURIComponent(locations)}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data: PriceData[] = await response.json();
  setCache(cacheKey, data);
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
  server?: Server
): Promise<HistoryResponse[]> {
  const cacheKey = `history:${server || DEFAULT_SERVER}:${itemId}:${cities.join(',')}:${startDate}:${endDate}:${timeScale}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const locations = cities.join(',');
  const url = `${getBaseUrl(server)}/history/${encodeURIComponent(itemId)}.json?locations=${encodeURIComponent(locations)}&date=${startDate}&end_date=${endDate}&time-scale=${timeScale}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data: HistoryResponse[] = await response.json();
  setCache(cacheKey, data);
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
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '?';

  const now = Date.now();
  const diff = now - date.getTime();
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
    price.buy_price_max_date,
  ].filter(Boolean);
  if (dates.length === 0) return '';
  return dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
}
