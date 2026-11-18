import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIslandProfitChart, profitSegments, profitRuns, profitAxisRange, profitDayAtX, profitGesture } from '../lib/islandProfitChart';

function payload() {
  return {
    status: 'partial', chart_requested: true, history_days: 90, market_city: 'Fort Sterling', island_city: 'Fort Sterling',
    plot_count: 9, premium: true, focus_budget: 0,
    history: { status: 'ok', city: 'Fort Sterling', requested_days: 90, window_start: '2026-08-20T00:00:00Z', window_end_exclusive: '2026-11-18T00:00:00Z' },
    candidates: [
      { product_id: 'T4_TURNIP', name: 'Turnip', building: 'farm', estimated_profit_per_cycle: 250, history_usable_days: 2, profit_history: [[0, 100], [1, -50], [4, 300]] },
      { product_id: 'T8_YARROW', name: 'Ghoul Yarrow', building: 'herbgarden', estimated_profit_per_cycle: null, history_usable_days: null, profit_history: [] as number[][] },
    ],
  };
}
const parse = (data: unknown) => parseIslandProfitChart('compare_island_crops', JSON.stringify(data));

test('profit chart uses the requested UTC window and preserves losses and missing days', () => {
  const result = parse(payload());
  assert.equal(result?.kind, 'ready');
  if (result?.kind !== 'ready') return;
  assert.equal(result.chart.days, 90);
  assert.equal(result.chart.plots, 9);
  assert.equal(result.chart.partial, true);
  assert.deepEqual(result.chart.series[0].points, [{ day: 0, profit: 100 }, { day: 1, profit: -50 }, { day: 4, profit: 300 }]);
  assert.deepEqual(profitSegments(result.chart.series[0].points), [[{ day: 0, profit: 100 }, { day: 1, profit: -50 }]]);
  assert.equal(result.chart.series[1].averageProfit, null);
  assert.deepEqual(result.chart.series[1].points, []);
});

test('the chart is displayed only when requested and never fabricates missing data', () => {
  assert.equal(parseIslandProfitChart('get_history', JSON.stringify(payload())), null);
  assert.equal(parse({ ...payload(), chart_requested: false }), null);
  assert.deepEqual(parse({ ...payload(), history: { status: 'error' } }), { kind: 'unavailable' });
  const noPoints = payload(); noPoints.candidates[0].profit_history = [];
  assert.deepEqual(parse(noPoints), { kind: 'unavailable' });
});

test('rejects mismatched windows, invalid points and duplicate identities', () => {
  const invalidWindow = payload(); invalidWindow.history.window_end_exclusive = '2026-11-17T00:00:00Z';
  assert.deepEqual(parse(invalidWindow), { kind: 'unavailable' });
  const duplicateDay = payload(); duplicateDay.candidates[0].profit_history.push([1, 99]);
  assert.deepEqual(parse(duplicateDay), { kind: 'unavailable' });
  const outside = payload(); outside.candidates[0].profit_history.push([90, 1]);
  assert.deepEqual(parse(outside), { kind: 'unavailable' });
  const duplicateProduct = payload(); duplicateProduct.candidates[1].product_id = 'T4_TURNIP';
  assert.deepEqual(parse(duplicateProduct), { kind: 'unavailable' });
});

test('separate SVG runs preserve isolated observations and gaps', () => {
  const points = [{ day: 4, profit: 30 }, { day: 0, profit: -5 }, { day: 1, profit: 0 }, { day: 7, profit: 22 }];
  assert.deepEqual(profitRuns(points), [[points[1], points[2]], [points[0]], [points[3]]]);
  assert.deepEqual(profitRuns([]), []);
});

test('complete scale includes every value; optional zoom reports extreme points without removing them', () => {
  const points = Array.from({ length: 90 }, (_, day) => ({ day, profit: 100_000 + day * 100 }));
  points[30].profit = 1_319_831;
  points[60].profit = -500_000;
  const full = profitAxisRange(points, 'full');
  const zoom = profitAxisRange(points, 'zoom');
  assert.ok(full.low < -500_000 && full.high > 1_319_831);
  assert.equal(full.outside, 0);
  assert.ok(zoom.low > -500_000 && zoom.high < 1_319_831);
  assert.equal(zoom.outside, 2);
  assert.equal(points[30].profit, 1_319_831);
  assert.equal(points[60].profit, -500_000);
});

test('scales stay valid for empty, single, constant, negative and very short data', () => {
  assert.deepEqual(profitAxisRange([], 'zoom'), { low: -1, high: 1, outside: 0 });
  for (const points of [[{ day: 0, profit: 0 }], [{ day: 0, profit: -50 }, { day: 1, profit: -50 }], Array.from({ length: 30 }, (_, day) => ({ day, profit: 50 }))]) {
    for (const scale of ['full', 'zoom'] as const) {
      const range = profitAxisRange(points, scale);
      assert.ok(Number.isFinite(range.low) && Number.isFinite(range.high) && range.low < range.high);
      assert.equal(range.outside, 0);
    }
  }
});

test('touch selection clamps to the requested day range', () => {
  assert.equal(profitDayAtX(30, 60, 300, 90), 0);
  assert.equal(profitDayAtX(300, 60, 300, 90), 89);
  assert.equal(profitDayAtX(180, 60, 300, 90), 45);
  assert.equal(profitDayAtX(400, 60, 300, 90), 89);
  assert.equal(profitDayAtX(NaN, 60, 300, 90), 0);
});

test('horizontal drags select dates while vertical swipes remain scrolling gestures', () => {
  assert.equal(profitGesture(3, 2), 'tap');
  assert.equal(profitGesture(50, 5), 'horizontal');
  assert.equal(profitGesture(-40, 3), 'horizontal');
  assert.equal(profitGesture(2, 50), 'vertical');
  assert.equal(profitGesture(4, -50), 'vertical');
});
