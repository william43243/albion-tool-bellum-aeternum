// Rebuild local game-data inputs from a pinned upstream snapshot.
// Attribution is not a redistribution license: see docs/data-rights.md.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const revision = '90b141e20f4677c2fe3083c519b7f748affa4c47';
const url = `https://raw.githubusercontent.com/ao-data/ao-bin-dumps/${revision}/cluster/world.json`;
const sourceHash = '6c3e66e9daf59a2e26a5e98be97b4bdd864e7a3d3243846bc684e3f278de7b7b';
const zonesHash = 'ee52191991907cb4ad490ec34257156800d10f1ef00033554408067ac539f3f8';
const targets = ['assets/map/world-map.local.json', 'android/app/src/main/assets/world-map.local.json'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];

function validate(data) {
  if (data.provenance?.revision !== revision || data.provenance?.sha256 !== sourceHash ||
      sha(JSON.stringify(data.zones)) !== zonesHash) {
    throw new Error('Map content does not match the reviewed snapshot. Run npm run prepare:data.');
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--check') {
    for (const name of targets) validate(JSON.parse(await fs.readFile(path.join(root, name), 'utf8')));
    console.log('Both map inputs match the reviewed 414-zone snapshot.');
    return;
  }
  if (args.length && !(args.length === 2 && args[0] === '--source')) {
    throw new Error('Usage: node scripts/prepare-map.mjs [--check | --source <world.json>]');
  }
  let raw;
  if (args[0] === '--source') raw = await fs.readFile(path.resolve(args[1]));
  else {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Map source returned HTTP ${response.status}`);
    raw = Buffer.from(await response.arrayBuffer());
  }
  // Reject changed, truncated or substituted input before touching either output.
  if (sha(raw) !== sourceHash) throw new Error('Map source SHA-256 mismatch; existing files preserved.');
  const clusters = JSON.parse(raw.toString('utf8')).world.clusters.cluster;
  const mapped = clusters.filter(c => c['@enabled'] === 'true' && c['@worldmapposition'] && !c['@type'].includes('TUTORIAL'));
  const ids = new Set(mapped.map(c => c['@id']));
  const biomes = { SW:'swamp', FR:'forest', HL:'highland', MN:'mountain', ST:'steppe' };
  const zones = mapped.map(c => {
    const type = c['@type'];
    const city = type.startsWith('PLAYERCITY') || type === 'STARTINGCITY';
    const risk = city ? 'city' : type === 'SAFEAREA' ? 'blue' : type.includes('YELLOW') ? 'yellow' : type.includes('RED') ? 'red' : type.startsWith('OPENPVP_BLACK') ? 'black' : 'unknown';
    const [x,y] = c['@worldmapposition'].split(' ').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid map coordinate');
    return { id:c['@id'], name:c['@displayname'], x, y:-y, type, risk,
      biome:biomes[c['@file'].split('_')[2]] ?? 'unknown',
      tier:Number(c['@file'].match(/_T(\d)_/)?.[1] ?? 0),
      region:type.includes('PORTALCITY') || type.includes('_REST') || type.startsWith('OPENPVP_BLACK') ? 'outlands' : 'royal',
      exits:[...new Set(array(c.exits?.exit).filter(e=>e['@targettype']==='Cluster' && e['@restricted']==='false').map(e=>e['@targetid'].split('@').at(-1)).filter(id=>ids.has(id)))],
      resources:[...new Set(array(c.distribution?.resource).map(r=>r['@name']))] };
  }).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const data = { provenance:{ url, revision, sha256:sourceHash,
    license:'No explicit upstream redistribution license found. Review rights before distribution.',
    totalSourceClusters:clusters.length, omitted:clusters.length-zones.length }, zones };
  validate(data);
  const bytes = JSON.stringify(data) + '\n';
  for (const name of targets) {
    const target = path.join(root,name);
    // Preserve existing provenance when already valid; do not rewrite on every build.
    try { validate(JSON.parse(await fs.readFile(target,'utf8'))); continue; } catch {}
    await fs.mkdir(path.dirname(target),{recursive:true});
    const temp = `${target}.${process.pid}.tmp`;
    try { await fs.writeFile(temp,bytes); await fs.rename(temp,target); }
    finally { await fs.rm(temp,{force:true}); }
  }
  console.log('Prepared and verified 414 zones for JavaScript and Android. See docs/data-rights.md for source rights.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
