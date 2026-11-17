import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

const mode=process.argv[2];
if(!['--write','--check'].includes(mode) || process.argv.length!==3) throw Error('Usage: node scripts/island-sync.mjs --write|--check');
const pairs=[['assets/island/farmables.json','android/app/src/main/assets/island-farmables.json'],['assets/island/npc-prices.json','android/app/src/main/assets/island-npc-prices.json']];
for(const [source,destination] of pairs){
 const bytes=await readFile(resolve(source)); const data=JSON.parse(bytes.toString('utf8'));
 if(data.schemaVersion!==1)throw Error(`Invalid island schema: ${source}`);
 if(mode==='--write')await writeFile(resolve(destination),bytes);
 const copy=await readFile(resolve(destination));
 if(!bytes.equals(copy))throw Error(`Island asset does not match source: ${destination}`);
 console.log(`${source} -> ${destination} sha256=${createHash('sha256').update(bytes).digest('hex')}`);
}
