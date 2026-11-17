import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('../assets/island/npc-prices.json', import.meta.url), 'utf8'));

test('NPC references identify purchase direction and retain provenance', () => {
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.defaultForUnlistedItems, 'unknown');
  assert.equal(data.currentPerServerPriceVerified, false);
  assert.equal(data.redistributionRightsStatus, 'unconfirmed_review_required');
  const seen = new Set();
  for (const entry of data.entries) {
    assert.match(entry.itemId, /^T[1-8]_FARM_[A-Z]+_(SEED|BABY)$/);
    assert(!seen.has(entry.itemId), `Duplicate ${entry.itemId}`);
    seen.add(entry.itemId);
    assert.equal(entry.transaction, 'player_buys_from_farming_merchant');
    assert.equal(entry.currency, 'silver');
    assert.match(entry.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert(entry.sources.length >= 2);
    assert(entry.sources.every(source => new URL(source).protocol === 'https:'));
    if (entry.status === 'reference') assert(Number.isSafeInteger(entry.value) && entry.value > 0);
    else {
      assert.equal(entry.status, 'unknown_conflicting_sources');
      assert.equal(entry.value, null);
    }
  }
});

test('checked prices retain item identity and conflicting mounts remain unknown', () => {
  const byId = new Map(data.entries.map(item => [item.itemId, item]));
  const expected = {
    T1_FARM_CARROT_SEED: 2000, T2_FARM_BEAN_SEED: 3000,
    T3_FARM_WHEAT_SEED: 5000, T4_FARM_TURNIP_SEED: 7500,
    T5_FARM_CABBAGE_SEED: 10000, T6_FARM_POTATO_SEED: 15000,
    T7_FARM_CORN_SEED: 22500, T8_FARM_PUMPKIN_SEED: 30000,
    T2_FARM_AGARIC_SEED: 3000, T3_FARM_COMFREY_SEED: 5000,
    T4_FARM_BURDOCK_SEED: 7500, T5_FARM_TEASEL_SEED: 10000,
    T6_FARM_FOXGLOVE_SEED: 15000, T7_FARM_MULLEIN_SEED: 22500,
    T8_FARM_YARROW_SEED: 30000,
    T3_FARM_CHICKEN_BABY: 5000, T4_FARM_GOAT_BABY: 7500,
    T5_FARM_GOOSE_BABY: 10000, T6_FARM_SHEEP_BABY: 15000,
    T7_FARM_PIG_BABY: 22500, T8_FARM_COW_BABY: 30000,
  };
  for (const [id, value] of Object.entries(expected)) assert.equal(byId.get(id)?.value, value, id);
  for (const animal of ['HORSE', 'OX']) {
    for (const [tier, value] of [[3, 25000], [4, 75000], [5, 225000], [6, 675000]]) {
      assert.equal(byId.get(`T${tier}_FARM_${animal}_BABY`)?.value, value);
    }
    for (const tier of [7, 8]) {
      const entry = byId.get(`T${tier}_FARM_${animal}_BABY`);
      assert.equal(entry?.value, null);
      assert.equal(entry?.status, 'unknown_conflicting_sources');
    }
  }
  assert.equal(byId.size, 33);
});
