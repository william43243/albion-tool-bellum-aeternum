import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the actual screen's state expression and JSX branches with lightweight
// elements. This tests visibility/disabled behavior, not a native visual render.
const source = readFileSync('screens/AdvisorScreen.tsx', 'utf8');
const ast = ts.createSourceFile('AdvisorScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let preparingExpression = '';
let inputActions = '';
let resetDisabled = '';
let inputEditable = '';

function visit(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'preparingContext') {
    preparingExpression = node.initializer?.getText(ast) ?? '';
  }
  if (ts.isJsxExpression(node) && node.expression && ts.isConditionalExpression(node.expression)
    && node.expression.condition.getText(ast) === 'preparingContext') {
    inputActions = node.expression.getText(ast);
  }
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
    const attr = (name: string) => attributes.find((item) => item.name.getText(ast) === name);
    const handler = attr('onPress');
    if (handler?.initializer && ts.isJsxExpression(handler.initializer)
      && handler.initializer.expression?.getText(ast) === 'handleReset') {
      const disabled = attr('disabled')?.initializer;
      if (disabled && ts.isJsxExpression(disabled)) resetDisabled = disabled.expression?.getText(ast) ?? '';
    }
    if (node.tagName.getText(ast) === 'TextInput' && attr('onSubmitEditing')?.initializer?.getText(ast) === '{handleSend}') {
      const editable = attr('editable')?.initializer;
      if (editable && ts.isJsxExpression(editable)) inputEditable = editable.expression?.getText(ast) ?? '';
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);

function evaluate(expression: string, environment: Record<string, unknown>): any {
  assert.ok(expression, 'Expected expression is present in the screen');
  const js = ts.transpileModule(`const value = (${expression});`, {
    fileName: 'behavior.tsx',
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function('env', `with (env) { ${js}; return value; }`)(environment);
}

function screen(streaming: boolean, activeTicket: boolean) {
  const stop = () => {};
  const send = () => {};
  const environment: Record<string, any> = {
    streaming,
    renderStream: activeTicket ? { session: 1, stream: 1 } : null,
    advisorSession: { isStreamCurrent: () => activeTicket },
    React: { createElement: (type: string, props: object, ...children: unknown[]) => ({ type, props, children }) },
    View: 'View', Text: 'Text', ActivityIndicator: 'ActivityIndicator', TouchableOpacity: 'TouchableOpacity',
    styles: {}, COLORS: {}, SPACING: {}, lang: 'fr', input: 'question', fetchingData: false,
    engineState: 'ready', handleStop: stop, handleSend: send,
  };
  environment.preparingContext = evaluate(preparingExpression, environment);
  return {
    action: evaluate(inputActions, environment),
    resetDisabled: evaluate(resetDisabled, environment),
    inputEditable: evaluate(inputEditable, environment),
    stop,
    send,
  };
}

test('context preparation shows progress and disables reset and input without a Stop action', () => {
  const state = screen(true, false);
  assert.equal(state.action.type, 'View');
  assert.equal(state.action.props.accessibilityRole, 'progressbar');
  assert.equal(state.action.props.accessibilityLabel, 'Préparation du contexte');
  assert.equal(state.resetDisabled, true);
  assert.equal(state.inputEditable, false);
});

test('active generation still offers Stop and idle state returns the Send action', () => {
  const active = screen(true, true);
  assert.equal(active.action.type, 'TouchableOpacity');
  assert.equal(active.action.props.onPress, active.stop);
  assert.equal(active.action.props.accessibilityLabel, 'Arrêter la génération');
  assert.equal(active.resetDisabled, false);

  const idle = screen(false, false);
  assert.equal(idle.action.type, 'TouchableOpacity');
  assert.equal(idle.action.props.onPress, idle.send);
  assert.equal(idle.resetDisabled, false);
  assert.equal(idle.inputEditable, true);
});
