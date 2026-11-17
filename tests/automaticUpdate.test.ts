import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function load(file: string, requireModule: (name: string) => unknown) {
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(code, { exports, require: requireModule, Promise, setTimeout, clearTimeout });
  return exports;
}

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush() { await Promise.resolve(); await Promise.resolve(); }

function hookHarness(os = 'android') {
  let slot = 0, first = true, listener: ((state: string) => void) | null = null;
  let cleanup: (() => void) | undefined;
  const states: any[] = [], effects: Array<() => (() => void) | void> = [];
  const pending: Array<ReturnType<typeof deferred<any>>> = [];
  const module = load('hooks/useAutomaticUpdate.ts', name => {
    if (name === 'react') return {
      useState(initial: unknown) {
        const index = slot++;
        if (!(index in states)) states[index] = initial;
        return [states[index], (value: any) => { states[index] = value; }];
      },
      useEffect(effect: () => (() => void) | void) { if (first) effects.push(effect); },
    };
    if (name === 'react-native') return {
      Platform: { OS: os }, AppState: { currentState: 'active', addEventListener(_type: string, cb: (state: string) => void) {
        listener = cb; return { remove() { listener = null; } };
      } },
    };
    if (name.endsWith('/updateCheckCoordinator')) return { checkForUpdateShared() {
      const request = deferred<any>(); pending.push(request); return request.promise;
    } };
    throw new Error('Unexpected dependency ' + name);
  });
  const render = () => { slot = 0; const result = module.useAutomaticUpdate(); first = false; return result; };
  render();
  for (const effect of effects) cleanup = effect() || undefined;
  return { render, pending, change: (s: string) => listener?.(s), stop: () => cleanup?.() };
}

test('opening and foregrounding checks updates; dismissal lasts for that version only', async () => {
  const h = hookHarness();
  assert.equal(h.pending.length, 1);
  h.pending[0].resolve({ version: '2.2', version_code: 20 }); await flush();
  assert.equal(h.render().promptManifest.version_code, 20);
  h.render().dismiss();
  assert.equal(h.render().promptManifest, null);
  h.change('background'); h.change('inactive'); h.change('active');
  assert.equal(h.pending.length, 2);
  h.pending[1].resolve({ version: '2.2', version_code: 20 }); await flush();
  assert.equal(h.render().promptManifest, null);
  h.change('background'); h.change('active');
  h.pending[2].resolve({ version: '2.3', version_code: 21 }); await flush();
  assert.equal(h.render().promptManifest.version_code, 21);
  h.stop();
});

test('offline, current version, unmount and non-Android never block the app', async () => {
  const h = hookHarness();
  h.pending[0].reject(new Error('offline')); await flush();
  assert.equal(h.render().promptManifest, null);
  h.change('background'); h.change('active');
  h.pending[1].resolve(null); await flush();
  assert.equal(h.render().promptManifest, null);
  h.change('background'); h.change('active');
  h.stop(); h.pending[2].resolve({ version_code: 99 }); await flush();
  assert.equal(h.render().promptManifest, null);
  assert.equal(hookHarness('ios').pending.length, 0);
});

test('automatic and manual checks share one request and can retry after failure', async () => {
  const pending: Array<ReturnType<typeof deferred<any>>> = [];
  const coordinator = load('lib/updateCheckCoordinator.ts', name => {
    assert.equal(name, './updater');
    return { checkForUpdate() { const d = deferred<any>(); pending.push(d); return d.promise; } };
  });
  const first = coordinator.checkForUpdateShared(), second = coordinator.checkForUpdateShared();
  assert.equal(first, second); assert.equal(pending.length, 1);
  pending[0].resolve({ version_code: 20 });
  assert.equal((await first).version_code, 20);
  const next = coordinator.checkForUpdateShared(); assert.equal(pending.length, 2);
  pending[1].reject(new Error('offline')); await assert.rejects(next, /offline/);
  const retry = coordinator.checkForUpdateShared(); assert.equal(pending.length, 3);
  pending[2].resolve(null); assert.equal(await retry, null);
});

test('browser opens only a signed-manifest URL on the update website', async () => {
  const opened: string[] = [];
  const browser = load('lib/updateBrowser.ts', name => {
    assert.equal(name, 'react-native'); return { Linking: { async openURL(url: string) { opened.push(url); } } };
  });
  const safe = 'https://albion-tool-bellum-aeternum.com/downloads/test.apk';
  await browser.openUpdateInBrowser({ apk_url: safe });
  assert.deepEqual(opened, [safe]);
  for (const url of ['http://albion-tool-bellum-aeternum.com/a.apk', 'https://albion-tool-bellum-aeternum.com.evil.test/a.apk',
    'https://albion-tool-bellum-aeternum.com@evil.test/a.apk', 'https://evil.test/a.apk', 'https://albion-tool-bellum-aeternum.com\\@evil.test/a.apk', 'javascript:alert(1)']) {
    await assert.rejects(browser.openUpdateInBrowser({ apk_url: url }), /Untrusted update download URL/);
  }
  assert.deepEqual(opened, [safe]);
});

test('the update popup opens the browser only on confirmation and stays open on failure', async () => {
  for (const fail of [false, true]) {
    let slot = 0, later = 0, opens = 0;
    const state: any[] = [];
    const module = load('components/UpdatePrompt.tsx', name => {
      if (name === 'react') return {
        createElement: (type: unknown, props: Record<string, any>, ...children: unknown[]) => ({ type, props: props || {}, children }),
        useState(initial: unknown) { const index = slot++; if (!(index in state)) state[index] = initial; return [state[index], (v: unknown) => { state[index] = v; }]; },
        useEffect() {},
      };
      if (name === 'react-native') return { Modal: 'Modal', View: 'View', Text: 'Text', TouchableOpacity: 'Button', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (v: unknown) => v } };
      if (name.endsWith('/theme')) return { COLORS: {}, SPACING: {}, FONT_SIZE: {}, BORDER_RADIUS: {} };
      if (name.endsWith('/updateBrowser')) return { async openUpdateInBrowser() { opens++; if (fail) throw new Error('no browser'); } };
      throw new Error('Unexpected dependency ' + name);
    });
    const props = { manifest: { version: '2.2', version_code: 20 }, visible: true, t: (k: string) => k, onLater: () => { later++; } };
    const render = () => { slot = 0; return module.default(props); };
    const flatten = (n: any): any[] => !n ? [] : Array.isArray(n) ? n.flatMap(flatten) : typeof n === 'object' && 'children' in n ? [n, ...flatten(n.children)] : [];
    const initial = flatten(render());
    assert.equal(initial[0].props.visible, true);
    assert.equal(opens, 0);
    const button = initial.find(n => n.props.accessibilityLabel === 'updateNow');
    await button.props.onPress(); await flush();
    assert.equal(opens, 1);
    assert.equal(later, fail ? 0 : 1);
    assert.equal(flatten(render()).some(n => n.props.accessibilityRole === 'alert' && n.children.includes('updateBrowserError')), fail);
  }
});
