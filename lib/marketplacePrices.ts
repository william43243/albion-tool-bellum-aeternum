import { priceObservation, type PriceData } from './api';
import { translateNumberInput } from './numberInputLocale';
import type { NumberLocale } from './numberParsing';

export interface ManualMarketplacePrices {
  // null follows the market quote; even an empty string is an explicit edit.
  buy: string | null;
  sell: string | null;
}

/** AODP fields describe the existing order side, not the user's action. */
export function resolveMarketplacePrices(
  quote: PriceData | null,
  useBuyOrder: boolean,
  useSellOrder: boolean,
  manual: ManualMarketplacePrices = { buy: null, sell: null },
  locale: NumberLocale = 'en',
) {
  // Immediate purchases consume the lowest sell offer (ask); immediate sales
  // consume the highest buy request (bid). New orders use their own side as a
  // reference price only: this is not an execution or liquidity guarantee.
  const buy = quote ? priceObservation(quote, useBuyOrder ? 'buy' : 'sell') : null;
  const sell = quote ? priceObservation(quote, useSellOrder ? 'sell' : 'buy') : null;
  const buyPrice = manual.buy ?? (buy ? translateNumberInput(String(buy.value), 'en', locale) : '');
  const sellPrice = manual.sell ?? (sell ? translateNumberInput(String(sell.value), 'en', locale) : '');
  const buyDate = manual.buy === null ? buy?.timestamp || '' : '';
  const sellDate = manual.sell === null ? sell?.timestamp || '' : '';
  return {
    buyPrice,
    sellPrice,
    priceDate: buyDate || sellDate ? { buy: buyDate, sell: sellDate } : null,
  };
}
