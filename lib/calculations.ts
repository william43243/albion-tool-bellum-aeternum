// Albion Online Tax & Fee Calculator - Core Formulas
// Sources: wiki.albiononline.com/wiki/Marketplace, wiki.albiononline.com/wiki/Margin

/**
 * Defensive input sanitizer: coerces any value into a finite number >= 0.
 * Guards against NaN / Infinity / negative inputs that would otherwise
 * propagate into the UI as "NaN" or "-∞".
 */
function sanitizeAmount(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

/** Sanitizes a quantity into a finite, non-negative integer. */
function sanitizeQuantity(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

export interface MarketplaceResult {
  buyPrice: number;
  sellPrice: number;
  quantity: number;
  setupFeeBuy: number;
  setupFeeSell: number;
  salesTax: number;
  totalFees: number;
  netProfit: number;
  profitPerItem: number;
  feePercentage: number;
  marginPercentage: number;
}

export type MarketplaceStrategy = 'instant-instant' | 'order-instant' | 'instant-order' | 'order-order';

export function strategyFlags(strategy: MarketplaceStrategy): { useBuyOrder: boolean; useSellOrder: boolean } {
  return {
    useBuyOrder: strategy === 'order-instant' || strategy === 'order-order',
    useSellOrder: strategy === 'instant-order' || strategy === 'order-order',
  };
}

/**
 * Lowest whole-silver sale price meeting the requested profit.
 * Returns Infinity if no safe integer price can represent the result.
 */
export function breakEvenSellPrice(buyPrice: number, quantity: number, isPremium: boolean, strategy: MarketplaceStrategy, targetProfitPerItem = 0): number {
  const flags = strategyFlags(strategy);
  buyPrice = sanitizeAmount(buyPrice);
  const qty = Math.max(1, sanitizeQuantity(quantity));
  const target = sanitizeAmount(targetProfitPerItem) * qty;
  const purchase = calculateMarketplaceProfit(buyPrice, 0, qty, isPremium, flags.useBuyOrder, flags.useSellOrder);
  const netRevenueRate = 1 - (isPremium ? 0.04 : 0.08) - (flags.useSellOrder ? 0.025 : 0);
  const estimate = (buyPrice * qty + purchase.setupFeeBuy + target) / qty / netRevenueRate;

  // Unrounded sale fees give a lower bound. Rounding both sale fees can make
  // profit fall when the sale price increases, so binary search is not valid.
  // Start just below that bound to allow for floating-point roundoff, then
  // check each nearby integer with the actual, separately rounded fees.
  const roundoff = Math.max(1, estimate * Number.EPSILON * 8);
  let price = Math.max(0, Math.floor(estimate - roundoff));
  while (Number.isSafeInteger(price)) {
    if (calculateMarketplaceProfit(buyPrice, price, qty, isPremium, flags.useBuyOrder, flags.useSellOrder).netProfit >= target) return price;
    price += 1;
  }
  return Infinity;
}

/**
 * Highest safe whole-silver purchase price for the requested profit.
 * Returns 0 when even a free purchase cannot meet the target.
 */
export function maxBuyPriceForTarget(sellPrice: number, quantity: number, isPremium: boolean, strategy: MarketplaceStrategy, targetProfitPerItem = 0): number {
  const flags = strategyFlags(strategy);
  sellPrice = sanitizeAmount(sellPrice);
  const qty = Math.max(1, sanitizeQuantity(quantity));
  const target = sanitizeAmount(targetProfitPerItem) * qty;
  let low = 0;
  let high = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(sellPrice));
  // Purchase cost (including its rounded fee) is monotone. Use the upper
  // midpoint so a feasible low cannot stall one silver below the true limit.
  while (low < high) {
    const mid = low + Math.ceil((high - low) / 2);
    if (calculateMarketplaceProfit(mid, sellPrice, qty, isPremium, flags.useBuyOrder, flags.useSellOrder).netProfit >= target) low = mid;
    else high = mid - 1;
  }
  return low;
}

export interface CraftingResult {
  itemValue: number;
  stationTax: number;
  quantity: number;
  nutritionPerItem: number;
  totalNutrition: number;
  feePerItem: number;
  totalFee: number;
}

export interface FlipResult {
  marketplace: MarketplaceResult;
  totalProfit: number;
  totalFees: number;
  upfrontInvestment: number;
  roi: number;
}

/**
 * Marketplace profit calculation.
 * A buy order and a sell order are independent. Each fee is rounded once on
 * the complete order amount, never once per item.
 */
export function calculateMarketplaceProfit(
  buyPrice: number,
  sellPrice: number,
  quantity: number,
  isPremium: boolean,
  useBuyOrder: boolean,
  useSellOrder: boolean
): MarketplaceResult {
  buyPrice = sanitizeAmount(buyPrice);
  sellPrice = sanitizeAmount(sellPrice);
  quantity = sanitizeQuantity(quantity);

  const taxRate = isPremium ? 0.04 : 0.08;
  const totalRevenue = sellPrice * quantity;
  const totalCost = buyPrice * quantity;
  const setupFeeBuy = useBuyOrder ? Math.ceil(totalCost * 0.025) : 0;
  const setupFeeSell = useSellOrder ? Math.ceil(totalRevenue * 0.025) : 0;
  const salesTax = Math.ceil(totalRevenue * taxRate);
  const totalFees = setupFeeBuy + setupFeeSell + salesTax;
  const netProfit = totalRevenue - setupFeeSell - salesTax - totalCost - setupFeeBuy;
  const profitPerItem = quantity > 0 ? netProfit / quantity : 0;
  const feePercentage = totalRevenue > 0 ? (totalFees / totalRevenue) * 100 : 0;
  const marginPercentage = totalCost > 0 ? (netProfit / totalCost) * 100 : 0;

  return {
    buyPrice,
    sellPrice,
    quantity,
    setupFeeBuy,
    setupFeeSell,
    salesTax,
    totalFees,
    netProfit,
    profitPerItem,
    feePercentage,
    marginPercentage,
  };
}

/**
 * Crafting / Refining Station Fee calculation.
 * Premium does not change this station fee.
 */
export function calculateCraftingFee(
  itemValue: number,
  stationTax: number,
  quantity: number
): CraftingResult {
  itemValue = sanitizeAmount(itemValue);
  stationTax = sanitizeAmount(stationTax);
  quantity = sanitizeQuantity(quantity);

  const nutritionPerItem = itemValue * 0.1125;
  const feePerItem = (itemValue * 0.1125 * stationTax) / 100;
  const totalNutrition = nutritionPerItem * quantity;
  // For integer inputs, 0.1125 / 100 = 9 / 8000 keeps the numerator exact
  // until the final division. Reusing an approximated per-item fee can turn
  // an integer total (640 * 27 * 100 * 9 / 8000 = 1944) into 1944.000...2.
  // Keep the existing fractional-input path: its products are not exact
  // integers and reordering them can introduce different rounding errors.
  const numerator = itemValue * stationTax * quantity * 9;
  const exactIntegerRatio = Number.isSafeInteger(itemValue)
    && Number.isSafeInteger(stationTax) && Number.isSafeInteger(numerator);
  const totalFee = Math.ceil(exactIntegerRatio ? numerator / 8000 : feePerItem * quantity);

  return {
    itemValue,
    stationTax,
    quantity,
    nutritionPerItem,
    totalNutrition,
    feePerItem,
    totalFee,
  };
}

/**
 * Flip = buy an item and sell the same item on the marketplace.
 * No crafting, refining, nutrition, or station fee is included here.
 * ROI uses capital committed before the sale: purchase cost and buy-order fee.
 */
export function calculateFlipProfit(
  buyPrice: number,
  sellPrice: number,
  quantity: number,
  isPremium: boolean,
  useBuyOrder: boolean,
  useSellOrder: boolean
): FlipResult {
  const marketplace = calculateMarketplaceProfit(
    buyPrice,
    sellPrice,
    quantity,
    isPremium,
    useBuyOrder,
    useSellOrder
  );
  const totalProfit = marketplace.netProfit;
  const totalFees = marketplace.totalFees;
  const upfrontInvestment = marketplace.buyPrice * marketplace.quantity
    + marketplace.setupFeeBuy;
  const roi = upfrontInvestment > 0 ? (totalProfit / upfrontInvestment) * 100 : 0;

  return {
    marketplace,
    totalProfit,
    totalFees,
    upfrontInvestment,
    roi,
  };
}
