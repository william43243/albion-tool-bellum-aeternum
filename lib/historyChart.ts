import type { City, HistoryResponse, Quality } from './api';
import { parseAodpTimestamp, weightedAverage } from './aodpTime';
import type { LivePoint } from './liveTracking';
import {
  createLiveChartProjection,
  createLiveChartPointProjector,
  decimateLiveTimestamps,
  getPositiveValueBounds,
  mergeLivePointsIntoHistory,
  splitLiveChartLineSegments,
  unionLiveTimestamps,
  type LiveChartSegment,
  type LiveChartSeries,
} from './liveChart';

/** Pure presentation model used by HistoryScreen, including live-only series. */
export function prepareHistoryChart({ historyData, livePoints, liveDashedSegments, multipleItems, colors, width }: {
  historyData: HistoryResponse[];
  livePoints: LivePoint[];
  liveDashedSegments: LiveChartSegment[];
  multipleItems: boolean;
  colors: Record<string, string>;
  width: number;
}) {
  const displayHistory = mergeLivePointsIntoHistory(historyData, livePoints);
  const validEntries = displayHistory
    .map((entry) => ({ entry, values: new Map(entry.data
      .filter((point) => Number.isFinite(point.avg_price) && point.avg_price > 0 && Number.isFinite(parseAodpTimestamp(point.timestamp)))
      .map((point) => [point.timestamp, point.avg_price])) }))
    .filter((series) => series.values.size > 0);
  if (validEntries.length === 0) return null;

  const axisTimestamps = unionLiveTimestamps([
    ...validEntries.map(({ values }) => ({ timestamps: values.keys() })),
    ...liveDashedSegments.map((segment) => ({ timestamps: [segment.from.timestamp, segment.to.timestamp] })),
  ]);
  // Thin labels only. Thinning data would erase isolated series and connect
  // observations across real holes in the shared timeline.
  const chartTimestamps = axisTimestamps;
  const labelTimestamps = new Set(decimateLiveTimestamps(axisTimestamps));
  const labels = chartTimestamps.map((timestamp) => {
    if (!labelTimestamps.has(timestamp)) return '';
    const date = new Date(parseAodpTimestamp(timestamp));
    return `${date.getDate()}/${date.getMonth() + 1}`;
  });
  const datasets: { data: number[]; color: (opacity: number) => string; strokeWidth: number }[] = [];
  const lineSeries: LiveChartSeries[] = [];
  const legendEntries: { label: string; color: string; min: number; max: number; avg: number | null; last: number }[] = [];
  let chartMin = Infinity;
  let chartMax = -Infinity;
  for (const { entry, values } of validEntries) {
    const color = colors[entry.location] || '#FFFFFF';
    const { minValue: min, maxValue: max } = getPositiveValueBounds(values.values());
    chartMin = Math.min(chartMin, min);
    chartMax = Math.max(chartMax, max);
    if (chartTimestamps.length > 0) {
      const key = `${entry.item_id}|${entry.location}|${entry.quality}`;
      lineSeries.push({
        key, city: entry.location, color, dashedSegments: [],
        points: chartTimestamps.flatMap((timestamp) => {
          const value = values.get(timestamp);
          return value === undefined ? [] : [{ key, itemId: entry.item_id, city: entry.location as City, quality: entry.quality as Quality, timestamp, value }];
        }),
      });
    }
    const avg = weightedAverage(entry.data);
    const lastTimestamp = [...values.keys()].sort((a, b) => parseAodpTimestamp(b) - parseAodpTimestamp(a))[0];
    const label = multipleItems ? `${entry.item_id.replace(/^T\d_/, '')} - ${entry.location}` : entry.location;
    legendEntries.push({ label, color, min, max, avg, last: values.get(lastTimestamp) as number });
  }
  for (const segment of liveDashedSegments) {
    for (const value of [segment.from.value, segment.to.value]) {
      if (!Number.isFinite(value) || value <= 0) continue;
      chartMin = Math.min(chartMin, value);
      chartMax = Math.max(chartMax, value);
    }
  }
  // Chart-kit supplies axes only. Its invisible line still rescans its entire
  // dataset per point, so give it just the Y bounds instead of every sample.
  // X labels and the SVG projection retain the complete timestamp axis; real
  // observations and holes remain in lineSeries, never in this domain carrier.
  const chartValues = chartMin === chartMax ? [chartMin] : [chartMin, chartMax];
  datasets.push({ data: chartValues, color: () => 'transparent', strokeWidth: 0 });
  const chartWidth = Math.max(width, labelTimestamps.size * 60);
  const projection = createLiveChartProjection(chartTimestamps, chartValues, chartWidth);
  const lineSegments = splitLiveChartLineSegments(lineSeries, chartTimestamps);
  // Dots make an isolated observation visible without manufacturing a second point.
  const chartPoints = lineSeries.flatMap((series) => series.points.map((point) => ({ ...point, color: series.color })));
  const connectedPoints = new Set(lineSegments.flatMap((segment) => segment.points.map((point) => `${point.key}|${point.timestamp}`)));
  const isolatedPoints = chartPoints.filter((point) => !connectedPoints.has(`${point.key}|${point.timestamp}`));
  return {
    labels, datasets, legendEntries, projection, lineSegments, chartPoints, isolatedPoints,
    projectPoint: createLiveChartPointProjector(projection),
    hasTruncatedSeries: validEntries.some(({ values }) => values.size !== axisTimestamps.length),
    noCommonTimestamps: chartTimestamps.length === 0,
  };
}
