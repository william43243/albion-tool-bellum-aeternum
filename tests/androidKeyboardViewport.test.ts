import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { keyboardViewportHeight } from '../components/chat/keyboardViewport';

test('S22 edge-to-edge viewport ends at keyboard top without subtracting safe area twice', () => {
  // 1080 x 2340 screenshot, density 3: IME starts at pixel 1314.
  assert.equal(keyboardViewportHeight(780, 0, 438), 438);
  assert.equal(keyboardViewportHeight(438, 0, 438), 438); // already resized native root
  assert.equal(keyboardViewportHeight(753, 27, 438), 411); // non-edge-to-edge root
  assert.equal(keyboardViewportHeight(400, 27, 438), 400); // smaller available window
});
test('closed, invalid or not-yet-measured keyboard never leaves a sticky height cap', () => {
  for (const top of [null, NaN, -1, 0, Infinity]) assert.equal(keyboardViewportHeight(780, 0, top), undefined);
  assert.equal(keyboardViewportHeight(0, 0, 438), undefined);
  assert.equal(keyboardViewportHeight(780, NaN, 438), undefined);
  assert.equal(keyboardViewportHeight(780, 450, 438), 0);
});
test('keyboard height changes do not accumulate and closing restores the original flexible viewport', () => {
  assert.deepEqual([438, 400, 480, null, 438, null].map(top => keyboardViewportHeight(780, 0, top)), [438, 400, 480, undefined, 438, undefined]);
});

test('real hook handles show/hide, already-resized roots, and listener cleanup', () => {
  const source = readFileSync('hooks/useAndroidKeyboardViewport.ts', 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const states: any[] = []; const refs: any[] = []; let stateIndex = 0; let refIndex = 0;
  let effects: (() => (() => void) | void)[] = []; const listeners = new Map<string, Function>(); let removed = 0;
  const React = {
    useState(initial: any) { const index = stateIndex++; if (!(index in states)) states[index] = initial; return [states[index], (value: any) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useRef(initial: any) { const index = refIndex++; return refs[index] ?? (refs[index] = { current: initial }); },
    useCallback: (fn: Function) => fn,
    useEffect: (effect: any) => { effects.push(effect); },
  };
  const native = { Platform: { OS: 'android' }, Keyboard: { isVisible: () => false, metrics: () => undefined, addListener: (name: string, fn: Function) => { listeners.set(name, fn); return { remove: () => { removed++; listeners.delete(name); } }; } }, AppState: { addEventListener: (_name: string, fn: Function) => { listeners.set('app', fn); return { remove: () => { removed++; listeners.delete('app'); } }; } } };
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', js)((name: string) => name === 'react' ? React : name === 'react-native' ? native : { keyboardViewportHeight }, module, module.exports);
  const render = (enabled = true) => { stateIndex = 0; refIndex = 0; effects = []; return module.exports.useAndroidKeyboardViewport(enabled); };
  let view = render();
  let rootHeight = 780;
  view.rootRef.current = { measureInWindow: (fn: Function) => fn(0, 0, 360, rootHeight) };
  const cleanup = effects[0]()!;
  listeners.get('keyboardDidShow')!({ endCoordinates: { screenY: 438 } });
  view = render(); assert.equal(view.maxHeight, 438); assert.equal(view.keyboardVisible, true);
  rootHeight = 438; view.measureRoot(); view = render(); assert.equal(view.maxHeight, 438);
  listeners.get('keyboardDidHide')!(); view = render(); assert.equal(view.maxHeight, undefined); assert.equal(view.keyboardVisible, false);
  rootHeight = 780; listeners.get('keyboardDidShow')!({ endCoordinates: { screenY: 438 } });
  view = render(false); assert.equal(view.maxHeight, undefined); assert.equal(view.keyboardVisible, false);
  cleanup(); assert.equal(removed, 3); assert.equal(listeners.size, 0);
});
test('only OpenAI advisor uses Android cap; keyboard compaction does not remount chat', () => {
  const app = readFileSync('App.tsx', 'utf8');
  const hub = readFileSync('screens/AdvisorHubScreen.tsx', 'utf8');
  const chat = readFileSync('screens/OpenAIChatScreen.tsx', 'utf8');
  assert.match(app, /useAndroidKeyboardViewport\(activeTab === 'advisor' && advisorProvider === 'openai'\)/);
  assert.match(app, /maxHeight: keyboardViewport.maxHeight/);
  assert.match(app, /keyboardViewport.keyboardVisible && \{ display: 'none' \}/);
  assert.match(hub, /<OpenAIChatScreen compact=\{compact\}/);
  assert.doesNotMatch(hub, /compact\s*\?\s*<OpenAIChatScreen|key=\{compact/);
  assert.match(chat, /onPress=\{Keyboard.dismiss\}/);
  assert.match(chat, /behavior=\{Platform.OS === 'ios' \? 'padding' : undefined\}/); // Android has one owner, at root.
  assert.match(readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8'), /windowSoftInputMode="adjustResize"/);
});
