import assert from 'node:assert/strict';
import test from 'node:test';
import { Quality, PriceData } from '../lib/api';
import { evaluateAllStrategies, evaluateOpportunity, rankOpportunities, type OpportunityInput } from '../lib/marketOpportunity';

const price = (city: string, sell: number, buy: number, quality: Quality = 4): PriceData => ({
  item_id: 'T4_BAG', city, quality, sell_price_min: sell, sell_price_min_date: sell ? '2026-09-07T10:00:00Z' : '0001-01-01T00:00:00',
  sell_price_max: 0, sell_price_max_date: '0001-01-01T00:00:00', buy_price_min: 0, buy_price_min_date: '0001-01-01T00:00:00',
  buy_price_max: buy, buy_price_max_date: buy ? '2026-09-07T10:01:00Z' : '0001-01-01T00:00:00',
});

test('keeps quality and server/item identity isolated', () => {
  const inputs = [
    { identity: { server: 'americas' as const, itemId: 'T4_BAG', quality: 4 as const }, buy: price('Caerleon', 100, 80, 4), sell: price('Caerleon', 100, 80, 4), isPremium: true },
    { identity: { server: 'americas' as const, itemId: 'T4_BAG', quality: 5 as const }, buy: price('Martlock', 10, 500, 5), sell: price('Martlock', 10, 500, 5), isPremium: true },
  ];
  assert.equal(rankOpportunities(inputs).length, 0);
});

test('examines valid alternatives instead of trusting one invalid extreme', () => {
  const mk = (city: string, sell: number, buy: number) => ({ identity: { server: 'americas' as const, itemId: 'T4_BAG', quality: 4 as const }, buy: price(city, sell, buy, 4), sell: price(city, sell, buy, 4), isPremium: true });
  const results = rankOpportunities([mk('Caerleon', 0, 1000), mk('Martlock', 100, 150), mk('Bridgewatch', 200, 250)]);
  assert.ok(results.some((r) => r.buyCity === 'Martlock' && r.sellCity === 'Bridgewatch'));
});

test('evaluates all four order strategies with distinct fees', () => {
  const result = evaluateAllStrategies({ identity: { server: 'americas', itemId: 'T4_BAG', quality: 4 }, buy: price('Martlock', 100, 80, 4), sell: price('Caerleon', 100, 200, 4), isPremium: true, quantity: 10 });
  assert.equal(result.length, 4);
  assert.equal(result.find((r) => r.mode === 'instant-instant')?.setupFeeBuy, 0);
  assert.ok((result.find((r) => r.mode === 'order-order')?.totalFees ?? 0) > 0);
});

const strategyInput: OpportunityInput = {
  identity: { server: 'americas', itemId: 'T4_BAG', quality: 4 },
  buy: { ...price('Martlock', 100, 80), sell_price_min_date: '2026-11-05T01:00:00Z', buy_price_max_date: '2026-11-05T01:05:00Z' },
  sell: { ...price('Caerleon', 100, 200), sell_price_min_date: '2026-11-05T02:00:00Z', buy_price_max_date: '2026-11-05T02:05:00Z' },
  isPremium: true, quantity: 10,
};

for (const [mode, buyPrice, sellPrice, buyTimestamp, sellTimestamp, profitPerUnit] of [
  ['instant-instant', 100, 200, strategyInput.buy.sell_price_min_date, strategyInput.sell.buy_price_max_date, 92],
  ['order-instant', 80, 200, strategyInput.buy.buy_price_max_date, strategyInput.sell.buy_price_max_date, 110],
  ['instant-order', 100, 100, strategyInput.buy.sell_price_min_date, strategyInput.sell.sell_price_min_date, -6.5],
  ['order-order', 80, 100, strategyInput.buy.buy_price_max_date, strategyInput.sell.sell_price_min_date, 11.5],
] as const) {
  test(`${mode} uses its four-way price selection with matching source dates`, () => {
    const result = evaluateOpportunity(strategyInput, mode);
    assert.ok(result);
    assert.equal(result.buyPrice, buyPrice);
    assert.equal(result.sellPrice, sellPrice);
    assert.equal(result.buyTimestamp, buyTimestamp);
    assert.equal(result.sellTimestamp, sellTimestamp);
    assert.equal(result.netProfitPerUnit, profitPerUnit);
    assert.equal(result.activity, 'unknown');
  });
}

test('all-strategy evaluation does not turn an instant-order loss into a false profit', () => {
  const results = evaluateAllStrategies(strategyInput);
  assert.equal(results.length, 4);
  assert.equal(results.find((result) => result.mode === 'instant-order')?.netProfitPerUnit, -6.5);
});

test('missing ask excludes instant purchases but still permits valid buy-order scenarios', () => {
  const input = { ...strategyInput, buy: { ...strategyInput.buy, sell_price_min: 0, sell_price_min_date: '0001-01-01T00:00:00' } };
  assert.deepEqual(evaluateAllStrategies(input).map((result) => result.mode), ['order-instant', 'order-order']);
});

test('missing bid excludes instant sales but still permits valid sell-order scenarios', () => {
  const input = { ...strategyInput, sell: { ...strategyInput.sell, buy_price_max: 0, buy_price_max_date: '0001-01-01T00:00:00' } };
  assert.deepEqual(evaluateAllStrategies(input).map((result) => result.mode), ['instant-order', 'order-order']);
});

test('a required side without its own valid timestamp is excluded without borrowing another date', () => {
  const input = { ...strategyInput, buy: { ...strategyInput.buy, buy_price_max_date: '0001-01-01T00:00:00' } };
  assert.deepEqual(evaluateAllStrategies(input).map((result) => result.mode), ['instant-instant', 'instant-order']);
});
