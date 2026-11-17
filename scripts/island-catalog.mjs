import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const asArray = value => value == null ? [] : Array.isArray(value) ? value : [value];
function sourceString(raw, field, required = false) {
 const value=raw[field];
 if(value == null && !required)return null;
 if(typeof value!=='string' || !value.trim())throw Error(`Invalid ${field}`);
 return value;
}
function tier(raw) {
 const value=raw['@tier'];
 if(value==null)return null;
 if((typeof value!=='string' && typeof value!=='number') || String(value).trim()==='')throw Error('Invalid tier');
 const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>1000)throw Error('Invalid tier');return n;
}
/** Retains source objects as raw data; mapping source tags is not a game rule. */
export function extractIslandCatalog(source,provenance) {
 if(!source?.items || typeof source.items!=='object' || Array.isArray(source.items) || source.items.farmableitem==null)throw Error('Missing farmableitem');
 const farmables=[],seen=new Set(),bySourcePlotType={},bySourceStage={};
 for(const raw of asArray(source.items.farmableitem)) {
  if(!raw || typeof raw!=='object' || Array.isArray(raw))throw Error('Invalid farmableitem');
  const sourceId=sourceString(raw,'@uniquename',true);
  if(seen.has(sourceId))throw Error(`Duplicate source ID ${sourceId}`);seen.add(sourceId);
  const plotType=sourceString(raw,'@shopsubcategory1'),stage=sourceString(raw,'@shopsubcategory2');
  bySourcePlotType[plotType??'(unknown)']=(bySourcePlotType[plotType??'(unknown)']??0)+1;
  bySourceStage[stage??'(unknown)']=(bySourceStage[stage??'(unknown)']??0)+1;
  farmables.push({sourceId,tier:tier(raw),kind:sourceString(raw,'@kind'),plotType,stage,raw});
 }
 return {schemaVersion:1,provenance,
  assumptions:{farmPlotSlots:{value:9,source:'user_declared',scope:'farm'},herbGardenPlotSlots:null,pasturePlotSlots:null,kennelPlotSlots:null},
  verifiedRules:{npcPrices:null,cityBonuses:null,focusFormula:null,harvestYield:null,offspringRules:null},
  stats:{farmableCount:farmables.length,bySourcePlotType,bySourceStage},farmables};
}
async function main() {
 const [input,commit,output]=process.argv.slice(2);
 if(!input || !/^[a-f0-9]{40}$/i.test(commit??'') || !output || process.argv.length!==5)throw Error('Usage: node scripts/island-catalog.mjs <items.json> <commit-40-hex> <output.json>');
 if(resolve(input)===resolve(output))throw Error('Input and output must differ');
 const bytes=await readFile(input);
 const provenance={sourceUrl:`https://github.com/ao-data/ao-bin-dumps/blob/${commit}/items.json`,sourceCommit:commit,
  sourceSha256:createHash('sha256').update(bytes).digest('hex'),rightsStatus:'redistribution_unconfirmed_local_testing_only',
  gameVersion:null,revisionVerification:'operator_declared_verify_source_hash'};
 const catalogue=extractIslandCatalog(JSON.parse(bytes.toString('utf8')),provenance);
 await mkdir(dirname(resolve(output)),{recursive:true});await writeFile(output,JSON.stringify(catalogue));
 console.log(JSON.stringify(catalogue.stats));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
