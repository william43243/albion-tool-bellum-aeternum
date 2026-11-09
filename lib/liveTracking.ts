import { CITIES, type PriceData, type City, type Quality } from './api';
import { parseAodpTimestamp } from './aodpTime';

export type LivePollStatus = 'new-data' | 'no-new-data' | 'no-data';
export interface LivePoint { key: string; itemId: string; city: City; quality: Quality; timestamp: string; value: number; }
export interface LiveSeriesKey { itemId: string; city: City; quality: Quality; }
export interface LivePollResult { status: LivePollStatus; points: LivePoint[]; observedAt?: string; observedSeries: string[]; noDataSeries: string[]; }

export function liveSeriesKey({ itemId, city, quality }: LiveSeriesKey): string { return `${itemId}|${city}|${quality}`; }
export function validLiveObservation(price: PriceData | undefined): LivePoint | null {
  if (!price || typeof price.item_id !== 'string' || !CITIES.includes(price.city as City) || ![1, 2, 3, 4, 5].includes(price.quality as Quality)) return null;
  const timestamp = price.sell_price_min_date;
  const value = price.sell_price_min;
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(parseAodpTimestamp(timestamp))) return null;
  return { key: liveSeriesKey({ itemId: price.item_id, city: price.city as City, quality: price.quality as Quality }), itemId: price.item_id, city: price.city as City, quality: price.quality as Quality, timestamp, value };
}
export function classifyLivePoll(prices: PriceData[] | undefined, lastTimestamps: ReadonlyMap<string, string>, expectedSeries: ReadonlySet<string> = new Set()): LivePollResult {
  const points: LivePoint[] = [];
  const observedSeries = new Set<string>();
  for (const price of prices ?? []) {
    const point = validLiveObservation(price);
    if (!point) continue;
    observedSeries.add(point.key);
    const prior = lastTimestamps.get(point.key);
    if (!prior || parseAodpTimestamp(point.timestamp) > parseAodpTimestamp(prior)) points.push(point);
  }
  const noDataSeries = [...expectedSeries].filter((key) => !observedSeries.has(key));
  if (points.length) return { status: 'new-data', points, observedSeries: [...observedSeries], noDataSeries, observedAt: points.map(p => p.timestamp).sort((a, b) => parseAodpTimestamp(a) - parseAodpTimestamp(b)).at(-1) };
  return { status: observedSeries.size ? 'no-new-data' : 'no-data', points: [], observedSeries: [...observedSeries], noDataSeries };
}
