import type { NumberLocale } from './numberParsing';

export interface NumberInputState<T extends string | null> {
  value: T;
  locale: NumberLocale;
}

/**
 * Move the notation, not the number. Swapping separators preserves all digits,
 * grouping, unfinished/invalid input and precision without guessing a value.
 * Null is a distinct "use the live price" sentinel in the marketplace.
 */
export function translateNumberInput<T extends string | null>(
  value: T,
  from: NumberLocale,
  to: NumberLocale,
): T {
  if (value === null || (from === 'en') === (to === 'en')) return value;
  return value.replace(/[.,]/g, (separator) => separator === '.' ? ',' : '.') as T;
}

export function numberInputForLocale<T extends string | null>(state: NumberInputState<T>, locale: NumberLocale): T {
  return translateNumberInput(state.value, state.locale, locale);
}

export function updateNumberInput<T extends string | null>(
  state: NumberInputState<T>,
  update: T | ((previous: T) => T),
  locale: NumberLocale,
): NumberInputState<T> {
  const value = typeof update === 'function' ? update(numberInputForLocale(state, locale)) : update;
  return { value, locale };
}
