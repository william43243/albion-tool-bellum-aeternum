import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { canSubmitChat, chooseAvailableModel, completedChatHistory, inlineParts, markdownLines } from '../components/chat/presentation';

const source = readFileSync('screens/OpenAIChatScreen.tsx', 'utf8');
const ast = ts.createSourceFile('OpenAIChatScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name: string, environment: Record<string, any>) {
  let expression = '';
  function walk(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node.getText(ast);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer && ts.isCallExpression(node.initializer)) expression = `const ${name} = ${node.initializer.arguments[0].getText(ast)};`;
    ts.forEachChild(node, walk);
  }
  walk(ast);
  assert.ok(expression);
  const js = ts.transpileModule(expression, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('env', `with(env) { ${js}; return ${name}; }`)(environment);
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function harness() {
  const pending = deferred<string>();
  let event: (value: any) => void = () => {};
  let args: any;
  let requests = 0;
  const env: Record<string, any> = {
    input: 'Show prices', ready: true, model: 'account-model', selected: { displayName: 'Account model' }, server: 'europe', SERVERS: { europe: 'https://europe.albion-online-data.com' },
    running: { current: false }, cancelling: { current: false }, alive: { current: true }, epoch: { current: 0 }, nextId: { current: 0 }, followBottom: { current: true },
    messages: [], error: '', busy: false, fastTest: false, reasoningHigh:false, playerCity:'Caerleon', isPremium:true,
    canSubmitChat, completedChatHistory,
    setStopping(_value: boolean) {},
    setFastTest(value: boolean) { env.fastTest = value; },
    setBusy(value: boolean) { env.busy = value; },
    setInput(value: any) { env.input = typeof value === 'function' ? value(env.input) : value; },
    setError(value: string) { env.error = value; },
    setMessages(fn: any) { env.messages = fn(env.messages); },
    refreshSession: async () => {},
    tr: (_fr: string, en: string) => en,
    Siwc: { generate: (options: any, listener: any) => { args = options; event = listener; requests++; return pending.promise; }, cancel: async () => {} },
  };
  return { env, pending, send: callback('send', env), stop: callback('stop', env), emit: (value: any) => event(value), args: () => args, requests: () => requests };
}

test('catalog selection only uses available account models, and submit needs every precondition', () => {
  assert.equal(chooseAvailableModel('gone', [{ id: 'first' }, { id: 'second' }]), 'first');
  assert.equal(chooseAvailableModel('second', [{ id: 'first' }, { id: 'second' }]), 'second');
  assert.equal(chooseAvailableModel('gone', []), '');
  assert.equal(canSubmitChat('Hi', true, 'real-model', false), true);
  for (const args of [[' ', true, 'model', false], ['Hi', false, 'model', false], ['Hi', true, '', false], ['Hi', true, 'model', true]] as const) assert.equal(canSubmitChat(args[0], args[1], args[2], args[3]), false);
});
test('markdown preserves exact numeric text and leaves HTML and URLs inert', () => {
  const text = '<img src="https://example.com/tracker"> 1,234.50 silver';
  assert.deepEqual(markdownLines(text), [{ kind: 'text', text }]);
  assert.deepEqual(inlineParts('**Profit** `1,234.50`'), [{ text: 'Profit', bold: true }, { text: ' ' }, { text: '1,234.50', code: true }]);
  assert.equal(markdownLines('```\n**literal**\n```')[1].kind, 'code');
  assert.equal(markdownLines('- Price: 0.00001')[0].text, '• Price: 0.00001');
});
test('failed or stopped turns are never duplicated in retry history', () => {
  assert.deepEqual(completedChatHistory([
    { role: 'user', content: 'old' }, { role: 'assistant', content: 'answer', state: 'completed' },
    { role: 'user', content: 'retry' }, { role: 'assistant', content: 'partial', state: 'error' },
  ]), [{ role: 'user', content: 'old' }, { role: 'assistant', content: 'answer' }]);
});
test('streaming is incremental and tool results preserve call IDs and exact data', async () => {
  const h = harness(); const work = h.send();
  h.emit({ type: 'delta', text: 'Result: ' }); h.emit({ type: 'delta', text: '123.45' });
  h.emit({ type: 'tool', name: 'get_prices', callId: 'one', status: 'running' });
  h.emit({ type: 'tool', name: 'get_prices', callId: 'two', status: 'running' });
  h.emit({ type: 'tool', name: 'get_prices', callId: 'one', status: 'completed', result: '{"price":123.45,"age":900}' });
  const assistant = h.env.messages[1];
  assert.equal(assistant.content, 'Result: 123.45'); assert.equal(assistant.tools.length, 2);
  assert.equal(assistant.tools[0].result, '{"price":123.45,"age":900}');
  assert.equal(assistant.tools[1].status, 'running');
  h.emit({ type: 'completed' }); h.pending.resolve('Result: 123.45'); await work;
  assert.equal(h.env.messages[1].state, 'completed'); assert.equal(h.env.busy, false);
  assert.equal(h.env.messages[1].tools[1].status, 'error'); // Model completion is not proof of tool success.
  assert.equal(h.args().fast, undefined);
});
test('EOF without completed event is an error, not a successful assistant answer', async () => {
  const h = harness(); const work = h.send(); h.pending.resolve('partial'); await work;
  assert.equal(h.env.messages[1].state, 'error'); assert.match(h.env.error, /STREAM_INCOMPLETE/); assert.equal(h.env.input, 'Show prices');
});
test('double send is locked synchronously and failed tools become error', async () => {
  const h = harness(); const work = h.send(); await h.send(); assert.equal(h.requests(), 1);
  h.emit({ type: 'tool', name: 'get_prices', callId: 'one', status: 'running' }); h.pending.reject(new Error('Network unavailable')); await work;
  assert.equal(h.env.messages[1].tools[0].status, 'error'); assert.equal(h.env.busy, false);
});
test('stop rejects late tokens and completion, and unlocks only after cancellation', async () => {
  const h = harness(); const cancelled = deferred<void>(); h.env.Siwc.cancel = () => cancelled.promise;
  const work = h.send(); h.emit({ type: 'delta', text: 'partial' }); h.stop();
  assert.equal(h.env.running.current, true); assert.equal(h.env.messages[1].state, 'stopped');
  h.emit({ type: 'delta', text: ' stale' }); h.emit({ type: 'completed' }); h.pending.resolve('stale'); await work;
  assert.equal(h.env.messages[1].content, 'partial'); assert.equal(h.env.busy, true);
  cancelled.resolve(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.env.running.current, false); assert.equal(h.env.busy, false);
});
test('source has no control-character corruption and no remote markdown renderer', () => {
  assert.doesNotMatch(source, /[\x00-\x08\x0b\x0c\x0e-\x1f]/);
  assert.doesNotMatch(readFileSync('components/chat/ChatMarkdown.tsx', 'utf8'), /<WebView|<Image\s|Linking\.openURL/);
  assert.match(source, /Fast support is unconfirmed/);
});

test('stale session read cannot reconnect UI after disconnect invalidates it', async () => {
  const pending = deferred<any>();
  let applied = false;
  const env: Record<string, any> = {
    disconnecting: { current: false }, sessionRead: { current: 0 }, alive: { current: true },
    Siwc: { getSession: () => pending.promise },
    account: { current: undefined }, priorStatus: { current: 'disconnected' },
    stop: () => {}, epoch: { current: 0 }, modelLoad: { current: 0 },
    setMessages: () => {}, setModels: () => {}, setModel: () => {}, setLoadingModels: () => {},
    setSession: () => { applied = true; }, setSessionVerified: () => {}, setConnecting: () => {},
    setError: () => {}, setCheckingSession: () => {}, loadModels: async () => {},
  };
  const refresh = callback('refreshSession', env); const work = refresh();
  env.sessionRead.current++; pending.resolve({ status: 'connected', email: 'old-account@example.test' }); await work;
  assert.equal(applied, false); assert.equal(env.priorStatus.current, 'disconnected');
});
test('late model catalog cannot repopulate UI after logout invalidates its request', async () => {
  const pending = deferred<any[]>(); let applied = false;
  const env: Record<string, any> = {
    modelLoad: { current: 0 }, alive: { current: true }, Siwc: { getModels: () => pending.promise },
    AsyncStorage: { getItem: async () => null }, OPENAI_MODEL_KEY: 'model',
    setLoadingModels: () => {}, setModels: () => { applied = true; }, setModel: () => {}, setError: () => {}, chooseAvailableModel,
  };
  const work = callback('loadModels', env)(); env.modelLoad.current++;
  pending.resolve([{ id: 'old-account-model', displayName: 'Old account' }]); await work;
  assert.equal(applied, false);
});
test('catalog restores the chosen model and never silently substitutes an unavailable one', async () => {
  let selected = '';
  let saved = 'luna';
  let available = [{ id: 'sol' }, { id: 'luna' }];
  const env: Record<string, any> = {
    modelLoad: { current: 0 }, alive: { current: true }, Siwc: { getModels: async () => available },
    AsyncStorage: { getItem: async () => saved }, OPENAI_MODEL_KEY: 'model', chooseAvailableModel,
    setLoadingModels: () => {}, setModels: () => {}, setModel: (fn: any) => { selected = fn(selected); }, setError: () => {},
  };
  const load = callback('loadModels', env);
  await load(); assert.equal(selected, 'luna');
  selected = ''; available = [{ id: 'sol' }];
  await load(); assert.equal(selected, '');
  saved = ''; await load(); assert.equal(selected, 'sol');
});
test('a denied plan cannot enable submission even with a connected session and model', () => {
  let expression = '';
  function walk(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'ready') expression = node.initializer!.getText(ast);
    ts.forEachChild(node, walk);
  }
  walk(ast);
  const ready = new Function('env', `with(env) { return ${expression}; }`);
  const env = { connected: true, sessionVerified: true, session: { planEnabled: false }, checkingSession: false, connecting: false, loadingModels: false, selected: { id: 'real' } };
  assert.equal(ready(env), false);
  env.session.planEnabled = true; assert.equal(ready(env), true);
  env.sessionVerified = false; assert.equal(ready(env), false);
});

test('polling while native approval dialog is open keeps sign-in busy', async () => {
  let connecting = false;
  const env: Record<string, any> = {
    disconnecting: { current: false }, sessionRead: { current: 0 }, alive: { current: true }, connectPending: { current: true },
    Siwc: { getSession: async () => ({ status: 'disconnected' }) },
    account: { current: undefined }, priorStatus: { current: 'disconnected' },
    setSession: () => {}, setSessionVerified: () => {}, setConnecting: (value: boolean) => { connecting = value; },
    setError: () => {}, setCheckingSession: () => {}, loadModels: async () => {},
  };
  await callback('refreshSession', env)(); assert.equal(connecting, true);
});
test('sign-in is synchronously locked and late resolution after sign-out cannot refresh session', async () => {
  const pending = deferred<void>(); let refreshes = 0; let connects = 0;
  const env: Record<string, any> = {
    connecting: false, busy: false, connectPending: { current: false }, disconnecting: { current: false }, authAttempt: { current: 0 }, alive: { current: true },
    setConnecting: () => {}, setError: () => {},
    Siwc: { connect: () => { connects++; return pending.promise; } }, refreshSession: async () => { refreshes++; },
  };
  const connect = callback('connect', env); const work = connect(); await connect(); assert.equal(connects, 1);
  env.authAttempt.current++; pending.resolve(); await work; assert.equal(refreshes, 0);
});

test('Fast experiment requires explicit arming, is one-shot, and displays actual unconfirmed tier', async () => {
  const h = harness(); h.env.fastTest = true;
  const work = h.send();
  assert.equal(h.args().fast, true); assert.equal(h.args().experimentalFast, true); assert.equal(h.env.fastTest, false);
  h.emit({ type: 'completed', requestedServiceTier: 'fast', effectiveServiceTier: 'default', fastConfirmed: false });
  h.pending.resolve('Normal tier answer'); await work;
  assert.equal(h.env.messages[1].effectiveServiceTier, 'default'); assert.equal(h.env.messages[1].fastConfirmed, false);
});
test('Fast confirmation is taken only from backend completion, not from requested mode', async () => {
  const h = harness(); h.env.fastTest = true; const work = h.send();
  assert.equal(h.env.messages[1].fastConfirmed, undefined);
  h.emit({ type: 'completed', requestedServiceTier: 'fast', effectiveServiceTier: 'priority', fastConfirmed: true });
  h.pending.resolve('Confirmed response'); await work;
  assert.equal(h.env.messages[1].fastConfirmed, true); assert.equal(h.env.messages[1].effectiveServiceTier, 'priority');
});
test('unsupported Fast is an explicit failed turn without hidden normal-mode retry', async () => {
  const h = harness(); h.env.fastTest = true; const work = h.send();
  h.pending.reject(new Error('FAST_UNSUPPORTED')); await work;
  assert.equal(h.requests(), 1); assert.equal(h.env.messages[1].state, 'error'); assert.equal(h.env.messages[1].fastConfirmed, undefined);
  assert.equal(h.env.fastTest, false); assert.match(h.env.error, /FAST_UNSUPPORTED/);
});

for (const code of ['EMPTY_MODEL_RESPONSE', 'MODEL_REFUSAL', 'STREAM_OUTPUT_CONFLICT']) {
  test(`${code} preserves the prompt and a manual retry does not duplicate it`, async () => {
    const h = harness(); const first = h.send(); h.pending.reject(new Error(code)); await first;
    assert.equal(h.env.input, 'Show prices'); assert.equal(h.env.error, code);
    assert.equal(h.env.messages[1].state, 'error');
    await h.send();
    assert.deepEqual(h.args().messages, [{ role: 'user', content: 'Show prices' }]);
    assert.equal(h.requests(), 2); // Only the explicit second send retries.
  });
}

test('current city and Premium settings accompany each OpenAI request',async()=>{
 const h=harness();h.env.playerCity='Thetford';h.env.isPremium=false;
 const work=h.send();assert.equal(h.args().playerCity,'Thetford');assert.equal(h.args().isPremium,false);
 h.emit({type:'delta',text:'Ready'});h.emit({type:'completed'});h.pending.resolve('Ready');await work;
});
