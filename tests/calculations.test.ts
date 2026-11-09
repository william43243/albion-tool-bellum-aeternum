import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  calculateFlipProfit,
  calculateCraftingFee,
  calculateMarketplaceProfit,
  breakEvenSellPrice,
  maxBuyPriceForTarget,
} from '../lib/calculations';
import type { MarketplaceStrategy } from '../lib/calculations';

test('marketplace separates buy and sell order fees', () => {
  const instant = calculateMarketplaceProfit(100, 200, 10, true, false, false);
  assert.deepEqual(
    { setupFeeBuy: instant.setupFeeBuy, setupFeeSell: instant.setupFeeSell, salesTax: instant.salesTax, netProfit: instant.netProfit },
    { setupFeeBuy: 0, setupFeeSell: 0, salesTax: 80, netProfit: 920 }
  );
  const buyOrderOnly = calculateMarketplaceProfit(100, 200, 10, true, true, false);
  assert.equal(buyOrderOnly.setupFeeBuy, 25);
  assert.equal(buyOrderOnly.setupFeeSell, 0);
  assert.equal(buyOrderOnly.netProfit, 895);
  const sellOrderOnly = calculateMarketplaceProfit(100, 200, 10, true, false, true);
  assert.equal(sellOrderOnly.setupFeeBuy, 0);
  assert.equal(sellOrderOnly.setupFeeSell, 50);
  assert.equal(sellOrderOnly.netProfit, 870);
});

test('marketplace rounds each fee once on the full order amount', () => {
  const result = calculateMarketplaceProfit(101, 101, 10, true, true, true);
  assert.equal(result.setupFeeBuy, 26);
  assert.equal(result.setupFeeSell, 26);
  assert.equal(result.salesTax, 41);
});

test('flipping ROI uses upfront capital rather than sale-time fees', () => {
  const result = calculateFlipProfit(100, 200, 10, true, true, true);
  assert.equal(result.upfrontInvestment, 1025);
  assert.equal(result.totalFees, 155);
  assert.equal(result.totalProfit, 845);
  assert.equal(result.roi, (845 / 1025) * 100);
});

test('crafting remains outside the flip calculation', () => {
  const result = calculateFlipProfit(100, 200, 10, true, false, false);
  assert.equal('crafting' in result, false);
  assert.equal(result.totalFees, 80);
});

test('break-even and target-profit prices respect selected strategy fees', () => {
  const breakEven = breakEvenSellPrice(100, 10, true, 'order-order');
  const maxBuy = maxBuyPriceForTarget(200, 10, true, 'order-order', 50);
  assert.ok(calculateMarketplaceProfit(100, breakEven, 10, true, true, true).netProfit >= 0);
  assert.ok(calculateMarketplaceProfit(maxBuy, 200, 10, true, true, true).profitPerItem >= 50);
  assert.ok(calculateMarketplaceProfit(maxBuy + 1, 200, 10, true, true, true).profitPerItem < 50);
});

test('break-even finds the first feasible price even when rounded sale fees make profit dip', () => {
  assert.equal(calculateMarketplaceProfit(182, 200, 1, true, true, true).netProfit, 0);
  assert.equal(calculateMarketplaceProfit(182, 201, 1, true, true, true).netProfit, -1);
  assert.equal(breakEvenSellPrice(182, 1, true, 'order-order'), 200);
  assert.equal(breakEvenSellPrice(364, 1, true, 'order-order'), 400);
  assert.equal(breakEvenSellPrice(748, 1, true, 'instant-order'), 800);
  assert.equal(breakEvenSellPrice(935, 1, true, 'instant-order'), 1000);
  assert.equal(breakEvenSellPrice(179, 1, false, 'instant-order'), 200);
});

test('maximum purchase price includes the last feasible integer', () => {
  assert.equal(maxBuyPriceForTarget(9, 1, true, 'instant-instant', 5), 3);
  assert.equal(maxBuyPriceForTarget(10, 1, true, 'instant-instant', 5), 4);
});

const strategies: MarketplaceStrategy[] = ['instant-instant', 'order-instant', 'instant-order', 'order-order'];

function profitAt(buy: number, sell: number, qty: number, premium: boolean, strategy: MarketplaceStrategy): number {
  return calculateMarketplaceProfit(buy, sell, qty, premium,
    strategy === 'order-instant' || strategy === 'order-order',
    strategy === 'instant-order' || strategy === 'order-order').netProfit;
}

test('thresholds match exhaustive integer search across fees, quantities and fractional targets', () => {
  for (const strategy of strategies) {
    for (const premium of [false, true]) {
      for (const qty of [1, 2, 7, 999]) {
        for (const target of [0, 0.5, 5]) {
          for (let amount = 0; amount <= 240; amount += 1) {
            const context = JSON.stringify({ strategy, premium, qty, target, amount });
            let expectedSell = 0;
            while (profitAt(amount, expectedSell, qty, premium, strategy) < target * qty) expectedSell += 1;
            assert.equal(breakEvenSellPrice(amount, qty, premium, strategy, target), expectedSell, `sale: ${context}`);

            let expectedBuy = 0;
            for (let buy = 0; buy <= amount; buy += 1) {
              if (profitAt(buy, amount, qty, premium, strategy) >= target * qty) expectedBuy = buy;
            }
            assert.equal(maxBuyPriceForTarget(amount, qty, premium, strategy, target), expectedBuy, `purchase: ${context}`);
          }
        }
      }
    }
  }
});

test('threshold helpers sanitize inputs and keep the zero sentinel for an impossible purchase target', () => {
  for (const invalid of [NaN, Infinity, -1]) {
    assert.equal(breakEvenSellPrice(invalid, 1, true, 'order-order'), 0);
    assert.equal(maxBuyPriceForTarget(invalid, 1, true, 'order-order'), 0);
    assert.equal(breakEvenSellPrice(182, invalid, true, 'order-order', invalid), 200);
    assert.equal(maxBuyPriceForTarget(9, invalid, true, 'instant-instant', invalid), 8);
  }
  assert.equal(breakEvenSellPrice(182, 1.9, true, 'order-order'), 200);
  assert.equal(breakEvenSellPrice(182.1, 1, true, 'order-order'), 203);
  assert.equal(maxBuyPriceForTarget(9.5, 1, true, 'instant-instant', 5), 3);
  assert.equal(maxBuyPriceForTarget(1, 1, true, 'instant-instant', 5), 0);
});

test('sale threshold stops when the result cannot be represented as a safe integer', () => {
  assert.equal(breakEvenSellPrice(Number.MAX_SAFE_INTEGER, 1, true, 'order-order'), Infinity);
  assert.equal(breakEvenSellPrice(Number.MAX_VALUE, Number.MAX_VALUE, true, 'order-order'), Infinity);
});

test('crafting rounds only the full order fee without a floating-point extra silver', () => {
  for (const [quantity, expected] of [[0, 0], [1, 20], [2, 39], [25, 486], [99, 1925], [100, 1944], [101, 1964]]) {
    assert.equal(calculateCraftingFee(640, 27, quantity).totalFee, expected);
  }
  assert.equal(calculateCraftingFee(639, 27, 100).totalFee, 1941);
  assert.equal(calculateCraftingFee(641, 27, 100).totalFee, 1948);
  assert.equal(calculateCraftingFee(640, 26, 100).totalFee, 1872);
  assert.equal(calculateCraftingFee(640, 28, 100).totalFee, 2016);
  assert.equal(calculateCraftingFee(640.000001, 27, 100).totalFee, 1945);
  assert.equal(calculateCraftingFee(800, 0.07, 1000).totalFee, 63);
});

test('crafting order fees match an integer-rational oracle for every catalog item value', () => {
  const catalog = JSON.parse(readFileSync('assets/items-db.json', 'utf8')) as { iv: number }[];
  const itemValues = [...new Set(catalog.map((item) => item.iv))].filter((value) => Number.isSafeInteger(value) && value > 0);
  assert.ok(itemValues.length > 0);
  for (const itemValue of itemValues) {
    for (let stationTax = 0; stationTax <= 1000; stationTax += 1) {
      for (const quantity of [1, 10, 100, 999]) {
        const numerator = BigInt(itemValue) * BigInt(stationTax) * BigInt(quantity) * BigInt(9);
        const expected = Number((numerator + BigInt(7999)) / BigInt(8000));
        assert.equal(calculateCraftingFee(itemValue, stationTax, quantity).totalFee, expected,
          JSON.stringify({ itemValue, stationTax, quantity }));
      }
    }
  }
});
