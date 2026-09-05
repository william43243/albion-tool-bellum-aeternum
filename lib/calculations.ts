// Albion Online marketplace and crafting formulas.
// Marketplace rates: setup/order fee 2.5%; sales tax 4% Premium / 8% otherwise.

function sanitizeAmount(value: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function sanitizeQuantity(value: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function clampRate(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Round a fee once on the full order amount, never once per unit. */
function orderFee(unitPrice: number, quantity: number, rate: number): number {
  const total = sanitizeAmount(unitPrice) * sanitizeAmount(quantity);
  return total > 0 ? Math.ceil(total * rate) : 0;
}

export interface MarketplaceResult {
  buyPrice: number;
  sellPrice: number;
  quantity: number;
  useBuyOrder: boolean;
  useSellOrder: boolean;
  setupFeeBuy: number;
  setupFeeSell: number;
  salesTax: number;
  totalFees: number;
  upfrontInvestment: number;
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

export interface RecipeMaterial {
  unitPrice: number;
  requiredQuantity: number;
  useBuyOrder: boolean;
}

export interface FlippingResult {
  marketplace: MarketplaceResult;
  crafting: CraftingResult;
  materials: RecipeMaterial[];
  resourceReturnRate: number;
  grossMaterialCost: number;
  returnedMaterialValue: number;
  materialCost: number;
  buyOrderFees: number;
  totalProfit: number;
  totalFees: number;
  upfrontInvestment: number;
  roi: number;
}

/**
 * Calculate one market transaction scenario.
 * Buying from an existing sell order and selling into an existing buy order
 * incur no setup fees. Creating either order is selected independently.
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
  const setupFeeBuy = useBuyOrder ? orderFee(buyPrice, quantity, 0.025) : 0;
  const setupFeeSell = useSellOrder ? orderFee(sellPrice, quantity, 0.025) : 0;
  const salesTax = orderFee(sellPrice, quantity, taxRate);
  const totalFees = setupFeeBuy + setupFeeSell + salesTax;
  const totalRevenue = sellPrice * quantity;
  const totalCost = buyPrice * quantity;
  const upfrontInvestment = totalCost + setupFeeBuy;
  const netProfit = totalRevenue - salesTax - setupFeeSell - totalCost - setupFeeBuy;
  const profitPerItem = quantity > 0 ? netProfit / quantity : 0;
  const feePercentage = totalRevenue > 0 ? (totalFees / totalRevenue) * 100 : 0;
  const marginPercentage = upfrontInvestment > 0 ? (netProfit / upfrontInvestment) * 100 : 0;

  return {
    buyPrice,
    sellPrice,
    quantity,
    useBuyOrder,
    useSellOrder,
    setupFeeBuy,
    setupFeeSell,
    salesTax,
    totalFees,
    upfrontInvestment,
    netProfit,
    profitPerItem,
    feePercentage,
    marginPercentage,
  };
}

/** Station fee = Item Value * 0.1125 * displayed station tax / 100. */
export function calculateCraftingFee(
  itemValue: number,
  stationTax: number,
  quantity: number
): CraftingResult {
  itemValue = sanitizeAmount(itemValue);
  stationTax = sanitizeAmount(stationTax);
  quantity = sanitizeQuantity(quantity);

  const nutritionPerItem = itemValue * 0.1125;
  const feePerItem = (nutritionPerItem * stationTax) / 100;
  const totalNutrition = nutritionPerItem * quantity;
  const totalFee = feePerItem > 0 && quantity > 0 ? Math.ceil(feePerItem * quantity) : 0;

  return { itemValue, stationTax, quantity, nutritionPerItem, totalNutrition, feePerItem, totalFee };
}

/**
 * Crafting profit for an explicit recipe. Each ingredient has its own quantity,
 * price and buy-order choice. Resource return is economic net consumption and
 * is independent from Premium.
 */
export function calculateFlippingProfit(
  materials: RecipeMaterial[],
  productSellPrice: number,
  craftingItemValue: number,
  stationTax: number,
  quantity: number,
  isPremium: boolean,
  useSellOrder: boolean,
  resourceReturnRate: number
): FlippingResult {
  quantity = sanitizeQuantity(quantity);
  resourceReturnRate = clampRate(resourceReturnRate);

  const cleanMaterials = (Array.isArray(materials) ? materials : []).map((material) => ({
    unitPrice: sanitizeAmount(material?.unitPrice),
    requiredQuantity: sanitizeQuantity(material?.requiredQuantity),
    useBuyOrder: Boolean(material?.useBuyOrder),
  }));

  let grossMaterialCost = 0;
  let returnedMaterialValue = 0;
  let materialCost = 0;
  let buyOrderFees = 0;
  for (const material of cleanMaterials) {
    const grossRequired = material.requiredQuantity * quantity;
    const grossIngredientCost = material.unitPrice * grossRequired;
    const returnedValue = grossIngredientCost * resourceReturnRate;
    grossMaterialCost += grossIngredientCost;
    returnedMaterialValue += returnedValue;
    materialCost += grossIngredientCost - returnedValue;
    if (material.useBuyOrder && grossIngredientCost > 0) {
      buyOrderFees += Math.ceil(grossIngredientCost * 0.025);
    }
  }

  const effectiveBuyPrice = quantity > 0 ? materialCost / quantity : 0;
  const marketplace = calculateMarketplaceProfit(
    effectiveBuyPrice,
    productSellPrice,
    quantity,
    isPremium,
    false,
    useSellOrder
  );
  const crafting = calculateCraftingFee(craftingItemValue, stationTax, quantity);
  const totalProfit = marketplace.netProfit - buyOrderFees - crafting.totalFee;
  const totalFees = marketplace.totalFees + buyOrderFees + crafting.totalFee;
  const upfrontInvestment = grossMaterialCost + buyOrderFees + crafting.totalFee;
  const roi = upfrontInvestment > 0 ? (totalProfit / upfrontInvestment) * 100 : 0;

  return {
    marketplace,
    crafting,
    materials: cleanMaterials,
    resourceReturnRate,
    grossMaterialCost,
    returnedMaterialValue,
    materialCost,
    buyOrderFees,
    totalProfit,
    totalFees,
    upfrontInvestment,
    roi,
  };
}
