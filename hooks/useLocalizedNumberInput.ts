import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { NumberLocale } from '../lib/numberParsing';
import { numberInputForLocale, updateNumberInput } from '../lib/numberInputLocale';
import type { NumberInputState } from '../lib/numberInputLocale';

/** Derive the current notation during render, before any calculation can run. */
export function useLocalizedNumberInput<T extends string | null>(
  initialValue: T,
  locale: NumberLocale,
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<NumberInputState<T>>({ value: initialValue, locale });
  const setValue = useCallback((update: SetStateAction<T>) => {
    setState((previous) => updateNumberInput(previous, update, locale));
  }, [locale]);
  return [numberInputForLocale(state, locale), setValue];
}
