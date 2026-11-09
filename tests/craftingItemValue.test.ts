import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { selectCraftingItemValue, needsManualCraftingItemValue } from '../lib/craftingItemValue';
import { parseUserNumber } from '../lib/numberParsing';
import { translations } from '../lib/i18n';

test('unknown catalog values leave the input empty instead of implying a zero fee', () => {
  for (const value of [0, -1, NaN, Infinity]) {
    const selection = selectCraftingItemValue(value);
    assert.deepEqual(selection, { itemValue: '', catalogValueMissing: true });
    assert.equal(needsManualCraftingItemValue(selection.catalogValueMissing, parseUserNumber(selection.itemValue)), true);
  }
});

test('known values retain the exact catalog value and need no missing-value notice', () => {
  const selection = selectCraftingItemValue(1024);
  assert.deepEqual(selection, { itemValue: '1024', catalogValueMissing: false });
  assert.equal(needsManualCraftingItemValue(selection.catalogValueMissing, parseUserNumber(selection.itemValue)), false);
});

test('the empty initial form does not claim that a catalog value is missing', () => {
  assert.equal(needsManualCraftingItemValue(false, parseUserNumber('')), false);
});

test('missing-value guidance remains for zero or invalid input and clears after localized manual entry', () => {
  const selection = selectCraftingItemValue(0);
  for (const locale of ['fr', 'en', 'es'] as const) {
    for (const value of ['', '0', '0.0.0']) {
      assert.equal(needsManualCraftingItemValue(selection.catalogValueMissing, parseUserNumber(value, false, locale)), true);
    }
    const value = locale === 'en' ? '1,024.5' : '1.024,5';
    assert.equal(needsManualCraftingItemValue(selection.catalogValueMissing, parseUserNumber(value, false, locale)), false);
    // Clearing the manual override restores the missing-value explanation.
    assert.equal(needsManualCraftingItemValue(selection.catalogValueMissing, parseUserNumber('', false, locale)), true);
  }
});

test('switching between known and unknown items never retains a previous value', () => {
  let selection = selectCraftingItemValue(1024);
  selection = selectCraftingItemValue(0);
  assert.equal(selection.itemValue, '');
  assert.equal(selection.catalogValueMissing, true);
  selection = { ...selection, itemValue: '500' };
  selection = selectCraftingItemValue(0);
  assert.equal(selection.itemValue, '');
  selection = selectCraftingItemValue(640);
  assert.deepEqual(selection, { itemValue: '640', catalogValueMissing: false });
});

test('the shipped catalog is handled without fabricating missing values', () => {
  const items = JSON.parse(readFileSync('assets/items-db.json', 'utf8')) as { iv: number }[];
  assert.ok(items.some((item) => item.iv === 0), 'exercise actual missing catalog values');
  assert.ok(items.some((item) => item.iv > 0), 'exercise actual known catalog values');
  for (const item of items) {
    const selection = selectCraftingItemValue(item.iv);
    if (item.iv === 0) {
      assert.equal(selection.itemValue, '');
      assert.equal(selection.catalogValueMissing, true);
    } else {
      assert.equal(Number(selection.itemValue), item.iv);
      assert.equal(selection.catalogValueMissing, false);
    }
  }
});

test('missing-value guidance is localized and wired to the crafting screen', () => {
  for (const locale of ['fr', 'en', 'es'] as const) {
    assert.equal(typeof translations[locale].itemValueUnavailable, 'string');
    assert.ok(translations[locale].itemValueUnavailable.length > 0);
  }
  assert.equal(new Set(['fr', 'en', 'es'].map((locale) => translations[locale as keyof typeof translations].itemValueUnavailable)).size, 3);
  const source = readFileSync('screens/CraftingScreen.tsx', 'utf8');
  assert.match(source, /const selection = selectCraftingItemValue\(item\.iv, lang\)/);
  assert.match(source, /changeItemValue\(selection\.itemValue\)/);
  assert.match(source, /setCatalogValueMissing\(selection\.catalogValueMissing\)/);
  assert.match(source, /needsManualCraftingItemValue\(catalogValueMissing, iv\)/);
  assert.match(source, /manualItemValueNeeded &&/);
  assert.match(source, /t\('itemValueUnavailable'\)/);
  assert.match(source, /iv\.value <= 0/);
  assert.doesNotMatch(source, /setItemValue\(String\(item\.iv\)\)/);
});
