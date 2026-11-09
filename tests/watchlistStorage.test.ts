import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { createWatchlistStore } from '../lib/watchlistStorage';
import type { WatchlistEntry } from '../lib/watchlistStorage';
import type { Server } from '../lib/api';

const a: WatchlistEntry = { itemId: 'T4_BAG', itemName: 'Bag', quality: 1 };
const b: WatchlistEntry = { itemId: 'T5_BAG', itemName: 'Better bag', quality: 1 };
const c: WatchlistEntry = { itemId: 'T4_CAPE', itemName: 'Cape', quality: 2 };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('rejected native reads finish loading and keep edits in memory for each server', async () => {
  let writes = 0;
  const store = createWatchlistStore({ read: async () => { throw new Error('AsyncStorage unavailable'); }, write: async () => { writes++; } });
  await store.load();
  assert.equal(store.getSnapshot().loaded, true);
  await assert.doesNotReject(() => store.add('americas', a));
  await store.add('europe', b);
  await store.remove('americas', a);
  assert.deepEqual(store.getSnapshot().all.americas, []);
  assert.deepEqual(store.getSnapshot().all.europe, [b]);
  assert.equal(writes, 0, 'never overwrite unknown stored contents after a failed read');
});

test('storage recovery replays edits over unseen saved favorites without losing other servers', async () => {
  let unavailable = true;
  let raw = JSON.stringify({ americas: [a, c], europe: [c], asia: [a], futureData: { keep: true } });
  const store = createWatchlistStore({
    read: async () => { if (unavailable) throw new Error('Read failed'); return raw; },
    write: async (next) => { raw = next; },
  });
  await store.load();
  await store.add('americas', b);
  await store.remove('americas', a);
  await store.add('europe', b);
  unavailable = false;
  await store.add('asia', c);
  assert.deepEqual(JSON.parse(raw), {
    americas: [c, b], europe: [c, b], asia: [a, c], futureData: { keep: true },
  });
  assert.deepEqual(store.getSnapshot().all, JSON.parse(raw));
});

test('failed native writes retain the pending edits for a later successful write', async () => {
  let raw = JSON.stringify({ americas: [a], europe: [c], asia: [] });
  let failWrite = true;
  const store = createWatchlistStore({
    read: async () => raw,
    write: async (next) => { if (failWrite) throw new Error('Disk full'); raw = next; },
  });
  await store.load();
  await assert.doesNotReject(() => store.add('americas', b));
  assert.deepEqual(store.getSnapshot().all.americas, [a, b]);
  assert.deepEqual(JSON.parse(raw).americas, [a], 'memory-only changes are not presented as persisted');
  failWrite = false;
  await store.remove('europe', c);
  assert.deepEqual(JSON.parse(raw), { americas: [a, b], europe: [], asia: [] });
});

test('rapid adds and removals serialize native writes and preserve edits arriving during a write', async () => {
  let raw: string | null = null;
  let releaseFirst!: () => void;
  let active = 0;
  let maximumActive = 0;
  let count = 0;
  const store = createWatchlistStore({
    read: async () => raw,
    write: async (next) => {
      maximumActive = Math.max(maximumActive, ++active);
      if (++count === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
      raw = next;
      active--;
    },
  });
  await store.load();
  const first = store.add('americas', a);
  await tick();
  assert.equal(typeof releaseFirst, 'function');
  const second = store.add('americas', b);
  const third = store.remove('americas', a);
  const fourth = store.add('europe', c);
  assert.deepEqual(store.getSnapshot().all.americas, [b]);
  releaseFirst();
  await Promise.all([first, second, third, fourth]);
  assert.equal(maximumActive, 1);
  assert.deepEqual(JSON.parse(raw!), { americas: [b], europe: [c], asia: [] });
  assert.deepEqual(store.getSnapshot().all, JSON.parse(raw!));
});

test('a delayed initial read merges edits instead of reverting the current memory state', async () => {
  let resolveRead!: (raw: string) => void;
  let firstRead = true;
  let raw = JSON.stringify({ americas: [c], europe: [], asia: [] });
  const store = createWatchlistStore({
    read: () => {
      if (!firstRead) return Promise.resolve(raw);
      firstRead = false;
      return new Promise<string>((resolve) => { resolveRead = resolve; });
    },
    write: async (next) => { raw = next; },
  });
  const loading = store.load();
  await tick();
  const updating = store.add('americas', a);
  assert.deepEqual(store.getSnapshot().all.americas, [a]);
  resolveRead(raw);
  await Promise.all([loading, updating]);
  assert.equal(store.getSnapshot().loaded, true);
  assert.deepEqual(store.getSnapshot().all.americas, [c, a]);
  assert.deepEqual(JSON.parse(raw).americas, [c, a]);
});

test('malformed saved data stays untouched while memory remains usable', async () => {
  for (const raw of ['{', 'null', '[]', '{"americas":{}}', '{"europe":[null]}', '{"asia":[{"itemId":"x","itemName":"X","quality":6}]}']) {
    let writes = 0;
    const store = createWatchlistStore({ read: async () => raw, write: async () => { writes++; } });
    await store.load();
    await store.add('americas', a);
    assert.equal(store.getSnapshot().loaded, true);
    assert.deepEqual(store.getSnapshot().all.americas, [a]);
    assert.equal(writes, 0, raw);
  }
});

test('normal storage keeps quality identities and the 50-entry limit without truncating saved lists', async () => {
  let raw: string | null = null;
  const store = createWatchlistStore({ read: async () => raw, write: async (next) => { raw = next; } });
  await store.load();
  await store.add('americas', a);
  await store.add('americas', a);
  await store.add('americas', { ...a, quality: 2 });
  assert.equal(store.getSnapshot().all.americas.length, 2);
  await store.remove('americas', a);
  assert.deepEqual(store.getSnapshot().all.americas, [{ ...a, quality: 2 }]);
  for (let index = 0; index < 55; index++) await store.add('europe', { ...a, itemId: `ITEM_${index}` });
  assert.equal(store.getSnapshot().all.europe.length, 50);
  assert.equal(store.getSnapshot().all.europe[49].itemId, 'ITEM_49');
});

function mountAndroidWatchlist(read: () => Promise<string | null>, write: (key: string, value: string) => Promise<void>) {
  const state: unknown[] = [];
  const effects: (() => void | (() => void))[] = [];
  let cursor = 0;
  let mounted = false;
  const module = { exports: {} as { useWatchlist: (server: Server) => {
    loaded: boolean; entries: WatchlistEntry[];
    add(entry: WatchlistEntry): Promise<void>; remove(entry: WatchlistEntry): Promise<void>;
  } } };
  const code = transpileModule(readFileSync('hooks/useWatchlist.ts', 'utf8'), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, {
    module, exports: module.exports,
    require: (id: string) => {
      if (id === 'react') return {
        useState(initial: unknown) {
          const index = cursor++;
          if (!mounted) state[index] = typeof initial === 'function' ? initial() : initial;
          return [state[index], (update: unknown) => {
            state[index] = typeof update === 'function' ? update(state[index]) : update;
          }];
        },
        useEffect(effect: () => void | (() => void)) { if (!mounted) effects.push(effect); },
        useCallback(callback: unknown) { return callback; },
      };
      if (id === 'react-native') return { Platform: { OS: 'android' } };
      if (id === '@react-native-async-storage/async-storage') return { __esModule: true, default: { getItem: read, setItem: write } };
      if (id === '../lib/watchlistStorage') return { createWatchlistStore };
      throw new Error(`Unexpected dependency: ${id}`);
    },
  });
  const render = (server: Server) => { cursor = 0; return module.exports.useWatchlist(server); };
  const initial = render('americas');
  mounted = true;
  const cleanups = effects.map((effect) => effect());
  return { initial, render, unmount: () => cleanups.forEach((cleanup) => cleanup?.()) };
}

test('the actual Android hook finishes failed loading and preserves offline favorites across server switches', async () => {
  const hook = mountAndroidWatchlist(async () => { throw new Error('Native read failed'); }, async () => { throw new Error('must not write after failed read'); });
  assert.equal(hook.initial.loaded, false);
  await tick();
  assert.equal(hook.render('americas').loaded, true);
  await hook.render('americas').add(a);
  await hook.render('europe').add(b);
  assert.deepEqual(hook.render('americas').entries, [a]);
  assert.deepEqual(hook.render('europe').entries, [b]);
  assert.deepEqual(hook.render('asia').entries, []);
  hook.unmount();
});

test('the actual Android hook catches native write rejection and keeps loaded saved entries', async () => {
  const raw = JSON.stringify({ americas: [a], europe: [c], asia: [] });
  const hook = mountAndroidWatchlist(async () => raw, async () => { throw new Error('Native write failed'); });
  await tick();
  await assert.doesNotReject(() => hook.render('americas').add(b));
  assert.deepEqual(hook.render('americas').entries, [a, b]);
  assert.deepEqual(hook.render('europe').entries, [c]);
  hook.unmount();
});
