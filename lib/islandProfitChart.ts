export type IslandProfitPoint = { day: number; profit: number };
export type IslandProfitSeries = {
  id: string;
  name: string;
  building: 'farm' | 'herbgarden';
  averageProfit: number | null;
  observedDays: number | null;
  points: IslandProfitPoint[];
};
export type IslandProfitChart = {
  days: number;
  start: number;
  end: number;
  marketCity: string;
  islandCity: string;
  plots: number;
  premium: boolean;
  focus: number;
  partial: boolean;
  series: IslandProfitSeries[];
};
export type IslandProfitChartState = { kind: 'ready'; chart: IslandProfitChart } | { kind: 'unavailable' } | null;

const DAY = 86_400_000;
const boundedProfit = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 9e15;

/** Parse only the native comparison result; never synthesize missing days or prices. */
export function parseIslandProfitChart(name: string, result?: string): IslandProfitChartState {
  if (name !== 'compare_island_crops' || !result || result.length > 131_072) return null;
  try {
    const raw = JSON.parse(result);
    if (raw?.chart_requested !== true) return null;
    if (!['ok', 'partial'].includes(raw.status) || raw.history?.status !== 'ok') return { kind: 'unavailable' };
    const days = raw.history_days;
    const start = Date.parse(raw.history.window_start);
    const end = Date.parse(raw.history.window_end_exclusive);
    if (![7, 30, 60, 90].includes(days) || raw.history.requested_days !== days ||
        !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start % DAY !== 0 || end - start !== days * DAY ||
        typeof raw.market_city !== 'string' || raw.market_city.length > 40 || raw.history.city !== raw.market_city ||
        typeof raw.island_city !== 'string' || raw.island_city.length > 40 ||
        !Number.isSafeInteger(raw.plot_count) || raw.plot_count < 1 || raw.plot_count > 1000 ||
        typeof raw.premium !== 'boolean' || !Number.isSafeInteger(raw.focus_budget) || raw.focus_budget < 0 ||
        !Array.isArray(raw.candidates) || raw.candidates.length < 1 || raw.candidates.length > 15) return { kind: 'unavailable' };
    const seen = new Set<string>();
    const series: IslandProfitSeries[] = raw.candidates.map((candidate: any) => {
      if (typeof candidate.product_id !== 'string' || !/^[A-Z0-9_@.\-]{1,100}$/.test(candidate.product_id) || seen.has(candidate.product_id) ||
          typeof candidate.name !== 'string' || candidate.name.length < 1 || candidate.name.length > 80 ||
          !['farm', 'herbgarden'].includes(candidate.building) || !Array.isArray(candidate.profit_history) || candidate.profit_history.length > days ||
          !(candidate.estimated_profit_per_cycle === null || boundedProfit(candidate.estimated_profit_per_cycle)) ||
          !(candidate.history_usable_days === null || Number.isSafeInteger(candidate.history_usable_days) && candidate.history_usable_days >= 0 && candidate.history_usable_days <= days)) throw new Error('Invalid candidate');
      seen.add(candidate.product_id);
      const pointDays = new Set<number>();
      const points = candidate.profit_history.map((point: unknown) => {
        if (!Array.isArray(point) || point.length !== 2 || !Number.isSafeInteger(point[0]) || point[0] < 0 || point[0] >= days ||
            !boundedProfit(point[1]) || pointDays.has(point[0])) throw new Error('Invalid point');
        pointDays.add(point[0]);
        return { day: point[0], profit: point[1] };
      }).sort((a: IslandProfitPoint, b: IslandProfitPoint) => a.day - b.day);
      return { id: candidate.product_id, name: candidate.name, building: candidate.building,
        averageProfit: candidate.estimated_profit_per_cycle, observedDays: candidate.history_usable_days, points };
    });
    if (!series.some((row) => row.points.length > 0)) return { kind: 'unavailable' };
    return { kind: 'ready', chart: { days, start, end, marketCity: raw.market_city, islandCity: raw.island_city,
      plots: raw.plot_count, premium: raw.premium, focus: raw.focus_budget, partial: raw.status === 'partial', series } };
  } catch { return { kind: 'unavailable' }; }
}

/** Connect only consecutive observed days; missing days remain visual gaps. */
export function profitSegments(points: IslandProfitPoint[]): Array<[IslandProfitPoint, IslandProfitPoint]> {
  const sorted = [...points].sort((a, b) => a.day - b.day);
  return sorted.slice(1).flatMap((point, index) => point.day === sorted[index].day + 1 ? [[sorted[index], point] as [IslandProfitPoint, IslandProfitPoint]] : []);
}

/** Consecutive observations form one line; a missing day starts a new line. */
export function profitRuns(points: IslandProfitPoint[]): IslandProfitPoint[][] {
  const runs: IslandProfitPoint[][] = [];
  for (const point of [...points].sort((a, b) => a.day - b.day)) {
    const last = runs[runs.length - 1];
    if (!last || point.day !== last[last.length - 1].day + 1) runs.push([point]);
    else last.push(point);
  }
  return runs;
}

export type ProfitAxisRange = { low: number; high: number; outside: number };
export type ProfitScale = 'full' | 'zoom';

/** The complete scale includes every point; zoom is a disclosed, reversible view. */
export function profitAxisRange(points: IslandProfitPoint[], scale: ProfitScale): ProfitAxisRange {
  if (!points.length) return { low: -1, high: 1, outside: 0 };
  const values = points.map((point) => point.profit).sort((a, b) => a - b);
  const percentile = (part: number) => {
    const index = (values.length - 1) * part;
    const lower = Math.floor(index);
    return values[lower] + (values[Math.ceil(index)] - values[lower]) * (index - lower);
  };
  const canZoom = scale === 'zoom' && values.length >= 20;
  const smallest = canZoom ? percentile(0.05) : values[0];
  const largest = canZoom ? percentile(0.95) : values[values.length - 1];
  const span = largest - smallest;
  const margin = Math.max(span * 0.12, Math.abs(smallest) * 0.02, Math.abs(largest) * 0.02, 1);
  const low = smallest - margin;
  const high = largest + margin;
  return { low, high, outside: values.filter((value) => value < low || value > high).length };
}

/** Map one plot-local touch to a complete UTC-day index. */
export function profitDayAtX(locationX: number, left: number, right: number, days: number): number {
  if (!Number.isFinite(locationX) || !Number.isFinite(left) || !Number.isFinite(right) || right <= left || !Number.isSafeInteger(days) || days < 1) return 0;
  return Math.max(0, Math.min(days - 1, Math.round((locationX - left) / (right - left) * (days - 1))));
}

/** A vertical scroll must not silently select a different date. */
export function profitGesture(dx: number, dy: number): 'tap' | 'horizontal' | 'vertical' {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.max(Math.abs(dx), Math.abs(dy)) < 8) return 'tap';
  return Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
}
