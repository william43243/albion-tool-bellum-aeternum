import { City, PriceData, Quality, Server, priceObservation } from './api';
import { calculateMarketplaceProfit } from './calculations';
import { getRoute, Route } from './routes';

export type TradeMode = 'instant-instant' | 'order-instant' | 'instant-order' | 'order-order';
export interface MarketIdentity { server: Server; itemId: string; quality: Quality; }
export interface OpportunityInput { identity: MarketIdentity; buy: PriceData; sell: PriceData; isPremium: boolean; quantity?: number; }
export interface Opportunity {
  identity: MarketIdentity; buyCity: City; sellCity: City; mode: TradeMode;
  buyPrice: number; sellPrice: number; buyTimestamp: string; sellTimestamp: string;
  quantity: number; setupFeeBuy: number; setupFeeSell: number; salesTax: number; totalFees: number;
  netProfitPerUnit: number; roiOnCommittedCapital: number; route: Route | null;
  activity: 'known' | 'unknown'; exclusionReasons: string[];
}

const MODES: Array<{ mode: TradeMode; buyOrder: boolean; sellOrder: boolean }> = [
  { mode: 'instant-instant', buyOrder: false, sellOrder: false },
  { mode: 'order-instant', buyOrder: true, sellOrder: false },
  { mode: 'instant-order', buyOrder: false, sellOrder: true },
  { mode: 'order-order', buyOrder: true, sellOrder: true },
];

export function compatibleIdentity(a: MarketIdentity, b: MarketIdentity): boolean {
  return a.server === b.server && a.itemId === b.itemId && a.quality === b.quality;
}

export function evaluateOpportunity(input: OpportunityInput, mode: TradeMode): Opportunity | null {
  const { identity, buy, sell, isPremium } = input;
  if (buy.item_id !== identity.itemId || sell.item_id !== identity.itemId || buy.quality !== identity.quality || sell.quality !== identity.quality) return null;
  const selected = MODES.find((m) => m.mode === mode);
  if (!selected) return null;
  // The API side names describe existing orders. Instant actions consume the
  // opposite side; a new order uses its own side as a non-guaranteed target.
  const buyObs = priceObservation(buy, selected.buyOrder ? 'buy' : 'sell');
  const sellObs = priceObservation(sell, selected.sellOrder ? 'sell' : 'buy');
  if (!buyObs || !sellObs || buy.city === sell.city) return null;
  const quantity = Math.max(1, Math.floor(input.quantity ?? 1));
  const result = calculateMarketplaceProfit(buyObs.value, sellObs.value, quantity, isPremium, selected.buyOrder, selected.sellOrder);
  const route = getRoute(buy.city, sell.city);
  const capital = buyObs.value * quantity + result.setupFeeBuy;
  return {
    identity, buyCity: buy.city as City, sellCity: sell.city as City, mode,
    buyPrice: buyObs.value, sellPrice: sellObs.value, buyTimestamp: buyObs.timestamp, sellTimestamp: sellObs.timestamp,
    quantity, setupFeeBuy: result.setupFeeBuy, setupFeeSell: result.setupFeeSell, salesTax: result.salesTax, totalFees: result.totalFees,
    netProfitPerUnit: result.profitPerItem, roiOnCommittedCapital: capital > 0 ? (result.netProfit / capital) * 100 : 0,
    route, activity: 'unknown', exclusionReasons: [],
  };
}

/** Generate every compatible city pair before ranking; stale extremes cannot hide valid alternatives. */
export function rankOpportunities(inputs: OpportunityInput[], mode: TradeMode = 'instant-instant'): Opportunity[] {
  const candidates: Opportunity[] = [];
  for (const input of inputs) {
    for (const other of inputs) {
      if (input === other || !compatibleIdentity(input.identity, other.identity)) continue;
      const candidate = evaluateOpportunity({ ...input, buy: input.buy, sell: other.sell }, mode);
      if (candidate && candidate.netProfitPerUnit > 0) candidates.push(candidate);
    }
  }
  return candidates.sort((a, b) => b.netProfitPerUnit - a.netProfitPerUnit || b.roiOnCommittedCapital - a.roiOnCommittedCapital || a.buyCity.localeCompare(b.buyCity) || a.sellCity.localeCompare(b.sellCity));
}

export function evaluateAllStrategies(input: OpportunityInput): Opportunity[] {
  return MODES.map(({ mode }) => evaluateOpportunity(input, mode)).filter((value): value is Opportunity => value !== null);
}
