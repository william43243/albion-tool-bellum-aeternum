import type { NumberLocale, ParsedNumber } from './numberParsing';
import { translateNumberInput } from './numberInputLocale';

export interface CraftingItemValueSelection {
  itemValue: string;
  catalogValueMissing: boolean;
}

/** The catalog uses zero for unknown values, not for a free crafting fee. */
export function selectCraftingItemValue(value: number, locale: NumberLocale = 'en'): CraftingItemValueSelection {
  const catalogValueMissing = !Number.isFinite(value) || value <= 0;
  return {
    itemValue: catalogValueMissing ? '' : translateNumberInput(String(value), 'en', locale),
    catalogValueMissing,
  };
}

/** Keep the explanation until the user supplies a usable manual value. */
export function needsManualCraftingItemValue(
  catalogValueMissing: boolean,
  parsedValue: ParsedNumber,
): boolean {
  return catalogValueMissing && (!parsedValue.valid || parsedValue.value <= 0);
}
