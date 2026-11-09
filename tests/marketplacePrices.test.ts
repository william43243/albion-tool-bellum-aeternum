import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { PriceData } from '../lib/api';
import { calculateMarketplaceProfit } from '../lib/calculations';
import { resolveMarketplacePrices } from '../lib/marketplacePrices';

// Public AODP Americas response retrieved 2026-11-05 at 02:43 UTC.
// See docs/marketplace-api-audit.md for the source and its limitations.
const quote: PriceData = {
  item_id: 'T4_BAG', city: 'Martlock', quality: 1,
  sell_price_min: 6973, sell_price_min_date: '2026-11-05T02:20:00',
  sell_price_max: 6979, sell_price_max_date: '2026-11-05T02:20:00',
  buy_price_min: 3, buy_price_min_date: '2026-11-05T00:35:00',
  buy_price_max: 3000, buy_price_max_date: '2026-11-05T00:35:00',
};

for (const [name, buyOrder, sellOrder, buy, sell, buyDate, sellDate] of [
  ['instant-instant', false, false, '6973', '3000', quote.sell_price_min_date, quote.buy_price_max_date],
  ['order-instant', true, false, '3000', '3000', quote.buy_price_max_date, quote.buy_price_max_date],
  ['instant-order', false, true, '6973', '6973', quote.sell_price_min_date, quote.sell_price_min_date],
  ['order-order', true, true, '3000', '6973', quote.buy_price_max_date, quote.sell_price_min_date],
] as const) {
  test(`${name} selects the matching order-book side and its own observation date`, () => {
    assert.deepEqual(resolveMarketplacePrices(quote, buyOrder, sellOrder), {
      buyPrice: buy, sellPrice: sell, priceDate: { buy: buyDate, sell: sellDate },
    });
  });
}

test('the observed spread is an instant loss, not a false arbitrage profit', () => {
  const prices = resolveMarketplacePrices(quote, false, false);
  const result = calculateMarketplaceProfit(Number(prices.buyPrice), Number(prices.sellPrice), 1, true, false, false);
  assert.equal(result.salesTax, 120);
  assert.equal(result.netProfit, -4093);
});

test('changing modes remaps the same stored quote without another network request', () => {
  const orders = resolveMarketplacePrices(quote, true, true);
  const instant = resolveMarketplacePrices(quote, false, false);
  assert.equal(orders.buyPrice, instant.sellPrice);
  assert.equal(orders.sellPrice, instant.buyPrice);
  assert.deepEqual(resolveMarketplacePrices(quote, true, true), orders);
});

test('manual prices survive mode changes and do not retain a misleading API timestamp', () => {
  for (const buyOrder of [false, true]) for (const sellOrder of [false, true]) {
    assert.deepEqual(resolveMarketplacePrices(quote, buyOrder, sellOrder, { buy: '1234', sell: '5678' }), {
      buyPrice: '1234', sellPrice: '5678', priceDate: null,
    });
  }
});

test('editing one side keeps the other side live and remappable', () => {
  assert.deepEqual(resolveMarketplacePrices(quote, false, false, { buy: '1234', sell: null }), {
    buyPrice: '1234', sellPrice: '3000', priceDate: { buy: '', sell: quote.buy_price_max_date },
  });
  assert.deepEqual(resolveMarketplacePrices(quote, false, true, { buy: '1234', sell: null }), {
    buyPrice: '1234', sellPrice: '6973', priceDate: { buy: '', sell: quote.sell_price_min_date },
  });
});

test('clearing a manual field does not silently refill it from the quote', () => {
  const result = resolveMarketplacePrices(quote, false, false, { buy: '', sell: null });
  assert.equal(result.buyPrice, '');
  assert.equal(result.priceDate?.buy, '');
});

for (const missingPrice of [0, -1, NaN, Infinity]) {
  test(`invalid ask ${missingPrice} never falls back to the bid`, () => {
    const prices = resolveMarketplacePrices({ ...quote, sell_price_min: missingPrice }, false, false);
    assert.equal(prices.buyPrice, '');
    assert.equal(prices.sellPrice, '3000');
    assert.equal(prices.priceDate?.buy, '');
  });
}

test('missing bid never fills an instant sale with an unrelated ask', () => {
  const prices = resolveMarketplacePrices({ ...quote, buy_price_max: 0, buy_price_max_date: '0001-01-01T00:00:00' }, false, false);
  assert.equal(prices.buyPrice, '6973');
  assert.equal(prices.sellPrice, '');
  assert.equal(prices.priceDate?.sell, '');
});

for (const invalidDate of ['', '0001-01-01T00:00:00', 'not-a-date']) {
  test(`a price with an unobserved timestamp (${invalidDate || 'empty'}) is not tradable`, () => {
    const prices = resolveMarketplacePrices({ ...quote, sell_price_min_date: invalidDate }, false, false);
    assert.equal(prices.buyPrice, '');
    assert.equal(prices.sellPrice, '3000');
    assert.equal(prices.priceDate?.buy, '');
  });
}

test('without a quote the calculator still supports manual inputs', () => {
  assert.deepEqual(resolveMarketplacePrices(null, true, true), { buyPrice: '', sellPrice: '', priceDate: null });
  assert.deepEqual(resolveMarketplacePrices(null, false, false, { buy: '10', sell: '20' }), {
    buyPrice: '10', sellPrice: '20', priceDate: null,
  });
});

test('Marketplace wires every query filter and unmount to request invalidation', () => {
  const source = readFileSync('screens/MarketplaceScreen.tsx', 'utf8');
  assert.match(source, /return \(\) => priceRequests\.invalidate\(\);\s*\}, \[server, selectedCity, quality, priceRequests\]\)/);
  assert.match(source, /return \(\) => watchRequests\.invalidate\(\);\s*\}, \[server, watchlistKey, watchRequests\]\)/);
  assert.match(source, /prices\.find\(\(p\) => p\.item_id === item\.id && p\.city === selectedCity && p\.quality === quality\)/);
  assert.match(source, /resolveMarketplacePrices\(liveQuote, flags\.useBuyOrder, flags\.useSellOrder/);
  assert.match(source, /fetchCurrentPrices\(item\.id, \[selectedCity\], server, quality, \{ forceRefresh: true \}\)/);
});
