import { parseAodpTimestamp } from './aodpTime';

export interface MarketPriceObservation {
  item_id: string;
  city: string;
  quality: number;
  sell_price_min: number;
  sell_price_min_date: string;
  buy_price_max: number;
  buy_price_max_date: string;
}

export interface MarketHistoryObservation {
  location: string;
  item_id: string;
  quality: number;
  data: Array<{ item_count: number }>;
}

export interface MarketGuardrails {
  /** Configurable heuristic, not a game rule. */
  maxAgeHours: number;
  /** Configurable seven-day observed-volume heuristic, not executable depth. */
  minVolume7d: number;
}

export interface MarketSignalAssessment {
  status: 'eligible-signal' | 'rejected';
  quality: number | null;
  buyCity: string | null;
  sellCity: string | null;
  buyPrice: number | null;
  sellPrice: number | null;
  salesTax: number | null;
  directProfit: number | null;
  buyVolume7d: number | null;
  sellVolume7d: number | null;
  reasons: string[];
  limitations: string[];
}

const finitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;

function ageHours(dateString: string, nowMs: number): number | null {
  const timestamp = parseAodpTimestamp(dateString);
  if (timestamp === null) return null;
  return (nowMs - timestamp) / 3600000;
}

function observedVolume(
  history: MarketHistoryObservation[],
  itemId: string,
  location: string,
  quality: number
): number {
  return history
    .filter((entry) => entry.item_id === itemId && entry.location === location && entry.quality === quality)
    .flatMap((entry) => Array.isArray(entry.data) ? entry.data : [])
    .reduce((sum, point) => sum + (finitePositive(point.item_count) ? point.item_count : 0), 0);
}

/**
 * Assess the global lowest sell and highest buy observations fail-closed.
 * The result is only a signal: AODP observations do not expose guaranteed
 * executable depth, transport cost or transport risk.
 */
export function selectCompatibleMarketSignal(
  prices: MarketPriceObservation[],
  history7d: MarketHistoryObservation[],
  taxRate: number,
  nowMs: number,
  guardrails: MarketGuardrails
): MarketSignalAssessment {
  const reasons: string[] = [];
  const limitations = [
    'AODP observations are not guaranteed executable order-book depth.',
    'Transport cost, travel time and route risk are not included in direct profit.',
    `Freshness (${guardrails.maxAgeHours}h) and volume (${guardrails.minVolume7d}/7d) limits are configurable heuristics.`,
  ];
  const rejected = (): MarketSignalAssessment => ({
    status: 'rejected', quality: null, buyCity: null, sellCity: null,
    buyPrice: null, sellPrice: null, salesTax: null, directProfit: null,
    buyVolume7d: null, sellVolume7d: null, reasons, limitations,
  });

  if (!Array.isArray(prices) || !Array.isArray(history7d)) {
    reasons.push('missing market observations');
    return rejected();
  }
  const sells = prices.filter((entry) => finitePositive(entry.sell_price_min));
  const buys = prices.filter((entry) => finitePositive(entry.buy_price_max));
  if (sells.length === 0 || buys.length === 0) {
    reasons.push('missing sell or buy observation');
    return rejected();
  }

  const cheapest = sells.reduce((best, entry) => entry.sell_price_min < best.sell_price_min ? entry : best);
  const priciest = buys.reduce((best, entry) => entry.buy_price_max > best.buy_price_max ? entry : best);
  if (!cheapest.item_id || cheapest.item_id !== priciest.item_id) {
    reasons.push('item identity mismatch');
  }
  if (!Number.isInteger(cheapest.quality) || cheapest.quality <= 0 || cheapest.quality !== priciest.quality) {
    reasons.push('quality mismatch between best buy and sell observations');
  }
  if (reasons.length > 0) return rejected();

  const buyAge = ageHours(cheapest.sell_price_min_date, nowMs);
  const sellAge = ageHours(priciest.buy_price_max_date, nowMs);
  const maxAge = Number.isFinite(guardrails.maxAgeHours) && guardrails.maxAgeHours >= 0
    ? guardrails.maxAgeHours : 0;
  if (buyAge === null || sellAge === null) reasons.push('missing or invalid observation timestamp');
  if (buyAge !== null && buyAge < 0) reasons.push('buy observation timestamp is in the future');
  if (sellAge !== null && sellAge < 0) reasons.push('sell observation timestamp is in the future');
  if (buyAge !== null && buyAge > maxAge) reasons.push('buy observation exceeds configured freshness limit');
  if (sellAge !== null && sellAge > maxAge) reasons.push('sell observation exceeds configured freshness limit');

  const quality = cheapest.quality;
  const buyVolume7d = observedVolume(history7d, cheapest.item_id, cheapest.city, quality);
  const sellVolume7d = observedVolume(history7d, priciest.item_id, priciest.city, quality);
  const minVolume = Number.isFinite(guardrails.minVolume7d) && guardrails.minVolume7d >= 0
    ? guardrails.minVolume7d : 0;
  if (buyVolume7d < minVolume) reasons.push('buy-side observed volume is below the configured minimum');
  if (sellVolume7d < minVolume) reasons.push('sell-side observed volume is below the configured minimum');

  const safeTaxRate = Number.isFinite(taxRate) ? Math.min(1, Math.max(0, taxRate)) : 0;
  const salesTax = Math.ceil(priciest.buy_price_max * safeTaxRate);
  const directProfit = priciest.buy_price_max - cheapest.sell_price_min - salesTax;
  if (directProfit <= 0) reasons.push('direct profit is not positive after sales tax');

  return {
    status: reasons.length === 0 ? 'eligible-signal' : 'rejected',
    quality,
    buyCity: cheapest.city,
    sellCity: priciest.city,
    buyPrice: cheapest.sell_price_min,
    sellPrice: priciest.buy_price_max,
    salesTax,
    directProfit,
    buyVolume7d,
    sellVolume7d,
    reasons,
    limitations,
  };
}
