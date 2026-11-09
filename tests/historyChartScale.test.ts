import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareHistoryChart } from '../lib/historyChart';
import { projectLiveChartPoint } from '../lib/liveChart';
import type { HistoryResponse } from '../lib/api';
import type { LiveChartSegment } from '../lib/liveChart';

const options = { livePoints: [], liveDashedSegments: [], multipleItems: false, colors: {}, width: 400 };
const timestampAt = (hour: number) => new Date(Date.UTC(2025, 0, 1) + hour * 3600000).toISOString();
const history = (prices: number[], hours = prices.map((_, index) => index)): HistoryResponse => ({
  item_id: 'T4_BAG', location: 'Caerleon', quality: 1,
  data: prices.map((avg_price, index) => ({ timestamp: timestampAt(hours[index]), avg_price, item_count: 1 })),
});

test('domain carrier uses only bounds while SVG points, holes and full-axis alignment stay intact', () => {
  const model = prepareHistoryChart({ ...options, historyData: [
    history([100, 300], [0, 2]),
    { ...history([200], [1]), location: 'Martlock' },
  ] });
  assert.ok(model);
  assert.deepEqual(model.datasets[0].data, [100, 300]);
  assert.equal(model.datasets[0].color(1), 'transparent');
  assert.equal(model.datasets[0].strokeWidth, 0);
  assert.deepEqual(model.projection.timestamps, [timestampAt(0), timestampAt(1), timestampAt(2)]);
  assert.equal(model.labels.length, 3);
  assert.equal(model.chartPoints.length, 3);
  assert.equal(model.isolatedPoints.length, 3);
  assert.equal(model.lineSegments.length, 0, 'domain compression must not connect across a hole');
  assert.deepEqual(projectLiveChartPoint(timestampAt(1), 200, model.projection), { x: 176, y: 98.5 });
  assert.deepEqual(model.projectPoint(timestampAt(1), 200), { x: 176, y: 98.5 });
  assert.deepEqual(projectLiveChartPoint(timestampAt(2), 300, model.projection), { x: 288, y: 16 });
  assert.deepEqual(model.legendEntries.map(({ min, max, avg, last }) => ({ min, max, avg, last })), [
    { min: 100, max: 300, avg: 200, last: 300 },
    { min: 200, max: 200, avg: 200, last: 200 },
  ]);
});

test('domain carrier handles constant series, invalid values and dashed endpoints', () => {
  assert.equal(prepareHistoryChart({ ...options, historyData: [] }), null);
  assert.equal(prepareHistoryChart({ ...options, historyData: [history([NaN, Infinity, 0, -1])] }), null);
  const constant = prepareHistoryChart({ ...options, historyData: [history([42, 42, NaN, 0])] });
  assert.ok(constant);
  assert.deepEqual(constant.datasets[0].data, [42]);
  assert.equal(constant.projection.minValue, 42);
  assert.equal(constant.projection.maxValue, 42);
  assert.equal(constant.chartPoints.length, 2);

  const from = { key: 'T4_BAG|Caerleon|1', itemId: 'T4_BAG', city: 'Caerleon' as const, quality: 1 as const, timestamp: timestampAt(2), value: 50 };
  const segment: LiveChartSegment = { key: from.key, city: from.city, color: '#fff', from, to: { ...from, timestamp: timestampAt(3), value: 300 }, style: 'dashed', polls: 1 };
  const model = prepareHistoryChart({ ...options, historyData: [history([100, 200])], liveDashedSegments: [segment] });
  assert.ok(model);
  assert.deepEqual(model.datasets[0].data, [50, 300]);
  assert.equal(model.projection.minValue, 50);
  assert.equal(model.projection.maxValue, 300);
  assert.equal(model.projection.timestamps.length, 4);
  assert.equal(model.chartPoints.length, 2, 'domain endpoints are not fabricated real observations');
  assert.equal(model.lineSegments[0].points.length, 2);
  assert.equal(model.legendEntries[0].min, 100, 'dashed values do not change historical statistics');
});

test('synthetic hourly year across three items and seven cities preserves all 183960 observations', () => {
  const timestamps = Array.from({ length: 365 * 24 }, (_, hour) => timestampAt(hour));
  const cities = ['Caerleon', 'Bridgewatch', 'Fort Sterling', 'Lymhurst', 'Martlock', 'Thetford', 'Brecilien'];
  const historyData: HistoryResponse[] = ['T4_BAG', 'T5_BAG', 'T6_BAG'].flatMap((item_id, item) => cities.map((location, city) => ({
    item_id, location, quality: 1,
    data: timestamps.map((timestamp, hour) => ({ timestamp, avg_price: 100 + item * 10000 + city * 1000 + hour, item_count: 1 })),
  })));
  const model = prepareHistoryChart({ ...options, multipleItems: true, historyData });
  assert.ok(model);
  assert.equal(model.chartPoints.length, 183960);
  assert.equal(model.projection.timestamps.length, 8760);
  assert.equal(model.projection.timestamps.at(-1), timestamps.at(-1));
  assert.equal(model.labels.length, 8760);
  assert.equal(model.labels.filter(Boolean).length, 5);
  assert.equal(model.legendEntries.length, 21);
  assert.equal(model.lineSegments.length, 21);
  assert.ok(model.lineSegments.every((segment) => segment.points.length === 8760));
  assert.equal(model.isolatedPoints.length, 0);
  assert.equal(model.hasTruncatedSeries, false);
  assert.deepEqual(model.datasets[0].data, [100, 34859]);
  assert.equal(model.legendEntries[0].avg, 4479.5);
  assert.equal(model.legendEntries.at(-1)?.last, 34859);
  assert.equal(historyData[0].data.length, 8760, 'input histories remain unchanged');
});

test('one oversized series also avoids spread limits in legend and domain aggregation', () => {
  const size = 150000;
  const input: HistoryResponse = {
    item_id: 'T4_BAG', location: 'Caerleon', quality: 1,
    data: Array.from({ length: size }, (_, hour) => ({ timestamp: timestampAt(hour), avg_price: hour + 1, item_count: 1 })),
  };
  const model = prepareHistoryChart({ ...options, historyData: [input] });
  assert.ok(model);
  assert.deepEqual(model.datasets[0].data, [1, size]);
  assert.equal(model.chartPoints.length, size);
  assert.equal(model.projection.timestamps.length, size);
  assert.equal(model.lineSegments[0].points.length, size);
  assert.equal(model.legendEntries[0].avg, (size + 1) / 2);
  assert.equal(model.legendEntries[0].min, 1);
  assert.equal(model.legendEntries[0].max, size);
  assert.equal(model.legendEntries[0].last, size);
});

test('screen reuses the model projector and keeps the bounds-only carrier invisible', () => {
  const screen = readFileSync('screens/HistoryScreen.tsx', 'utf8');
  assert.equal((screen.match(/chartInfo\.projectPoint\(/g) ?? []).length, 4);
  assert.doesNotMatch(screen, /projectLiveChartPoint\(/);
  for (const property of ['withDots', 'withShadow', 'withVerticalLines', 'fromZero']) {
    assert.ok(screen.includes(`${property}={false}`), `${property} must not render artificial domain samples`);
  }
});
