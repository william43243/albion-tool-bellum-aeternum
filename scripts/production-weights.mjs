import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const array = v => v == null ? [] : Array.isArray(v) ? v : [v];
function level(v) {
  if (v == null) return null;
  if ((typeof v !== 'string' && typeof v !== 'number') || String(v).trim() === '') throw Error('Invalid enchantment');
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0 || n > 1000) throw Error('Invalid enchantment');
  return n;
}
function weight(v) {
  if (v == null) return null;
  if ((typeof v !== 'string' && typeof v !== 'number') || String(v).trim() === '') throw Error('Invalid weight');
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) throw Error('Invalid weight');
  return n;
}
export function extractWeights(data, provenance) {
  if (!data?.items || typeof data.items !== 'object' || Array.isArray(data.items)) throw Error('Missing items root');
  const entries = [], keys = new Set();
  for (const items of Object.values(data.items)) for (const item of array(items)) {
    if (!item || typeof item !== 'object' || !item['@uniquename']) continue;
    if (typeof item['@uniquename'] !== 'string' || !item['@uniquename'].trim()) throw Error('Invalid item identity');
    for (const [node, origin] of [[item,'item'], ...array(item.enchantments?.enchantment).map(e=>[e,'enchantment'])]) {
      if (!node || typeof node !== 'object') throw Error('Invalid enchantment object');
      const enchantment = level(node['@enchantmentlevel']);
      if (origin === 'enchantment' && enchantment == null) throw Error('Missing enchantment level');
      const key = JSON.stringify([item['@uniquename'], enchantment]);
      if (keys.has(key)) throw Error(`Duplicate weight identity ${key}`);
      keys.add(key);
      entries.push({sourceId:item['@uniquename'],enchantment,weight:weight(node['@weight']),origin});
    }
  }
  return {schemaVersion:1,provenance,entries};
}
async function main() {
  const [input,commit,output]=process.argv.slice(2);
  if (!input || !/^[a-f0-9]{40}$/i.test(commit??'') || !output || process.argv.length!==5) throw Error('Usage: node scripts/production-weights.mjs <items.json> <commit> <output.json>');
  if(resolve(input)===resolve(output)) throw Error('Input and output must differ');
  const bytes=await readFile(input);
  const provenance={sourceUrl:`https://github.com/ao-data/ao-bin-dumps/blob/${commit}/items.json`,sourceCommit:commit,
    sourceSha256:createHash('sha256').update(bytes).digest('hex'),rightsStatus:'redistribution_unconfirmed_local_testing_only',
    gameVersion:null,unit:'source_unconfirmed',revisionVerification:'operator_declared_verify_source_hash'};
  const result=extractWeights(JSON.parse(bytes.toString('utf8')),provenance);
  await mkdir(dirname(resolve(output)),{recursive:true});
  await writeFile(output,JSON.stringify(result));
  console.log(JSON.stringify({entries:result.entries.length,known:result.entries.filter(x=>x.weight!==null).length}));
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) main().catch(e=>{console.error(e.message);process.exitCode=1;});
