import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareHistoryChart } from '../lib/historyChart';
import { mergeLivePointsIntoHistory, projectLiveChartPoint } from '../lib/liveChart';
import { weightedAverage } from '../lib/aodpTime';
import { buildAnalysisPrompt } from '../lib/advisor';
import type { HistoryResponse } from '../lib/api';
import type { LivePoint } from '../lib/liveTracking';

const history: HistoryResponse = {
  item_id: 'T4_BAG', location: 'Caerleon', quality: 1,
  data: [
    { timestamp: '2026-11-01T00:00:00Z', avg_price: 100, item_count: 100 },
    { timestamp: '2026-11-02T00:00:00Z', avg_price: 1000, item_count: 1 },
  ],
};
const live: LivePoint = { key: 'T4_BAG|Caerleon|1', itemId: 'T4_BAG', city: 'Caerleon', quality: 1, timestamp: '2026-11-05T02:00:00Z', value: 1100 };
const options = { livePoints: [], liveDashedSegments: [], multipleItems: false, colors: { Caerleon: '#fff' }, width: 400 };

test('history screen model weights mean by traded volume without intermediate rounding', () => {
  const model = prepareHistoryChart({ ...options, historyData: [history] });
  assert.ok(model);
  assert.equal(model.legendEntries[0].avg, 11000 / 101);
  assert.equal(model.legendEntries[0].last, 1000);
  assert.equal(model.legendEntries[0].min, 100);
  assert.equal(model.legendEntries[0].max, 1000);
});

test('live sell offers do not invent volume or skew the historical sales average', () => {
  const merged = mergeLivePointsIntoHistory([history], [live]);
  assert.equal(merged[0].data.at(-1)?.item_count, 0);
  assert.equal(weightedAverage(merged[0].data), 11000 / 101);
  assert.equal(history.data.length, 2, 'input history must not be mutated');
});

test('one live observation creates a visible point with no historical response', () => {
  const model = prepareHistoryChart({ ...options, historyData: [], livePoints: [live] });
  assert.ok(model);
  assert.equal(model.chartPoints.length, 1);
  assert.equal(model.isolatedPoints.length, 1);
  assert.deepEqual(model.datasets[0].data, [1100]);
  assert.equal(model.legendEntries[0].last, 1100);
  assert.equal(model.legendEntries[0].avg, null, 'unknown sales average must remain unavailable');
  assert.equal(model.lineSegments.length, 0, 'do not invent a second observation');
  const position = projectLiveChartPoint(live.timestamp, live.value, model.projection);
  assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y));
});

test('a city omitted from the history API is still added by a live observation', () => {
  const martlock = { ...live, key: 'T4_BAG|Martlock|1', city: 'Martlock' as const };
  const model = prepareHistoryChart({ ...options, historyData: [history], livePoints: [martlock] });
  assert.ok(model);
  assert.deepEqual(model.legendEntries.map((entry) => entry.label), ['Caerleon', 'Martlock']);
  assert.equal(model.chartPoints.filter((point) => point.city === 'Martlock').length, 1);
});

test('decimated history chart includes the latest of six observations', () => {
  const data = Array.from({ length: 6 }, (_, index) => ({ timestamp: `2026-11-0${index + 1}T00:00:00Z`, avg_price: 100 + index, item_count: 1 }));
  const model = prepareHistoryChart({ ...options, historyData: [{ ...history, data }] });
  assert.ok(model);
  assert.equal(model.chartPoints.at(-1)?.timestamp, data.at(-1)?.timestamp);
  assert.equal(model.chartPoints.at(-1)?.value, 105);
  assert.equal(model.projection.timestamps.at(-1), data.at(-1)?.timestamp);
  assert.equal(model.chartPoints.length, 6, 'label reduction must not erase observations');
  assert.equal(model.isolatedPoints.length, 0, 'connected observations need no individual SVG nodes');
  assert.equal(model.labels.filter(Boolean).length, 5);
});

test('label decimation preserves isolated series and holes in other series', () => {
  const data = Array.from({ length: 6 }, (_, index) => ({ timestamp: `2026-11-0${index + 1}T00:00:00Z`, avg_price: 100 + index, item_count: 1 }));
  const model = prepareHistoryChart({ ...options, historyData: [
    { ...history, data: data.filter((_, index) => index !== 2) },
    { ...history, location: 'Martlock', data: [data[2]] },
  ] });
  assert.ok(model);
  assert.equal(model.chartPoints.find((point) => point.city === 'Martlock')?.timestamp, data[2].timestamp);
  assert.equal(model.isolatedPoints[0].city, 'Martlock');
  assert.deepEqual(model.lineSegments.map((segment) => segment.points.map((point) => point.timestamp)), [
    [data[0].timestamp, data[1].timestamp],
    [data[3].timestamp, data[4].timestamp, data[5].timestamp],
  ]);
  assert.equal(model.projection.minValue, 100);
  assert.ok(model.datasets.every((dataset) => dataset.data.every((value) => Number.isFinite(value) && value > 0)));
});

test('absent or invalid observations do not fabricate a chart or an average', () => {
  assert.equal(prepareHistoryChart({ ...options, historyData: [] }), null);
  assert.equal(prepareHistoryChart({ ...options, historyData: [], livePoints: [{ ...live, value: 0 }] }), null);
  assert.equal(weightedAverage([{ timestamp: live.timestamp, avg_price: 100, item_count: 0 }]), null);
  assert.equal(weightedAverage([{ timestamp: live.timestamp, avg_price: Infinity, item_count: 1 }]), null);
});

test('advisor uses the same volume-weighted mean and labels missing weights unknown', () => {
  const ctx = { item: { id: 'T4_BAG', n: 'Bag', t: '4', c: 'bag', sc: '', ss: '', iv: 0 }, prices: [], history7d: [history], history30d: [], quality: 1 as const };
  assert.match(buildAnalysisPrompt(ctx, 'en', true), /Caerleon: avg=108\.91 last=1000 \(818%\) vol=101/);
  const unknown = { ...ctx, history7d: [{ ...history, data: [{ ...history.data[0], item_count: 0 }] }] };
  assert.match(buildAnalysisPrompt(unknown, 'en', true), /avg=unknown last=100 \(unknown trend\)/);
});

test('screen consumes the tested model and draws observations even without a line segment', () => {
  const screen = readFileSync('screens/HistoryScreen.tsx', 'utf8');
  assert.match(screen, /prepareHistoryChart\(/);
  assert.match(screen, /chartInfo\.isolatedPoints\.map/);
  assert.match(screen, /<SvgCircle/);
  assert.doesNotMatch(screen, /if \(historyData\.length === 0\) return null/);
});
