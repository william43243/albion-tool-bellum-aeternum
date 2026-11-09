import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getItemById, getItemCount, getItemsByIds, searchItems, type AlbionItem } from '../lib/items';

const catalog = JSON.parse(readFileSync('assets/items-db.json', 'utf8')) as AlbionItem[];
const trophyId = 'T5_FURNITUREITEM_TROPHY_WOOD';

test('multi-selection resolves the trophy excluded by the old 10000-result cap', () => {
  assert.ok(getItemById(trophyId), 'regression fixture must exist');
  assert.deepEqual(getItemsByIds(new Set(['T4_BAG', trophyId])).map((item) => item.id), ['T4_BAG', trophyId]);
});

test('every item beyond the old cap can be confirmed, including the last catalog item', () => {
  const tail = catalog.slice(10000);
  assert.ok(tail.length > 0, 'the catalog must exercise the old truncation boundary');
  assert.deepEqual(getItemsByIds(tail.map((item) => item.id)), tail);
  assert.deepEqual(getItemsByIds([catalog.at(-1)!.id]), [catalog.at(-1)]);
});

test('selection lookup has no catalog-size cap and preserves existing catalog ordering', () => {
  const ids = catalog.map((item) => item.id).reverse();
  const selected = getItemsByIds(ids);
  assert.equal(selected.length, getItemCount());
  assert.deepEqual(selected, catalog);
  assert.deepEqual(ids, catalog.map((item) => item.id).reverse(), 'input must not be mutated');
});

test('empty, duplicate and unknown IDs do not create phantom or repeated selections', () => {
  assert.deepEqual(getItemsByIds([]), []);
  assert.deepEqual(getItemsByIds(['UNKNOWN_ITEM_ID']), []);
  assert.deepEqual(getItemsByIds([trophyId, trophyId, 'UNKNOWN_ITEM_ID']), [getItemById(trophyId)]);
  assert.deepEqual(getItemsByIds([trophyId.toLowerCase()]), [], 'lookup must use exact IDs');
});

// Execute the actual confirmation callback without React Native dependencies.
const source = readFileSync('components/ItemPicker.tsx', 'utf8');
const body = source.match(/const handleConfirm = \(\) => \{([\s\S]*?)\n  \};/)?.[1];
assert.ok(body, 'ItemPicker confirmation callback must be found');
const confirm = new Function('env', `with (env) { ${body} }`);

function confirmSelection(selected: Set<string>, filteredItems: AlbionItem[], withCallback = true) {
  const emitted: AlbionItem[][] = [];
  const events: string[] = [];
  confirm({
    selected, filteredItems, searchItems, getItemsByIds,
    onMultiSelect: withCallback ? (items: AlbionItem[]) => { emitted.push(items); events.push('select'); } : undefined,
    onClose: () => events.push('close'),
  });
  return { emitted, events };
}

test('actual confirmation keeps earlier selections outside the current search and category', () => {
  const selected = new Set(['T4_BAG', trophyId]);
  const filtered = searchItems(trophyId, 'furniture', '5', 80);
  assert.deepEqual(filtered.map((item) => item.id), [trophyId]);
  const result = confirmSelection(selected, filtered);
  assert.deepEqual(result.emitted[0].map((item) => item.id), ['T4_BAG', trophyId]);
  assert.deepEqual(result.events, ['select', 'close']);
  assert.deepEqual([...selected], ['T4_BAG', trophyId]);
});

test('actual confirmation retains the complete selection when current search finds nothing', () => {
  const selected = new Set(catalog.slice(10000).map((item) => item.id));
  const result = confirmSelection(selected, []);
  assert.deepEqual(result.emitted, [catalog.slice(10000)]);
  assert.deepEqual(result.events, ['select', 'close']);
});

test('actual confirmation emits an empty selection after everything is deselected', () => {
  const result = confirmSelection(new Set(), searchItems('bag'));
  assert.deepEqual(result.emitted, [[]]);
  assert.deepEqual(result.events, ['select', 'close']);
});

test('actual confirmation without a selection callback still closes exactly once', () => {
  const result = confirmSelection(new Set([trophyId]), [], false);
  assert.deepEqual(result.emitted, []);
  assert.deepEqual(result.events, ['close']);
});
