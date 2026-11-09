import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateAdvisorDecision, formatAdvisorDecision, ADVISOR_PRICE_MAX_AGE_MS } from '../lib/advisorDecision';
import type { MarketContext } from '../lib/advisor';
import type { PriceData } from '../lib/api';

const now = Date.parse('2026-11-05T15:00:00Z');
const iso = (time: number) => new Date(time).toISOString();
function price(city: string, sell: number, buy: number, date = iso(now)): PriceData {
  return { item_id: 'T4_BAG', quality: 1, city, sell_price_min: sell, sell_price_max: sell,
    buy_price_min: buy, buy_price_max: buy, sell_price_min_date: date, sell_price_max_date: date,
    buy_price_min_date: date, buy_price_max_date: date };
}
function context(): MarketContext {
  return { server: 'americas', item: { id: 'T4_BAG', n: "Adept's Bag", t: '4', c: 'equipment', sc: '', ss: '', iv: 0 }, quality: 1,
    prices: [price('Martlock', 100, 0), price('Bridgewatch', 0, 200)], history30d: [],
    history7d: ['Martlock', 'Bridgewatch'].map((location) => ({ item_id: 'T4_BAG', quality: 1, location,
      data: [{ avg_price: 150, item_count: 20, timestamp: iso(now) }] })),
  };
}

test('S22 counterexample is an exact canonical loss, never a positive signal', () => {
  const ctx = context(); ctx.prices = [price('Bridgewatch', 3796, 0), price('Thetford', 0, 2993)];
  for (const [premium, tax, net] of [[true, 120, -923], [false, 240, -1043]] as const) {
    const result = evaluateAdvisorDecision(ctx, 'americas', premium, now);
    assert.equal(result.status, 'loss'); assert.equal(result.eligiblePairCount, 0);
    assert.equal(result.candidate?.salesTax, tax); assert.equal(result.candidate?.netProfit, net);
    assert.ok(result.reasons.includes('non-positive'));
    for (const lang of ['fr', 'en', 'es'] as const) {
      const report = formatAdvisorDecision(result, lang);
      assert.match(report, new RegExp(`2993 − 3796 − ${tax} = ${net}`));
      assert.match(report, /non généré|not AI-generated|no generado/);
      assert.doesNotMatch(report, /VERDICT: BUY|VERDICT: ACHETER|VEREDICTO: COMPRAR/);
    }
  }
});

test('a screened positive observation is not an automatic buy or guaranteed fill', () => {
  const result = evaluateAdvisorDecision(context(), 'americas', true, now);
  assert.equal(result.status, 'positive-observation'); assert.equal(result.candidate?.netProfit, 92);
  assert.equal(result.candidate?.salesTax, 8); assert.equal(result.eligiblePairCount, 1);
  const report = formatAdvisorDecision(result, 'en');
  assert.match(report, /not a buy recommendation/); assert.match(report, /Order depth, fills and transport costs are unverified/);
  assert.match(report, /2026-11-05T15:00:00.000Z/); assert.match(report, /Premium/);
});

test('zero profit is distinguished from missing data', () => {
  const ctx = context(); ctx.prices = [price('Martlock', 96, 0), price('Bridgewatch', 0, 100)];
  assert.equal(evaluateAdvisorDecision(ctx, 'americas', true, now).status, 'zero');
  ctx.prices = []; assert.equal(evaluateAdvisorDecision(ctx, 'americas', true, now).status, 'unavailable');
});

test('infinite, NaN, negative, fractional, zero or unsafe purchases cannot become free purchases via sanitizer', () => {
  for (const invalid of [Infinity, NaN, -1, 0, 0.5, Number.MAX_SAFE_INTEGER]) {
    const ctx = context(); ctx.prices[0].sell_price_min = invalid;
    const result = evaluateAdvisorDecision(ctx, 'americas', true, now);
    assert.equal(result.status, 'unavailable', String(invalid)); assert.equal(result.candidate, null);
  }
});

test('future, sentinel, impossible and missing price timestamps are rejected', () => {
  for (const date of ['2099-01-01T00:00:00', '0001-01-01T00:00:00', '2026-02-30T00:00:00Z', '2026-11-05T24:00:00Z', '', 'bad', iso(now + 1)]) {
    const ctx = context(); ctx.prices[0].sell_price_min_date = date;
    assert.equal(evaluateAdvisorDecision(ctx, 'americas', true, now).status, 'unavailable', date);
  }
});

test('24 hours is an explicit inclusive boundary; older data is blocked', () => {
  const ctx = context(); ctx.prices[0].sell_price_min_date = iso(now - ADVISOR_PRICE_MAX_AGE_MS);
  assert.equal(evaluateAdvisorDecision(ctx, 'americas', true, now).status, 'positive-observation');
  ctx.prices[0].sell_price_min_date = iso(now - ADVISOR_PRICE_MAX_AGE_MS - 1);
  const result = evaluateAdvisorDecision(ctx, 'americas', true, now);
  assert.equal(result.status, 'unconfirmed'); assert.ok(result.reasons.includes('stale-buy'));
});

test('server provenance, item, quality and duplicate cities fail closed', () => {
  for (const server of ['europe', undefined] as const) {
    const ctx = context(); ctx.server = server;
    assert.equal(evaluateAdvisorDecision(ctx, 'americas', true, now).status, 'unavailable');
  }
  for (const patch of [{ item_id: 'T4_ROCK' }, { quality: 5 }, { city: 'Unknown' }]) {
    const ctx = context(); Object.assign(ctx.prices[0], patch);
    assert.equal(evaluateAdvisorDecision(ctx, 'americas', true, now).status, 'unavailable');
  }
  const ctx = context(); ctx.prices.push(price('Martlock', 1, 0));
  assert.equal(evaluateAdvisorDecision(ctx, 'americas', true, now).status, 'unavailable');
});

test('invalid, low, stale or duplicated activity cannot establish eligibility in either city', () => {
  for (const index of [0, 1]) for (const patch of [
    { item_count: NaN }, { item_count: -1 }, { item_count: 0 }, { item_count: 14 },
    { avg_price: Infinity }, { timestamp: iso(now + 1) }, { timestamp: iso(now - 49 * 3600000) },
  ]) {
    const ctx = context(); Object.assign(ctx.history7d[index].data[0], patch);
    const result = evaluateAdvisorDecision(ctx, 'americas', true, now);
    assert.equal(result.status, 'unconfirmed'); assert.equal(result.eligiblePairCount, 0);
  }
  const duplicate = context(); duplicate.history7d[0].data.push({ ...duplicate.history7d[0].data[0] });
  assert.equal(evaluateAdvisorDecision(duplicate, 'americas', true, now).status, 'unconfirmed');
  const missing = context(); missing.history7d = [missing.history7d[0]];
  assert.equal(evaluateAdvisorDecision(missing, 'americas', true, now).status, 'unconfirmed');
});

test('fractional historical averages are valid; zero observed activity differs from unknown', () => {
  const ctx = context(); ctx.history7d[0].data[0].avg_price = 150.5;
  assert.equal(evaluateAdvisorDecision(ctx, 'americas', true, now).status, 'positive-observation');
  ctx.history7d[0].data[0].avg_price = 0; ctx.history7d[0].data[0].item_count = 0;
  const zero = evaluateAdvisorDecision(ctx, 'americas', true, now);
  assert.equal(zero.status, 'unconfirmed'); assert.equal(zero.candidate?.buyVolume, 0);
  ctx.history7d = [];
  assert.equal(evaluateAdvisorDecision(ctx, 'americas', true, now).candidate?.buyVolume, null);
});

test('red-zone and unknown routes do not produce a screened positive observation', () => {
  for (const city of ['Caerleon', 'Brecilien']) {
    const ctx = context(); ctx.prices[1].city = city; ctx.history7d[1].location = city;
    const result = evaluateAdvisorDecision(ctx, 'americas', true, now);
    assert.equal(result.status, 'unconfirmed'); assert.ok(result.reasons.includes('route'));
  }
});

test('a stale extreme cannot conceal an otherwise eligible pair', () => {
  const ctx = context(); ctx.prices.push(price('Caerleon', 1, 0, iso(now - 48 * 3600000)));
  const result = evaluateAdvisorDecision(ctx, 'americas', true, now);
  assert.equal(result.status, 'positive-observation'); assert.equal(result.candidate?.buy.city, 'Martlock');
  assert.equal(result.pairCount, 2); assert.equal(result.eligiblePairCount, 1);
});
