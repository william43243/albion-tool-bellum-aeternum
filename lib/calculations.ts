// Albion Online Tax & Fee Calculator - Core Formulas
// Sources: wiki.albiononline.com/wiki/Marketplace, wiki.albiononline.com/wiki/Margin

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

export interface CraftingResult {
  itemValue: number;
  stationTax: number;
  quantity: number;
  nutritionPerItem: number;
  totalNutrition: number;
  feePerItem: number;
  totalFee: number;
}

export interface FlippingResult {
  marketplace: MarketplaceResult;
  crafting: CraftingResult;
  totalProfit: number;
  totalFees: number;
  roi: number;
}

/**
 * Marketplace profit calculation
 * Setup Fee = ceil(price × 0.025) — always 2.5%, not affected by Premium
 * Sales Tax = ceil(sell_price × rate) — 4% Premium, 8% Non-Premium
 * All fees rounded up (ceil) per wiki
 */
export function calculateMarketplaceProfit(
  buyPrice: number,
  sellPrice: number,
  quantity: number,
  isPremium: boolean,
  useOrders: boolean
): MarketplaceResult {
  const taxRate = isPremium ? 0.04 : 0.08;

  const setupFeeBuyPerUnit = useOrders ? Math.ceil(buyPrice * 0.025) : 0;
  const setupFeeSellPerUnit = useOrders ? Math.ceil(sellPrice * 0.025) : 0;
  const salesTaxPerUnit = Math.ceil(sellPrice * taxRate);

  const setupFeeBuy = setupFeeBuyPerUnit * quantity;
  const setupFeeSell = setupFeeSellPerUnit * quantity;
  const salesTax = salesTaxPerUnit * quantity;
  const totalFees = setupFeeBuy + setupFeeSell + salesTax;

  const totalRevenue = sellPrice * quantity;
  const totalCost = buyPrice * quantity;
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
 * Crafting / Refining Station Fee calculation
 * Nutrition per item = Item Value × 0.1125
 * Usage Fee per item = (Item Value × 0.1125 × Station_Tax) / 100
 * Station_Tax = fee per 100 nutrition (shown in-game)
 * Premium does NOT affect crafting fee
 */
export function calculateCraftingFee(
  itemValue: number,
  stationTax: number,
  quantity: number
): CraftingResult {
  const nutritionPerItem = itemValue * 0.1125;
  const feePerItem = (itemValue * 0.1125 * stationTax) / 100;
  const totalNutrition = nutritionPerItem * quantity;
  const totalFee = Math.ceil(feePerItem * quantity);

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
 * Flipping = Buy materials + Craft + Sell finished product
 * Combines marketplace and crafting calculations
 */
export function calculateFlippingProfit(
  materialBuyPrice: number,
  productSellPrice: number,
  craftingItemValue: number,
  stationTax: number,
  quantity: number,
  isPremium: boolean,
  useOrders: boolean
): FlippingResult {
  const marketplace = calculateMarketplaceProfit(
    materialBuyPrice,
    productSellPrice,
    quantity,
    isPremium,
    useOrders
  );

  const crafting = calculateCraftingFee(craftingItemValue, stationTax, quantity);

  const totalProfit = marketplace.netProfit - crafting.totalFee;
  const totalFees = marketplace.totalFees + crafting.totalFee;
  const totalInvestment = materialBuyPrice * quantity + crafting.totalFee;
  const roi = totalInvestment > 0 ? (totalProfit / totalInvestment) * 100 : 0;

  return {
    marketplace,
    crafting,
    totalProfit,
    totalFees,
    roi,
  };
}
