// A compact, generated index for inspection and export. The catalogue remains
// the source of truth; an empty list means unknown, not a verified absence.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateCatalog } from './plan-catalog.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export function buildZoneDatabase(catalog, zones) {
 validateCatalog(catalog,zones);
 const items=new Map(catalog.resources.map(r=>[r.resource_id,r]));
 const totals=new Map(catalog.zone_totals.map(t=>[t.zone_id,t]));
 return {
  schema_version:'1.0.0',
  percentage_basis:'resource and tier share of documented theoretical zone nodes across all tiers and enchantments',
  unknown_means:'no documented data, not absence',
  zones:zones.map(zone=>{
   const total=totals.get(zone.id);
   const resources=catalog.zone_occurrences.filter(o=>o.zone_id===zone.id && o.resource_id && o.theoretical_quantity).map(o=>{
    const item=items.get(o.resource_id), n=o.theoretical_quantity.value;
    return {resource_id:o.resource_id,type:item.category,tier:o.tier,theoretical_nodes:n,percent:total?100*n/total.value:null,source_refs:o.source_refs};
   });
   return {zone_id:zone.id,name:zone.name,status:resources.length?(total?'complete_source_snapshot':'partial'):'unknown',total_nodes:total?.value??null,resources};
  })
 };
}
async function main(){
 const mode=process.argv[2];
 if(!['--write','--check'].includes(mode)) throw Error('Usage: node scripts/plan-zone-db.mjs --write|--check');
 const read=async p=>JSON.parse(await fs.readFile(path.join(root,p),'utf8'));
 const db=buildZoneDatabase(await read('assets/plan/catalog.json'),(await read('assets/map/world-map.local.json')).zones);
 const output=JSON.stringify(db,null,2)+'\n', target=path.join(root,'assets/plan/zone-resources.json');
 if(mode==='--write') await fs.writeFile(target,output);
 else if(await fs.readFile(target,'utf8')!==output) throw Error('zone resource index is stale; run node scripts/plan-zone-db.mjs --write');
 const counts={}; for(const z of db.zones) counts[z.status]=(counts[z.status]??0)+1;
 console.log(JSON.stringify({zones:db.zones.length,coverage:counts},null,2));
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) main().catch(e=>{console.error(e.message);process.exitCode=1});
