export type ParsedNumber = { value: number; valid: boolean; ambiguous: boolean };
export type NumberLocale = 'fr' | 'en' | 'es';

const INVALID: ParsedNumber = { value: 0, valid: false, ambiguous: false };
const AMBIGUOUS: ParsedNumber = { value: 0, valid: false, ambiguous: true };

/**
 * Parse a non-negative user number according to the selected UI locale.
 * Separators never change meaning heuristically: FR/ES use comma decimals and
 * dot/space grouping; EN uses dot decimals and comma/space grouping.
 */
export function parseUserNumber(raw: string, integer = false, locale: NumberLocale = 'fr'): ParsedNumber {
  const text = raw.trim().replace(/[\u00a0\u202f]/g, ' ');
  if (!text) return INVALID;
  if (!/^[0-9., ]+$/.test(text)) return INVALID;

  const decimalSeparator = locale === 'en' ? '.' : ',';
  const localeGroupingSeparator = locale === 'en' ? ',' : '.';
  const decimalParts = text.split(decimalSeparator);
  if (decimalParts.length > 2) return AMBIGUOUS;

  const [integerPart, fractionalPart] = decimalParts;
  if (!integerPart || (fractionalPart !== undefined && !/^\d+$/.test(fractionalPart))) return AMBIGUOUS;

  const usesLocaleGrouping = integerPart.includes(localeGroupingSeparator);
  const usesSpaceGrouping = integerPart.includes(' ');
  if (usesLocaleGrouping && usesSpaceGrouping) return AMBIGUOUS;

  const groupingSeparator = usesLocaleGrouping ? localeGroupingSeparator : usesSpaceGrouping ? ' ' : null;
  let integerDigits = integerPart;
  if (groupingSeparator) {
    const groups = integerPart.split(groupingSeparator);
    if (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some((group) => !/^\d{3}$/.test(group))) return AMBIGUOUS;
    integerDigits = groups.join('');
  } else if (!/^\d+$/.test(integerPart)) {
    return AMBIGUOUS;
  }

  const normalized = fractionalPart === undefined ? integerDigits : `${integerDigits}.${fractionalPart}`;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return INVALID;
  if (integer && !Number.isSafeInteger(value)) return AMBIGUOUS;
  return { value, valid: true, ambiguous: false };
}
