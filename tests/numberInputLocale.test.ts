import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { translateNumberInput, numberInputForLocale, updateNumberInput } from '../lib/numberInputLocale';
import type { NumberInputState } from '../lib/numberInputLocale';
import { parseUserNumber } from '../lib/numberParsing';
import { selectCraftingItemValue } from '../lib/craftingItemValue';
import { resolveMarketplacePrices } from '../lib/marketplacePrices';
import type { PriceData } from '../lib/api';

const locales = ['fr', 'en', 'es'] as const;

test('language changes preserve the reported quantity and station-tax regressions', () => {
  const quantity = translateNumberInput('1,000', 'en', 'fr');
  assert.equal(quantity, '1.000');
  assert.equal(parseUserNumber(quantity, true, 'fr').value, 1000);
  const tax = translateNumberInput('0,125', 'fr', 'en');
  assert.equal(tax, '0.125');
  assert.equal(parseUserNumber(tax, false, 'en').value, 0.125);
});

test('every locale pair preserves value, validity and integer restrictions without rounding', () => {
  const entries = [
    '', '0', '0.000', '1,000', '1,234.50', '1 234.50', '1\u00a0234.50', '1\u202f234.50',
    '0.000000000000000001', '9007199254740991', '0000123.4500',
    '  1,234.50  ', '12,34', '1,234 567', '1.2.3', '1,', '0.', '.', ',', 'abc',
    '-1', '9007199254740992',
  ];
  for (const source of locales) for (const target of locales) for (const englishEntry of entries) {
    const entry = translateNumberInput(englishEntry, 'en', source);
    const moved = translateNumberInput(entry, source, target);
    for (const integer of [false, true]) {
      assert.deepEqual(parseUserNumber(moved, integer, target), parseUserNumber(entry, integer, source), `${source} -> ${target}: ${entry}`);
    }
    assert.equal(translateNumberInput(moved, target, source), entry, 'round trips retain the exact typed text');
  }
});

test('already typed input is localized synchronously, then subsequent edits use the new language', () => {
  let state: NumberInputState<string> = { value: '1,000', locale: 'en' };
  assert.equal(numberInputForLocale(state, 'fr'), '1.000');
  // A locale change alone does not replace the authoritative typed text.
  assert.deepEqual(state, { value: '1,000', locale: 'en' });
  state = updateNumberInput(state, '1.000,25', 'fr');
  assert.equal(numberInputForLocale(state, 'en'), '1,000.25');
  assert.equal(parseUserNumber(numberInputForLocale(state, 'es'), false, 'es').value, 1000.25);
  state = updateNumberInput(state, (previous) => previous + '0', 'en');
  assert.deepEqual(state, { value: '1,000.250', locale: 'en' });
  assert.equal(numberInputForLocale(state, 'fr'), '1.000,250');
});

test('invalid and unfinished entries never gain a valid value merely from changing language', () => {
  for (const entry of ['1,00', '0.', '1.2.3', '1,234 567']) {
    let state: NumberInputState<string> = { value: entry, locale: 'en' };
    for (const locale of ['fr', 'es', 'en'] as const) {
      const value = numberInputForLocale(state, locale);
      assert.equal(parseUserNumber(value, false, locale).valid, false);
      state = updateNumberInput(state, value, locale);
    }
    assert.equal(state.value, entry);
  }
});

test('nullable live-price state remains distinct from an intentionally empty manual field', () => {
  let state: NumberInputState<string | null> = { value: null, locale: 'en' };
  for (const locale of locales) assert.equal(numberInputForLocale(state, locale), null);
  state = updateNumberInput(state, '', 'fr');
  for (const locale of locales) assert.equal(numberInputForLocale(state, locale), '');
  state = updateNumberInput(state, '0,125', 'fr');
  assert.equal(numberInputForLocale(state, 'en'), '0.125');
  state = updateNumberInput(state, null, 'es');
  assert.equal(numberInputForLocale(state, 'en'), null);
});

test('machine-originated catalog and live quote decimals explicitly use their display locale', () => {
  const quote: PriceData = {
    item_id: 'T4_BAG', city: 'Martlock', quality: 1,
    sell_price_min: 2.75, sell_price_min_date: '2026-11-05T02:20:00',
    sell_price_max: 3, sell_price_max_date: '2026-11-05T02:20:00',
    buy_price_min: 1, buy_price_min_date: '2026-11-05T02:20:00',
    buy_price_max: 1.25, buy_price_max_date: '2026-11-05T02:20:00',
  };
  for (const locale of locales) {
    const catalog = selectCraftingItemValue(1.25, locale);
    assert.equal(parseUserNumber(catalog.itemValue, false, locale).value, 1.25);
    const prices = resolveMarketplacePrices(quote, true, true, { buy: null, sell: null }, locale);
    assert.equal(parseUserNumber(prices.buyPrice, false, locale).value, 1.25);
    assert.equal(parseUserNumber(prices.sellPrice, false, locale).value, 2.75);
    const manual = translateNumberInput('1,000.25', 'en', locale);
    assert.equal(resolveMarketplacePrices(quote, true, true, { buy: manual, sell: '' }, locale).buyPrice, manual);
    assert.equal(resolveMarketplacePrices(quote, true, true, { buy: manual, sell: '' }, locale).sellPrice, '');
  }
});

test('all calculation fields use the common locale-aware state before rendering or parsing', () => {
  for (const screen of ['Marketplace', 'Crafting', 'Flipping']) {
    const source = readFileSync(`screens/${screen}Screen.tsx`, 'utf8');
    assert.equal((source.match(/= useLocalizedNumberInput</g) || []).length, 3, `${screen}: cover every numeric field`);
    assert.doesNotMatch(source, /\[(?:manualBuyPrice|manualSellPrice|buyPrice|sellPrice|quantity|itemValue|stationTax),[^\]]*\]\s*=\s*useState/);
    assert.match(source, /locale=\{lang\}/);
    assert.match(source, /parseUserNumber\(/);
  }
  const hook = readFileSync('hooks/useLocalizedNumberInput.ts', 'utf8');
  assert.match(hook, /return \[numberInputForLocale\(state, locale\), setValue\]/);
  assert.doesNotMatch(hook, /use(?:Layout)?Effect/);
});
