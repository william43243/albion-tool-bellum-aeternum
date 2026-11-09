import type { HistoryDataPoint, HistoryResponse } from './api';

/** AODP timestamps without an offset are UTC, not the device's local time. */
export function parseAodpTimestamp(timestamp: string): number {
  if (!timestamp || /^0001-01-01T/.test(timestamp)) return NaN;
  const value = timestamp.trim();
  const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/i.test(value) ? `${value}Z` : value;
  return Date.parse(utc);
}

/** Align sparse histories by their real UTC timestamp. Missing observations stay absent. */
export interface AlignedHistorySeries { timestamps: string[]; series: Record<string, Array<number | null>>; }
export function alignHistoryByTimestamp(histories: HistoryResponse[]): AlignedHistorySeries {
  const timestamps = [...new Set(histories.flatMap((h) => h.data.map((p) => p.timestamp)).filter(Boolean))]
    .sort((a, b) => parseAodpTimestamp(a) - parseAodpTimestamp(b));
  const series: Record<string, Array<number | null>> = {};
  for (const history of histories) {
    const values = new Map(history.data.map((p) => [p.timestamp, p.avg_price > 0 ? p.avg_price : null]));
    series[`${history.item_id}:${history.location}:q${history.quality}`] = timestamps.map((timestamp) => values.get(timestamp) ?? null);
  }
  return { timestamps, series };
}

export function weightedAverage(points: HistoryDataPoint[]): number | null {
  const valid = points.filter((p) => Number.isFinite(p.avg_price) && p.avg_price > 0 && Number.isFinite(p.item_count) && p.item_count > 0);
  const weight = valid.reduce((sum, p) => sum + p.item_count, 0);
  if (valid.length === 0 || weight <= 0) return null;
  return valid.reduce((sum, p) => sum + p.avg_price * p.item_count, 0) / weight;
}

export function historyActivity(history: HistoryResponse): { status: 'known' | 'unknown'; points: number; volume: number; coverageStart: string | null; coverageEnd: string | null } {
  const points = history.data.filter((p) => p.avg_price > 0);
  if (points.length === 0) return { status: 'unknown', points: 0, volume: 0, coverageStart: null, coverageEnd: null };
  return { status: 'known', points: points.length, volume: points.reduce((sum, p) => sum + Math.max(0, p.item_count), 0), coverageStart: points[0].timestamp, coverageEnd: points[points.length - 1].timestamp };
}
