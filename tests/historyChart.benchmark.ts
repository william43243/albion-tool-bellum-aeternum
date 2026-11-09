/** Run locally: node node_modules/tsx/dist/cli.mjs tests/historyChart.benchmark.ts */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createLiveChartPointProjector, createLiveChartProjection, projectLiveChartPoint } from '../lib/liveChart';

// Synthetic data only. This measures JS coordinate work, not API density,
// SVG serialization, React/native layout, device frame rate, or peak memory.
for (const [axisLength, seriesCount] of [[2160, 1], [8760, 21]]) {
  const timestamps = Array.from({ length: axisLength }, (_, index) => new Date(Date.UTC(2025, 0, 1) + index * 3600000).toISOString());
  const projection = createLiveChartProjection(timestamps, [100, 300], 400);
  const buildStart = performance.now();
  const project = createLiveChartPointProjector(projection);
  const buildMs = performance.now() - buildStart;
  const reference = (timestamp: string, value: number) => projectLiveChartPoint(timestamp, value, projection);
  const observations = axisLength * seriesCount;

  // Check every indexed result against the independent chart index/value
  // equations, outside the timed loops, including all repeated city series.
  for (let index = 0; index < observations; index += 1) {
    const axisIndex = index % axisLength;
    const value = 100 + index % 201;
    const actual = project(timestamps[axisIndex], value);
    assert.equal(actual.x, 64 + axisIndex * (400 - 64) / axisLength);
    assert.equal(actual.y, (220 - 220 * ((value - 100) / 200)) / 4 * 3 + 16);
  }
  for (let index = 0; index < 1000; index += 1) {
    reference(timestamps[index % axisLength], 150);
    project(timestamps[index % axisLength], 150);
  }
  function measure(projector: typeof project) {
    let checksum = 0;
    const start = performance.now();
    for (let index = 0; index < observations; index += 1) {
      const point = projector(timestamps[index % axisLength], 100 + index % 201);
      checksum += point.x + point.y;
    }
    return { milliseconds: performance.now() - start, checksum };
  }
  const linearMs: number[] = [];
  const indexedMs: number[] = [];
  for (let trial = 0; trial < 3; trial += 1) {
    const linear = measure(reference);
    const indexed = measure(project);
    assert.equal(indexed.checksum, linear.checksum);
    linearMs.push(linear.milliseconds);
    indexedMs.push(indexed.milliseconds);
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[1];
  console.log(JSON.stringify({ axisLength, observations, trials: 3,
    buildMs: Number(buildMs.toFixed(3)),
    linearMedianMs: Number(median(linearMs).toFixed(3)),
    indexedMedianMs: Number(median(indexedMs).toFixed(3)),
    coordinatesVerified: observations, checksumMatched: true,
  }));
}
