import { CITIES, priceObservation, type City, type PriceData, type Quality } from './api';

/** Coverage of observed prices, not a freshness, liquidity, or execution claim. */
export function summarizeWatchlistPrices(prices: PriceData[], itemId: string, quality: Quality) {
  const matching = prices.filter((price) => price.item_id === itemId && price.quality === quality && CITIES.includes(price.city as City));
  const cities = new Set(matching
    .filter((price) => priceObservation(price, 'buy') || priceObservation(price, 'sell'))
    .map((price) => price.city));
  return { hasResponse: matching.length > 0, count: cities.size };
}
