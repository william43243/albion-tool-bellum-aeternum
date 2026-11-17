import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateCatalog as validateCatalogScript, coverage } from '../scripts/plan-catalog.mjs';
import { buildZoneDatabase } from '../scripts/plan-zone-db.mjs';

// The JS CLI defaults the graph to null; make its accepted graph shape explicit for TS tests.
const validateCatalog = validateCatalogScript as unknown as (data: unknown, zones: {id: string}[] | null) => boolean;

const root = process.cwd();
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const catalogue = () => read('assets/plan/catalog.json');
const synthetic = () => {
  const data = catalogue(), source = data.sources[0].id;
  const occurrence = (zone_id: string, resource_id: string, tier: number, value: number) => ({
    zone_id, resource_id, mob_id:null, tier, enchantment:null, biome:null, spawn_type:'node', confidence:'synthetic',
    theoretical_quantity:{value,unit:'nodes',scope:'zone_distribution_or_hand_placed_whichever_is_greater'},source_refs:[source]
  });
  data.zone_occurrences = [occurrence('a','T4_ROCK',4,20), occurrence('a','T5_ROCK',5,80), occurrence('b','T4_ROCK',4,7)];
  data.zone_totals = [{zone_id:'a',value:100,unit:'nodes',scope:'zone_distribution_or_hand_placed_whichever_is_greater',source_refs:[source]}];
  return data;
};

test('catalogue and Android asset agree, with traceable facts', () => {
  const bytes = fs.readFileSync(path.join(root,'assets/plan/catalog.json'));
  assert.deepEqual(bytes,fs.readFileSync(path.join(root,'android/app/src/main/assets/plan-catalog.json')));
  assert.equal(validateCatalog(JSON.parse(bytes.toString()),['2311','4208','4338','4342','4353'].map(id => ({id}))),true);
});

test('validator rejects dangling references, duplicated rules and invented zone IDs', () => {
  const badSource = catalogue();
  badSource.resources[0].source_refs = ['unknown'];
  assert.throws(() => validateCatalog(badSource,[]), /source reference/);
  const duplicateRule = catalogue();
  duplicateRule.biome_resource_rules.push(duplicateRule.biome_resource_rules[0]);
  assert.throws(() => validateCatalog(duplicateRule,[]), /biome rule/);
  const badZone = catalogue();
  badZone.zone_occurrences.push({zone_id:'missing',resource_id:badZone.resources[0].resource_id,mob_id:null,
    tier:null,enchantment:null,biome:null,spawn_type:'node',theoretical_quantity:null,confidence:'uncertain',
    source_refs:[badZone.sources[0].id]});
  assert.throws(() => validateCatalog(badZone,['2311','4208','4338','4342','4353'].map(id => ({id}))), /zone occurrence/);
});

test('zone percentages require a complete consistent sourced denominator', () => {
  const data=synthetic(), zones=['a','b'].map(id=>({id}));
  data.zone_totals[0].value++;
  assert.throws(()=>validateCatalog(data,zones), /incomplete or inconsistent zone total/);
  const partial=synthetic(); partial.zone_occurrences.shift();
  assert.throws(()=>validateCatalog(partial,zones), /incomplete or inconsistent zone total/);
});

test('compact database covers the map without inventing missing resources or percentages', () => {
  const zones=read('assets/map/world-map.local.json').zones;
  const db=buildZoneDatabase(catalogue(),zones);
  assert.equal(db.zones.length,414);
  assert.ok(db.zones.every((z:{status:string,total_nodes:number|null,resources:unknown[]})=>z.status==='unknown' && z.total_nodes===null && z.resources.length===0));
  const fixture = buildZoneDatabase(synthetic(),[{id:'a',name:'Example A'},{id:'b',name:'Example B'}]);
  const complete=fixture.zones[0], rock=complete.resources[0];
  assert.equal(complete.total_nodes,100);
  assert.equal(rock.theoretical_nodes,20);
  assert.equal(rock.percent,20);
  const partial=fixture.zones[1];
  assert.equal(partial.status,'partial');
  assert.ok(partial.resources.every((r:{percent:number|null})=>r.percent===null));
});

test('coverage separates documented zone records from biome-only compatibility', () => {
  const data = catalogue();
  data.zone_occurrences = [];
  const zones = [{id:'a',biome:'mountain',risk:'blue',resources:['WOOD']},{id:'b',biome:'unknown',risk:'red'},
    {id:'c',biome:'mountain',risk:'city'}];
  data.zone_totals=[];
  assert.deepEqual(coverage(data,zones),{total_zones:3,direct_zones:0,direct_uncovered_zones:3,complete_source_snapshots:0,biome_compatible_zones:1,uncovered_zones:2,resource_code_disagreement_zones:1});
  assert.deepEqual(coverage(data,null),{total_zones:null,direct_zones:0,direct_uncovered_zones:null,complete_source_snapshots:0,biome_compatible_zones:null,uncovered_zones:null,resource_code_disagreement_zones:null});
});
