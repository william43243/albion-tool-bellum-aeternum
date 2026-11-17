import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Node = { type: unknown; props: Record<string, any>; children: unknown[] };
const flatten = (tree: unknown): Node[] => Array.isArray(tree) ? tree.flatMap(flatten) :
  tree && typeof tree === 'object' && 'children' in tree ? [tree as Node, ...flatten((tree as Node).children)] : [];

function setup() {
  let slot = 0, returned = 0;
  const state: any[] = [], dependencies: unknown[][] = [], pending: (() => void)[] = [];
  const handlers = new Set<() => boolean>();
  const cleanups: ((() => void) | undefined)[] = [];
  const exports: Record<string, any> = {};
  const js = ts.transpileModule(readFileSync('screens/AdvisorHubScreen.tsx', 'utf8'), {
    fileName: 'AdvisorHubScreen.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  runInNewContext(js, { exports, require: (id: string) => {
    if (id === 'react') return {
      createElement: (type: unknown, props: Record<string, any>, ...children: unknown[]) => ({ type, props: props || {}, children }),
      useState: (initial: unknown) => { const i = slot++; if (!(i in state)) state[i] = initial; return [state[i], (value: unknown) => { state[i] = value; }]; },
      useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
        const i = slot++;
        if (!dependencies[i] || deps.some((v, j) => !Object.is(v, dependencies[i][j]))) {
          dependencies[i] = deps;
          pending.push(() => { cleanups[i]?.(); cleanups[i] = effect() || undefined; });
        }
      },
    };
    if (id === 'react-native') return {
      View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', StyleSheet: { create: (v: unknown) => v },
      Keyboard: { dismiss() {} }, BackHandler: { addEventListener: (_event: string, handler: () => boolean) => {
        handlers.add(handler); return { remove: () => handlers.delete(handler) };
      } },
    };
    if (id.endsWith('/theme')) return { COLORS: {} };
    return id;
  } });
  const props = { active: false, compact: false, lang: 'fr', onBackToSections: () => { returned++; } };
  const render = () => {
    let tree: Node[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      slot = 0; tree = flatten(exports.default(props));
      if (!pending.length) return tree;
      pending.splice(0).forEach(effect => effect());
    }
    throw new Error('Unstable effects');
  };
  return { props, render, handlers, returned: () => returned };
}

test('OpenAI opens on first visit, local stays accessible, and both back actions return to sections', () => {
  const app = setup();
  assert.equal(app.render().some(n => n.type === './OpenAIChatScreen'), false, 'No cloud session access before visiting AI');
  app.props.active = true;
  const initial = app.render();
  assert.equal(initial.find(n => n.type === './OpenAIChatScreen')?.props.active, true);
  const tabs = initial.filter(n => n.props.accessibilityRole === 'tab');
  assert.equal(tabs[0].props.accessibilityState.selected, true);
  tabs[1].props.onPress();
  assert.equal(app.render().find(n => n.type === './OpenAIChatScreen')?.props.active, false);
  assert.equal(app.handlers.size, 0);
  tabs[0].props.onPress();
  const opened = app.render();
  opened.find(n => n.type === './OpenAIChatScreen')!.props.onBack();
  assert.equal(app.returned(), 1);
  assert.equal([...app.handlers][0](), true);
  assert.equal(app.returned(), 2);
  app.props.compact = true;
  app.render();
  assert.equal(app.handlers.size, 0, 'Keyboard handles Back before navigation');
  app.props.compact = false;
  app.props.active = false;
  assert.equal(app.render().find(n => n.type === './OpenAIChatScreen')?.props.active, false);
  assert.equal(app.handlers.size, 0, 'Inactive advisor does not intercept Back');
});
