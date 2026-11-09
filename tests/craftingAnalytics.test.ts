import assert from 'node:assert/strict';
import test from 'node:test';
import { CraftingAnalytics } from '../lib/craftingAnalytics';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
test('craft input is debounced and identical results, invalid inputs, and hidden screens do not count', async () => {
  const sent: number[] = [];
  const tracker = new CraftingAnalytics(token => token === 1, token => sent.push(token), 8);
  tracker.update('1024:800:1', 1);
  tracker.update('1024:800:10', 1);
  await sleep(20);
  assert.deepEqual(sent, [1]);
  tracker.update('1024:800:10', 1);
  await sleep(20);
  assert.equal(sent.length, 1);
  tracker.update('1024:800:100', 1);
  tracker.update(null, 1);
  await sleep(20);
  assert.equal(sent.length, 1);
  tracker.update('1024:800:100', 1);
  tracker.cancel();
  await sleep(20);
  assert.equal(sent.length, 1);
});
test('craft actions before acceptance or crossing revocation are never replayed', async () => {
  let generation: number | null = null;
  let calls = 0;
  const tracker = new CraftingAnalytics(token => token !== null && token === generation, () => { calls++; }, 8);
  tracker.update('1:2:3', null);
  generation = 1;
  await sleep(20);
  assert.equal(calls, 0);
  tracker.update('1:2:3', 1);
  generation = 2;
  await sleep(20);
  assert.equal(calls, 0);
  tracker.update('1:2:3', 2);
  await sleep(20);
  assert.equal(calls, 1);
});

test('the real crafting callbacks validate localized inputs and pass only a consent token to tracking', async () => {
  const { readFileSync } = await import('node:fs');
  const ts = await import('typescript');
  const { parseUserNumber } = await import('../lib/numberParsing');
  const source = readFileSync('screens/CraftingScreen.tsx', 'utf8');
  const ast = ts.createSourceFile('screen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback = '';
  function visit(node: import('typescript').Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'recordInput') callback = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(callback);
  const js = ts.transpileModule(callback, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const updates: unknown[][] = [];
  const env = { active: true, lang: 'fr', parseUserNumber, captureAnalyticsAuthorization: () => 7, tracker: { current: { update: (...args: unknown[]) => updates.push(args) } } };
  const record = new Function('env', `with (env) { ${js}; return recordInput; }`)(env);
  record('1 024', '800', '10');
  assert.deepEqual(updates.pop(), ['1024:800:10', 7]);
  record('1 024', '', '10');
  assert.deepEqual(updates.pop(), ['1024:0:10', 7]);
  record('', '800', '10');
  assert.deepEqual(updates.pop(), [null, 7]);
  env.active = false;
  record('1 024', '800', '10');
  assert.equal(updates.length, 0);
});
