import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { translations } from '../lib/i18n';
import { CITIES } from '../lib/api';

// Execute the actual hook bodies with only their platform/storage and basic
// React state/effect boundaries stubbed. No browser or native storage is used.
async function loadPreference(
  name: 'useLanguage' | 'useServer' | 'usePlayerCity',
  platform: 'web' | 'android',
  read: () => string | null | Promise<string | null>,
  getterThrows = false,
  write: (key: string, value: string) => void | Promise<void> = async () => {},
) {
  const state: unknown[] = [];
  let cursor = 0;
  let mounted = false;
  const effects: (() => void)[] = [];
  const storage = { getItem: read, setItem: write };
  const module = { exports: {} as Record<string, () => Record<string, unknown>> };
  const context = {
    module,
    exports: module.exports,
    require: (id: string) => {
      if (id === 'react') return {
        useState(initial: unknown) {
          const index = cursor++;
          if (!mounted) state[index] = initial;
          return [state[index], (value: unknown) => { state[index] = value; }];
        },
        useEffect(effect: () => void) { if (!mounted) effects.push(effect); },
        useCallback(callback: unknown) { return callback; },
      };
      if (id === 'react-native') return { Platform: { OS: platform } };
      if (id === '@react-native-async-storage/async-storage') return { __esModule: true, default: storage };
      if (id === '../lib/i18n') return { translations };
      if (id === '../lib/api') return { CITIES };
      throw new Error(`Unexpected dependency: ${id}`);
    },
  };
  Object.defineProperty(context, 'localStorage', {
    get() {
      if (getterThrows) throw Object.assign(new Error('Storage access denied'), { name: 'SecurityError' });
      return storage;
    },
  });
  const compiled = transpileModule(readFileSync(`hooks/${name}.ts`, 'utf8'), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(compiled, context, { filename: `hooks/${name}.ts` });
  const render = () => { cursor = 0; return module.exports[name](); };
  const initial = render();
  mounted = true;
  for (const effect of effects) effect();
  await new Promise<void>((resolve) => setImmediate(resolve));
  return { initial, loaded: render(), render };
}

for (const [name, valueKey, loadedKey, fallback, saved] of [
  ['useLanguage', 'lang', 'loaded', 'fr', 'es'],
  ['useServer', 'server', 'serverLoaded', 'americas', 'europe'],
  ['usePlayerCity', 'city', 'cityLoaded', null, 'Martlock'],
] as const) {
  test(`${name} finishes loading with its default when the localStorage getter throws`, async () => {
    const result = await loadPreference(name, 'web', () => null, true);
    assert.equal(result.initial[loadedKey], false);
    assert.equal(result.loaded[loadedKey], true);
    assert.equal(result.loaded[valueKey], fallback);
  });

  test(`${name} finishes loading when localStorage.getItem throws SecurityError`, async () => {
    const result = await loadPreference(name, 'web', () => {
      throw Object.assign(new Error('Storage access denied'), { name: 'SecurityError' });
    });
    assert.equal(result.loaded[loadedKey], true);
    assert.equal(result.loaded[valueKey], fallback);
  });

  test(`${name} finishes loading when native storage rejects`, async () => {
    const result = await loadPreference(name, 'android', async () => { throw new Error('Storage unavailable'); });
    assert.equal(result.loaded[loadedKey], true);
    assert.equal(result.loaded[valueKey], fallback);
  });

  test(`${name} still restores a valid saved preference on web and native`, async () => {
    for (const platform of ['web', 'android'] as const) {
      const result = await loadPreference(name, platform, () => saved);
      assert.equal(result.loaded[loadedKey], true);
      assert.equal(result.loaded[valueKey], saved);
    }
  });

  test(`${name} ignores missing or invalid saved values and finishes loading`, async () => {
    for (const savedValue of [null, '', 'not-a-preference']) {
      const result = await loadPreference(name, 'web', () => savedValue);
      assert.equal(result.loaded[loadedKey], true);
      assert.equal(result.loaded[valueKey], fallback);
    }
  });
}

for (const [name, valueKey, changeKey, key, previous, next] of [
  ['useLanguage', 'lang', 'switchLanguage', 'albion_calc_language', 'fr', 'es'],
  ['useServer', 'server', 'switchServer', 'albion_calc_server', 'americas', 'europe'],
  ['usePlayerCity', 'city', 'selectCity', 'albion_player_city', 'Martlock', 'Thetford'],
] as const) {
  test(`${name} keeps a new selection in memory when web storage writes are blocked`, async () => {
    const stored = previous;
    const result = await loadPreference(name, 'web', () => stored, false, () => {
      throw Object.assign(new Error('Storage write denied'), { name: 'SecurityError' });
    });
    const change = result.loaded[changeKey] as (value: string) => Promise<void>;
    await assert.doesNotReject(() => change(next));
    assert.equal(result.render()[valueKey], next);
    assert.equal(stored, previous, 'a failed write does not replace the stored preference');
  });

  test(`${name} permits selections even when accessing localStorage itself throws`, async () => {
    const result = await loadPreference(name, 'web', () => null, true);
    const change = result.loaded[changeKey] as (value: string) => Promise<void>;
    await assert.doesNotReject(() => change(next));
    assert.equal(result.render()[valueKey], next);
  });

  test(`${name} keeps the current selection when native persistence rejects`, async () => {
    const result = await loadPreference(name, 'android', () => previous, false, async () => {
      throw new Error('Storage unavailable');
    });
    const change = result.loaded[changeKey] as (value: string) => Promise<void>;
    await assert.doesNotReject(() => change(next));
    assert.equal(result.render()[valueKey], next);
  });

  test(`${name} still writes the exact selected preference when storage works`, async () => {
    for (const platform of ['web', 'android'] as const) {
      const writes: [string, string][] = [];
      const result = await loadPreference(name, platform, () => previous, false, (name, value) => {
        writes.push([name, value]);
      });
      const change = result.loaded[changeKey] as (value: string) => Promise<void>;
      await change(next);
      assert.deepEqual(writes, [[key, next]]);
      assert.equal(result.render()[valueKey], next);
    }
  });
}
