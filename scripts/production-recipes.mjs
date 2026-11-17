import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Independent normalization of the dump's XML-derived JSON, not game rules.
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
function number(value, field, { positive = false } = {}) {
  if (value == null) return null;
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') throw Error(`Invalid ${field}`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < (positive ? 1 : 0)) throw Error(`Invalid ${field}: ${value}`);
  return n;
}
function boolean(value, field) {
  if (value == null) return null;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw Error(`Invalid ${field}: ${value}`);
}
function id(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw Error(`Missing ${field}`);
  return value;
}
function marketCandidate(sourceId, enchantment) {
  return enchantment != null && enchantment > 0 ? `${sourceId}@${enchantment}` : sourceId;
}
function material(raw) {
  const sourceId = id(raw['@uniquename'], 'material unique name');
  const enchantment = number(raw['@enchantmentlevel'], 'material enchantment');
  const quantity = number(raw['@count'], 'material count', {positive:true});
  if (quantity == null) throw Error(`Missing material count: ${sourceId}`);
  const maxReturnAmount = number(raw['@maxreturnamount'], 'max return amount');
  return {sourceId, itemIdCandidate: marketCandidate(sourceId, enchantment), enchantment, quantity,
    maxReturnAmount, returnable: maxReturnAmount === 0 ? false : null};
}
export function extractRecipes(data, provenance) {
  if (!data?.items || typeof data.items !== 'object' || Array.isArray(data.items)) throw Error('Missing items root');
  const recipes = [], seen = new Set(), categories = {}, itemTypes = {}, subcategories = {};
  const emit = (item, itemType, owner, prefix, enchantment) => {
    for (const [index, requirements] of array(owner.craftingrequirements).entries()) {
      if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) throw Error('Invalid craftingrequirements');
      const sourceId = id(item['@uniquename'], 'item unique name');
      const recipeId = `${sourceId}#${prefix}:${index}`;
      if (seen.has(recipeId)) throw Error(`Duplicate recipe ${recipeId}`);
      seen.add(recipeId);
      const category = typeof item['@shopcategory'] === 'string' ? item['@shopcategory'] : null;
      categories[category ?? '(unknown)'] = (categories[category ?? '(unknown)'] ?? 0) + 1;
      itemTypes[itemType] = (itemTypes[itemType] ?? 0) + 1;
      const subcategoryPath = ['@shopsubcategory1','@shopsubcategory2','@shopsubcategory3'].map(k => item[k]).filter(v => typeof v === 'string' && v.length);
      const categoryPath = [category, ...subcategoryPath].filter(Boolean).join('/') || '(unknown)';
      subcategories[categoryPath] = (subcategories[categoryPath] ?? 0) + 1;
      recipes.push({id:recipeId, sourceId, itemIdCandidate:marketCandidate(sourceId, enchantment), itemType,
        tier:number(item['@tier'], 'tier'), enchantment, category,
        subcategories:subcategoryPath,
        outputQuantity:number(requirements['@amountcrafted'], 'output quantity', {positive:true}),
        focusBase:number(requirements['@craftingfocus'], 'base focus'),
        silverCost:number(requirements['@silver'], 'silver cost'),
        swapTransaction:boolean(requirements['@swaptransaction'], 'swap transaction'),
        craftMode:typeof requirements['@craftbuttonlocaoverride'] === 'string' ? requirements['@craftbuttonlocaoverride'] : null,
        materials:array(requirements.craftresource).map(material)});
    }
  };
  for (const [itemType, value] of Object.entries(data.items)) {
    for (const item of array(value)) {
      if (!item || typeof item !== 'object' || !item['@uniquename']) continue;
      emit(item, itemType, item, 'root', number(item['@enchantmentlevel'], 'item enchantment'));
      for (const enchant of array(item.enchantments?.enchantment)) {
        const level = number(enchant?.['@enchantmentlevel'], 'nested enchantment');
        if (level == null) throw Error(`Missing nested enchantment: ${item['@uniquename']}`);
        emit(item, itemType, enchant, `enchant:${level}`, level);
      }
    }
  }
  return {schemaVersion:1, provenance, stats:{recipeCount:recipes.length, categories, itemTypes, subcategories,
    missingOutputQuantity:recipes.filter(r => r.outputQuantity == null).length,
    missingMaterials:recipes.filter(r => !r.materials.length).length,
    materialsWithUnknownReturn:recipes.reduce((n,r) => n + r.materials.filter(m => m.returnable == null).length,0)}, recipes};
}

async function main() {
  const [input, commit, output] = process.argv.slice(2);
  if (!input || !/^[a-f0-9]{40}$/i.test(commit ?? '') || !output || process.argv.length !== 5) {
    throw Error('Usage: node scripts/production-recipes.mjs <items.json> <40-character-source-commit> <output.json>');
  }
  if (resolve(input) === resolve(output)) throw Error('Input and output must differ');
  const bytes = await readFile(input);
  const provenance = {sourceUrl:`https://github.com/ao-data/ao-bin-dumps/blob/${commit}/items.json`, sourceCommit:commit,
    sourceSha256:createHash('sha256').update(bytes).digest('hex'), rightsStatus:'redistribution_unconfirmed_local_testing_only', gameVersion:null,
    revisionVerification:'operator_declared_verify_source_hash'};
  const result = extractRecipes(JSON.parse(bytes.toString('utf8')), provenance);
  await mkdir(dirname(resolve(output)), {recursive:true});
  await writeFile(output, JSON.stringify(result));
  console.log(JSON.stringify(result.stats, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(e => {console.error(e.message); process.exitCode=1;});
