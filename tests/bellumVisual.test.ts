import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { COLORS } from '../constants/theme';

type UiNode = { type: unknown; props: Record<string, any>; children: unknown[] };
const react = {
  createElement: (type: unknown, props: Record<string, any>, ...children: unknown[]): UiNode => ({ type, props: props || {}, children }),
  Fragment: Symbol('Fragment'),
};

function readModule(file: string, deps: (id: string) => any) {
  const js = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file, compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(js, { exports, require: deps }, { filename: file });
  return exports.default;
}

function nodes(tree: unknown): UiNode[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object' || !('children' in tree)) return [];
  const node = tree as UiNode;
  return [node, ...node.children.flatMap(nodes)];
}

function luminosity(hex: string) {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  const weights = [0.2126, 0.7152, 0.0722];
  return weights.reduce((total, weight, i) => {
    const n = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return total + weight * (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
  }, 0);
}
function contrast(foreground: string, background: string) {
  const a = luminosity(foreground), b = luminosity(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('paper surfaces keep regular, secondary and selected copy readable, including common states', () => {
  const surfaces = [COLORS.background, COLORS.backgroundElevated, COLORS.surface, COLORS.surface2, COLORS.primarySoft];
  for (const background of surfaces) {
    for (const foreground of [COLORS.text, COLORS.textSecondary, COLORS.textMuted, COLORS.primary]) {
      assert.ok(contrast(foreground, background) >= 4.5, foreground + ' on ' + background);
    }
  }
  for (const [foreground, background] of [
    [COLORS.onPrimary, COLORS.primary], [COLORS.profit, COLORS.profitBg],
    [COLORS.loss, COLORS.lossBg], [COLORS.warning, COLORS.surface], [COLORS.info, COLORS.surface],
  ]) assert.ok(contrast(foreground, background) >= 4.5, foreground + ' on ' + background);
  for (const [city, ink] of Object.entries(COLORS.cityColors)) {
    assert.ok(contrast(ink, COLORS.surface) >= 3, city + ' data ink');
  }
});

const routeKeys = ['marketplace', 'crafting', 'flipping', 'history', 'advisor', 'map', 'plan', 'settings'];
const ICON = Symbol('BellumIcon');
const MODAL = Symbol('Modal');
const PRESSED = { pressed: false };

async function navigation(width: number, fontScale: number, horizontalInset = 0, lang = 'fr') {
  let slot = 0;
  const state: unknown[] = [];
  const effectQueue: (() => void)[] = [];
  const App = readModule('App.tsx', id => {
    if (id === 'react') return {
      ...react, useEffect: (effect: () => void) => { effectQueue.push(effect); }, useState: (initial?: unknown) => {
        const index = slot++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (value: any) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
      },
    };
    if (id === 'react-native') return {
      Modal: MODAL, View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable',
      StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, hairlineWidth: 1 },
      useWindowDimensions: () => ({ width, fontScale }), Keyboard: { dismiss: () => {} },
    };
    if (id.endsWith('/BellumIcon')) return ICON;
    if (id.endsWith('/theme')) return { COLORS, ...require('../constants/theme') };
    if (id === 'react-native-safe-area-context') return {
      SafeAreaProvider: 'SafeAreaProvider', useSafeAreaInsets: () => ({ bottom: 10, top: 20, left: horizontalInset, right: horizontalInset }),
    };
    if (id.endsWith('/useLanguage')) return { useLanguage: () => ({ lang, loaded: true, t: (key: string) => key }) };
    if (id.endsWith('/useServer')) return { useServer: () => ({ serverLoaded: true }) };
    if (id.endsWith('/usePlayerCity')) return { usePlayerCity: () => ({ city: 'Martlock', cityLoaded: true }) };
    if (id.endsWith('/useAndroidKeyboardViewport')) return { useAndroidKeyboardViewport: () => ({ keyboardVisible: false }) };
    if (id.endsWith('/useAutomaticUpdate')) return { useAutomaticUpdate: () => ({ promptManifest: null, dismiss() {} }) };
    if (id === './lib/analytics') return { initializeAnalyticsConsent: () => Promise.resolve('refused'), trackPageView: () => {}, trackToolUse: () => {} };
    return id;
  });
  const render = () => {
    slot = 0;
    const [component] = (App() as UiNode).children;
    return nodes((component as UiNode & {type: () => UiNode}).type());
  };
  render();
  effectQueue.splice(0).forEach(effect => effect());
  await Promise.resolve();
  return render;
}

function iconName(button: UiNode) {
  return nodes(button.children).find(node => node.type === ICON)?.props.name;
}

function styles(button: UiNode) {
  const style = typeof button.props.style === 'function' ? button.props.style(PRESSED) : button.props.style;
  return Object.assign({}, ...[style].flat().filter(Boolean));
}

const layouts = [
  [240, 1, 0, 3], [289, 1, 0, 3], [290, 1, 0, 4], [360, 1.3, 0, 4],
  [780, 1, 12, 4], [780, 1, 0, 8], [900, 1.3, 0, 4], [1200, 1.5, 0, 8],
] as const;

for (const [width, fontScale, inset, direct] of layouts) {
  test('shell routes and hit targets at ' + width + 'dp, inset ' + inset + ', font scale ' + fontScale, async () => {
    const render = await navigation(width, fontScale, inset);
    const initial = render();
    const tabOf = (n: UiNode) => n.props.accessibilityRole === 'tab';
    const moreOf = (n: UiNode) => n.type === 'Pressable' && iconName(n) === 'more';
    const modalOf = (n: UiNode) => n.type === MODAL;
    const tabs = initial.filter(tabOf);
    assert.equal(iconName(tabs[0]), 'advisor', 'AI agent stays directly reachable on every screen width');
    const more = initial.find(moreOf);
    assert.equal(tabs.length, direct);
    assert.equal(Boolean(more), direct < 8);
    const railTargets = more ? [...tabs, more] : tabs;
    let minimumRailWidth = 0;
    for (const target of railTargets) {
      assert.ok(styles(target).minHeight >= 48);
      assert.ok(styles(target).minWidth >= 48);
      minimumRailWidth += styles(target).minWidth;
    }
    assert.ok(minimumRailWidth <= width - inset * 2);
    const city = initial.find(n => n.type === 'Pressable' && iconName(n) === 'pin');
    assert.ok(city && styles(city).minWidth >= 48 && styles(city).minHeight >= 48);
    let overflow: UiNode[] = [];
    if (more) {
      assert.equal(more.props.accessibilityRole, 'button');
      assert.equal(more.props.accessibilityLabel, 'Autres outils');
      assert.equal(more.props.accessibilityState.expanded, false);
      more.props.onPress();
      const opened = render();
      assert.equal(opened.find(moreOf)?.props.accessibilityState.expanded, true);
      const modal = opened.find(modalOf)!;
      assert.equal(modal.props.visible, true);
      const modalPressables = nodes(modal.children).filter(n => n.props.accessibilityRole === 'button');
      const close = modalPressables.find(n => iconName(n) === 'close');
      assert.ok(close && styles(close).minWidth >= 48 && styles(close).minHeight >= 48);
      overflow = modalPressables.filter(n => iconName(n) !== 'close');
      for (const row of overflow) assert.ok(styles(row).minHeight >= 48 && row.props.accessibilityLabel);
      assert.ok(overflow.length >= 1);
      overflow[0].props.onPress();
      const afterSelect = render();
      assert.equal(afterSelect.find(modalOf)?.props.visible, false);
      assert.ok(afterSelect.find(moreOf)?.props.accessibilityLabel.endsWith(overflow[0].props.accessibilityLabel));
      afterSelect.find(moreOf)?.props.onPress();
      const afterReopen = render();
      afterReopen.find(modalOf)?.props.onRequestClose();
      assert.equal(render().find(modalOf)?.props.visible, false);
    }
    assert.deepEqual([...tabs, ...overflow].map(iconName).sort(), [...routeKeys].sort());
    tabs.at(-1)?.props.onPress();
    assert.equal(render().filter(tabOf).filter(n => n.props.accessibilityState.selected).length, 1);
  });
}

test('direct AI entry opens OpenAI and returns to the market without losing the mounted advisor', async () => {
  for (const [lang, label] of [['fr', 'Agent IA'], ['en', 'AI agent'], ['es', 'Agente IA']]) {
    const render = await navigation(360, 1, 0, lang);
    const agent = render().find(n => n.props.accessibilityRole === 'tab' && iconName(n) === 'advisor')!;
    assert.equal(agent.props.accessibilityLabel, label);
    agent.props.onPress();
    const opened = render();
    const hub = opened.find(n => n.type === './screens/AdvisorHubScreen')!;
    assert.equal(hub.props.active, true);
    assert.equal(opened.filter(n => n.props.accessibilityRole === 'tab').length, 0);
    hub.props.onBackToSections();
    const returned = render();
    assert.equal(returned.find(n => n.type === './screens/AdvisorHubScreen')?.props.active, false);
    assert.equal(iconName(returned.find(n => n.props.accessibilityRole === 'tab' && n.props.accessibilityState.selected)!), 'marketplace');
  }
});

test('all declared SVG names, including names used by screens, produce a real vector', () => {
  const filename = 'components/BellumIcon.tsx';
  const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const alias = source.statements.find(stmt => ts.isTypeAliasDeclaration(stmt) && stmt.name.text === 'BellumIconName');
  assert.ok(alias && ts.isTypeAliasDeclaration(alias) && ts.isUnionTypeNode(alias.type));
  const names = alias.type.types.map(t => {
    assert.ok(ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal));
    return t.literal.text;
  });
  for (const name of routeKeys) assert.ok(names.includes(name), name);

  const Svg = 'Svg', Path = 'Path', Circle = 'Circle';
  const renderIcon = readModule(filename, id => id === 'react' ? react :
    id === 'react-native-svg' ? { __esModule: true, default: Svg, Path, Circle } : { COLORS });
  for (const name of names) for (const selected of [false, true]) {
    const svg = renderIcon({ name, selected, size: 20 }) as UiNode;
    assert.equal(svg.type, Svg);
    assert.equal(svg.props.accessible, false);
    assert.equal(svg.props.viewBox, '0 0 24 24');
    const shapes = nodes(svg).filter(n => n.type === Path || n.type === Circle);
    assert.ok(shapes.length, name);
    for (const shape of shapes) {
      if (shape.type === Path) assert.match(shape.props.d, /^\s*[mM][\s\d-]/, name);
      else assert.ok(Number.isFinite(shape.props.r) && shape.props.r > 0, name);
    }
  }

  const appFiles = ['App.tsx', ...['components', 'screens'].flatMap(dir =>
    readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(f => f.endsWith('.tsx')).map(f => join(dir, f)))];
  let references = 0;
  for (const file of appFiles) {
    const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function check(node: ts.Node) {
      if (ts.isJsxAttribute(node) && node.name.getText(src) === 'name' && node.parent.parent.tagName.getText(src) === 'BellumIcon') {
        const value = node.initializer;
        if (value && ts.isStringLiteral(value)) {
          references++;
          assert.ok(names.includes(value.text), file + ': ' + value.text);
        }
      }
      ts.forEachChild(node, check);
    }
    check(src);
  }
  assert.ok(references >= 8, 'screen icon entries exercised');
});
