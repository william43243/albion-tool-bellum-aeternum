import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const categories = new Set(['wood','ore','stone','fiber','hide']);
const biomes = new Set(['mountain','forest','swamp','highland','steppe']);
const fail = message => { throw new Error(`Invalid plan catalogue: ${message}`); };
const unique = (items, field) => {
  const seen = new Set();
  for (const item of items) {
    if (typeof item[field] !== 'string' || !item[field] || seen.has(item[field])) fail(`duplicate or missing ${field}`);
    seen.add(item[field]);
  }
  return seen;
};
const refs = (item, sourceIds) => {
  if (!Array.isArray(item.source_refs) || !item.source_refs.length || new Set(item.source_refs).size !== item.source_refs.length || item.source_refs.some(id => !sourceIds.has(id))) fail('unknown, duplicated or missing source reference');
};
const tier = value => value === null || Number.isInteger(value) && value >= 1 && value <= 8;
const enchantment = value => value === null || Number.isInteger(value) && value >= 0 && value <= 4;

export function validateCatalog(catalog, zones = null) {
  if (catalog.schema_version !== '1.0.0' || !(catalog.game_data_version === null || typeof catalog.game_data_version === 'string')) fail('schema or game version');
  for (const key of ['sources','resources','mobs','biome_resource_rules','enchantment_rules','zone_occurrences','zone_totals']) if (!Array.isArray(catalog[key])) fail(`missing ${key}`);
  const sourceIds = unique(catalog.sources,'id');
  for (const s of catalog.sources) {
    if (!/^https:\/\//.test(s.url) || !/^\d{4}-\d{2}-\d{2}$/.test(s.accessed_at) || !s.license_status || !s.restrictions) fail('source provenance');
  }
  const resourceIds = unique(catalog.resources,'resource_id'), mobIds = unique(catalog.mobs,'mob_id');
  for (const item of catalog.resources) {
    refs(item, sourceIds);
    const id = /^T([1-8])_(WOOD|ORE|ROCK|FIBER|HIDE)$/.exec(item.resource_id);
    const idCategories = {WOOD:'wood',ORE:'ore',ROCK:'stone',FIBER:'fiber',HIDE:'hide'};
    if (!id || +id[1] !== item.tier || idCategories[id[2]] !== item.category || !item.name || !categories.has(item.category) || !tier(item.tier) || item.tier === null || !enchantment(item.enchantment) || !item.confidence) fail('resource');
  }
  for (const mob of catalog.mobs) {
    refs(mob, sourceIds);
    if (!mob.name || !['harvestable','hostile'].includes(mob.category) || !tier(mob.tier) || !Array.isArray(mob.biomes) || mob.biomes.some(b => !biomes.has(b)) || (mob.resource_id !== null && !resourceIds.has(mob.resource_id)) || (mob.resource_category !== null && !categories.has(mob.resource_category)) || !mob.scope || !mob.confidence) fail('mob');
  }
  const seenRules = new Set();
  for (const rule of catalog.biome_resource_rules) {
    refs(rule, sourceIds);
    const key = `${rule.biome}:${rule.category}`;
    if (!biomes.has(rule.biome) || !categories.has(rule.category) || !rule.confidence || seenRules.has(key)) fail('biome rule');
    seenRules.add(key);
  }
  const seenEnchantments = new Set();
  for (const rule of catalog.enchantment_rules) {
    refs(rule, sourceIds);
    const key = JSON.stringify([rule.category,rule.enchantment,rule.scope,rule.spawn_type]);
    if (!categories.has(rule.category) || !enchantment(rule.enchantment) || rule.enchantment === null || !tier(rule.min_tier) || !tier(rule.max_tier) || rule.min_tier === null || rule.max_tier === null || rule.min_tier > rule.max_tier || !rule.scope || !rule.spawn_type || !rule.confidence || seenEnchantments.has(key)) fail('enchantment rule');
    seenEnchantments.add(key);
  }
  if (catalog.zone_occurrences.length && !Array.isArray(zones)) fail('zone graph required to validate zone references');
  const zoneIds = new Set((zones || []).map(z => z.id));
  const seenOccurrences = new Set();
  for (const o of catalog.zone_occurrences) {
    refs(o, sourceIds);
    const key = JSON.stringify([o.zone_id,o.resource_id,o.mob_id,o.tier,o.enchantment,o.spawn_type]);
    if (!zoneIds.has(o.zone_id) || (o.resource_id === null && o.mob_id === null) || (o.resource_id !== null && !resourceIds.has(o.resource_id)) || (o.mob_id !== null && !mobIds.has(o.mob_id)) || !tier(o.tier) || !enchantment(o.enchantment) || !(o.biome === null || biomes.has(o.biome)) || !o.spawn_type || !o.confidence || seenOccurrences.has(key)) fail('zone occurrence');
    if (o.theoretical_quantity !== null && (!o.theoretical_quantity || typeof o.theoretical_quantity.value !== 'number' || !Number.isFinite(o.theoretical_quantity.value) || o.theoretical_quantity.value < 0 || !o.theoretical_quantity.unit || !o.theoretical_quantity.scope)) fail('quantity');
    seenOccurrences.add(key);
  }
  const totalZones = new Set();
  for (const total of catalog.zone_totals) {
    refs(total, sourceIds);
    if (!zoneIds.has(total.zone_id) || totalZones.has(total.zone_id) || !Number.isSafeInteger(total.value) || total.value <= 0 || total.unit !== 'nodes' || total.scope !== 'zone_distribution_or_hand_placed_whichever_is_greater') fail('zone total');
    const rows = catalog.zone_occurrences.filter(o => o.zone_id === total.zone_id && o.resource_id !== null);
    if (!rows.length || rows.some(o => !o.theoretical_quantity || o.mob_id !== null || o.enchantment !== null || o.theoretical_quantity.unit !== total.unit || o.theoretical_quantity.scope !== total.scope || !o.source_refs.some(id => total.source_refs.includes(id))) || rows.reduce((sum, o) => sum + o.theoretical_quantity.value, 0) !== total.value) fail('incomplete or inconsistent zone total');
    totalZones.add(total.zone_id);
  }
  return true;
}

export function coverage(catalog, zones) {
  const direct = new Set(catalog.zone_occurrences.map(o => o.zone_id));
  if (!Array.isArray(zones)) return {total_zones:null,direct_zones:direct.size,direct_uncovered_zones:null,complete_source_snapshots:catalog.zone_totals.length,biome_compatible_zones:null,uncovered_zones:null,resource_code_disagreement_zones:null};
  const compatibleBiomes = new Set(catalog.biome_resource_rules.map(r => r.biome));
  const compatible = zones.filter(z => z.risk !== 'city' && compatibleBiomes.has(z.biome));
  const covered = new Set([...direct, ...compatible.map(z => z.id)]);
  const codeToCategory = {WOOD:'wood',ORE:'ore',ROCK:'stone',FIBER:'fiber',HIDE:'hide'};
  const disagreement = compatible.filter(z => Array.isArray(z.resources) && z.resources.some(code =>
    codeToCategory[code] && !catalog.biome_resource_rules.some(r => r.biome === z.biome && r.category === codeToCategory[code])));
  return {total_zones:zones.length,direct_zones:direct.size,direct_uncovered_zones:zones.length-direct.size,complete_source_snapshots:catalog.zone_totals.length,biome_compatible_zones:compatible.length,uncovered_zones:zones.length-covered.size,resource_code_disagreement_zones:disagreement.length};
}

async function main() {
  const mode = process.argv[2] || '--check';
  if (!['--check','--sync'].includes(mode) || process.argv.length > 3) fail('usage: node scripts/plan-catalog.mjs [--check|--sync]');
  const source = path.join(root,'assets/plan/catalog.json');
  const target = path.join(root,'android/app/src/main/assets/plan-catalog.json');
  const map = path.join(root,'assets/map/world-map.local.json');
  const bytes = await fs.readFile(source);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const revision = await fs.readFile(path.join(root,'lib/planCatalogRevision.ts'),'utf8');
  const expected = revision.match(/export const PLAN_CATALOG_SHA256 = '([a-f0-9]{64})';/);
  if (!expected || expected[1] !== digest) fail('catalogue revision constant differs from source bytes');
  const nativeCode = await fs.readFile(path.join(root,'android/app/src/main/java/com/albion/market/litert/PlanEngine.kt'),'utf8');
  const nativeExpected = nativeCode.match(/private val expectedCatalogFingerprint\s*=\s*"([a-f0-9]{64})"/);
  if (!nativeExpected || nativeExpected[1] !== digest) fail('native catalogue revision constant differs from source bytes');
  const catalog = JSON.parse(bytes);
  const repositoryItems = JSON.parse(await fs.readFile(path.join(root,'assets/items-db.json'),'utf8'));
  const itemsById = new Map(repositoryItems.map(item => [item.id,item]));
  for (const resource of catalog.resources) {
    const item = itemsById.get(resource.resource_id);
    if (!item || item.n !== resource.name || Number(item.t) !== resource.tier) fail(`resource diverges from repository item catalogue: ${resource.resource_id}`);
  }
  let zones = null;
  try { zones = JSON.parse(await fs.readFile(map,'utf8')).zones; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  validateCatalog(catalog,zones);
  if (mode === '--sync') {
    await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.writeFile(target,bytes);
  } else {
    const other = await fs.readFile(target);
    if (!bytes.equals(other)) fail('Android catalogue differs from source');
  }
  console.log(JSON.stringify({sha256:digest, resources:catalog.resources.length, mobs:catalog.mobs.length, ...coverage(catalog,zones)},null,2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode=1; });
