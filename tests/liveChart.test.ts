import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveChartPointProjector, createLiveChartProjection, decimateLiveTimestamps, getPositiveValueBounds, projectLiveChartPoint, unionLiveTimestamps, splitLiveChartLineSegments } from '../lib/liveChart';
import type { LiveChartSeries } from '../lib/liveChart';

test('live chart uses a stable union axis and explicit null holes', () => {
  const a = ['2026-09-10T00:00:00Z', '2026-09-10T02:00:00Z'];
  const b = ['2026-09-10T01:00:00Z', '2026-09-10T02:00:00Z'];
  assert.deepEqual(unionLiveTimestamps([{ timestamps: a }, { timestamps: b }]), [a[0], b[0], a[1]]);
  assert.deepEqual([10, undefined, 12].map((v) => v ?? null), [10, null, 12]);
});

test('chart decimation is shared by labels, values and projection', () => {
  const timestamps = decimateLiveTimestamps(['2026-09-10T00:00:00Z', '2026-09-10T01:00:00Z', '2026-09-10T02:00:00Z', '2026-09-10T03:00:00Z', '2026-09-10T04:00:00Z', '2026-09-10T05:00:00Z'], 5);
  const projection = createLiveChartProjection(timestamps, [100, 200, 300, 400, 500], 600);
  const first = projectLiveChartPoint(timestamps[0], 100, projection);
  const last = projectLiveChartPoint(timestamps.at(-1)!, 500, projection);
  assert.equal(first.x, projection.left);
  assert.equal(first.y, projection.bottom);
  assert.equal(last.x, projection.right);
  assert.equal(last.y, projection.top);
  assert.equal(timestamps[0], '2026-09-10T00:00:00Z');
  assert.equal(timestamps.at(-1), '2026-09-10T05:00:00Z');
  assert.equal(timestamps.length, 5);
});

test('decimation respects limits and retains chronological endpoints', () => {
  const timestamps = Array.from({ length: 17 }, (_, index) => String(index));
  for (const limit of [2, 3, 5, 10]) {
    const result = decimateLiveTimestamps(timestamps, limit);
    assert.equal(result.length, limit);
    assert.equal(new Set(result).size, limit);
    assert.equal(result[0], '0');
    assert.equal(result.at(-1), '16');
  }
  assert.deepEqual(decimateLiveTimestamps(timestamps, 1), ['16']);
  assert.deepEqual(decimateLiveTimestamps(timestamps, 0), []);
  assert.deepEqual(decimateLiveTimestamps([], 5), []);
});

test('projection uses chart-kit padding and index/value formulas exactly', () => {
  const timestamps = ['a', 'b', 'c'];
  const projection = createLiveChartProjection(timestamps, [100, 200], 400, 220);
  assert.deepEqual(projectLiveChartPoint('b', 150, projection), { x: 176, y: 98.5 });
  assert.equal(projection.left, 64);
  assert.equal(projection.right, 288);
});

test('projection clamps overlay points to the same chart bounds', () => {
  const timestamps = ['2026-09-10T00:00:00Z', '2026-09-10T01:00:00Z'];
  const projection = createLiveChartProjection(timestamps, [100, 200], 400);
  const point = projectLiveChartPoint(timestamps[1], 999, projection);
  assert.deepEqual(point, { x: projection.right, y: projection.top });
});

test('dashed segment poll endpoint is projected to a later x position', () => {
  const from = '2026-09-10T12:00:00Z';
  const to = '2026-09-10T12:05:00Z';
  const timestamps = unionLiveTimestamps([{ timestamps: [from] }, { timestamps: [to] }]);
  const projection = createLiveChartProjection(timestamps, [100, 100], 400);
  assert.ok(projectLiveChartPoint(to, 100, projection).x > projectLiveChartPoint(from, 100, projection).x);
});

test('sparse series become separate render segments around null timestamps', () => {
  const timestamps = ['a', 'b', 'c', 'd'];
  const points = (['a', 'b', 'd'] as const).map((timestamp, i) => ({ key: 'k', itemId: 'T4_BAG', city: 'Caerleon' as const, quality: 1 as const, timestamp, value: i + 1 }));
  const series: LiveChartSeries[] = [{ key: 'k', city: 'Caerleon', color: '#fff', points, dashedSegments: [] }];
  assert.deepEqual(splitLiveChartLineSegments(series, timestamps).map((segment) => segment.points.map((point) => point.timestamp)), [['a', 'b']]);
});

test('positive bounds preserve empty, invalid, constant and extreme-value domains', () => {
  assert.deepEqual(getPositiveValueBounds([]), { minValue: 0, maxValue: 1 });
  assert.deepEqual(getPositiveValueBounds([NaN, Infinity, -Infinity, 0, -1]), { minValue: 0, maxValue: 1 });
  assert.deepEqual(getPositiveValueBounds([42, 42, NaN]), { minValue: 42, maxValue: 42 });
  assert.deepEqual(getPositiveValueBounds([Number.MAX_VALUE, Number.MIN_VALUE]), {
    minValue: Number.MIN_VALUE, maxValue: Number.MAX_VALUE,
  });
  assert.deepEqual(getPositiveValueBounds(new Set([200, 50, 100]).values()), { minValue: 50, maxValue: 200 });
});

test('projection aggregates hundreds of thousands of values without argument-limit errors', () => {
  const values = Array.from({ length: 183960 }, () => 100);
  values[123456] = 0.25;
  values[values.length - 1] = 900000;
  const timestamps = ['2026-01-01T00:00:00Z', '2026-12-31T23:00:00Z'];
  const projection = createLiveChartProjection(timestamps, values, 400);
  assert.equal(projection.minValue, 0.25);
  assert.equal(projection.maxValue, 900000);
  assert.deepEqual(projection.timestamps, timestamps);
  assert.notEqual(projection.timestamps, timestamps, 'projection retains its own axis array');
  assert.deepEqual(projectLiveChartPoint(timestamps[0], 0.25, projection), { x: projection.left, y: projection.bottom });
  assert.deepEqual(projectLiveChartPoint(timestamps[1], 900000, projection), { x: projection.right, y: projection.top });
  assert.equal(values.length, 183960, 'aggregation does not truncate caller data');
});

test('reusable projector matches one-shot coordinates for exact, interpolated and invalid timestamps', () => {
  const first = '2026-01-01T00:00:00Z';
  const last = '2026-01-01T02:00:00Z';
  for (const axis of [[], [first], [first, last], [first, first, last], ['invalid', first, last], [last, first]]) {
    for (const values of [[], [100], [100, 300]]) {
      const projection = createLiveChartProjection(axis, values, 400);
      const project = createLiveChartPointProjector(projection);
      for (const timestamp of [first, last, '2026-01-01T01:00:00Z', '2025-12-31T23:00:00Z', '2026-01-02T00:00:00Z', 'invalid', '']) {
        for (const value of [0, 100, 200, 300, 999, NaN, Infinity]) {
          assert.deepEqual(project(timestamp, value), projectLiveChartPoint(timestamp, value, projection));
        }
      }
    }
  }
});

test('reusable projector has a clear snapshot lifetime and rebuilds for a changed axis/domain', () => {
  const projection = createLiveChartProjection(['a', 'b'], [100, 200], 400);
  const project = createLiveChartPointProjector(projection);
  const before = projectLiveChartPoint('b', 200, projection);
  projection.timestamps.reverse();
  projection.maxValue = 300;
  projection.width = 600;
  assert.deepEqual(project('b', 200), before, 'old render snapshot must not mix new axis with old indices');
  assert.deepEqual(createLiveChartPointProjector(projection)('b', 200), projectLiveChartPoint('b', 200, projection));
  assert.notDeepEqual(project('b', 200), projectLiveChartPoint('b', 200, projection));
});

test('reusable projector does not perform an indexOf scan for each exact-axis observation', () => {
  const timestamps = Array.from({ length: 8760 }, (_, index) => String(index));
  const projection = createLiveChartProjection(timestamps, [100, 200], 400);
  const project = createLiveChartPointProjector(projection);
  const original = Array.prototype.indexOf;
  let scans = 0;
  Array.prototype.indexOf = function (...args) { scans += 1; return original.apply(this, args); };
  try {
    for (const timestamp of timestamps) project(timestamp, 150);
  } finally {
    Array.prototype.indexOf = original;
  }
  assert.equal(scans, 0);
});
