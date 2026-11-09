import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createAdvisorSession } from '../lib/advisorSession';
import { getMarketplaceFeeAnswer } from '../lib/advisorFees';
import { buildAnalysisPrompt as realAnalysisPrompt, buildQuestionPrompt as realQuestionPrompt } from '../lib/advisor';
import { AVAILABLE_MODELS, getModelById } from '../lib/models';
import { evaluateAdvisorDecision, formatAdvisorDecision } from '../lib/advisorDecision';

// Execute the screen's real callbacks with deferred IO and state setters, not
// React Native or inference. AST extraction keeps the tests tied to production.
const source = readFileSync('screens/AdvisorScreen.tsx', 'utf8');
const ast = ts.createSourceFile('AdvisorScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map<string, string>();
let serverEffect = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)
    && node.initializer.expression.getText(ast) === 'useCallback') {
    callbacks.set(node.name.text, node.initializer.arguments[0].getText(ast));
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
    && node.arguments[0].getText(ast).includes('previousServerRef.current === server')) {
    serverEffect = node.arguments[0].getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
function compile(expression: string, env: Record<string, any>): any {
  assert.ok(expression);
  const js = ts.transpileModule(`const callback = ${expression};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('env', `with (env) { ${js}; return callback; }`)(env);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness() {
  const advisorSession = createAdvisorSession('americas');
  advisorSession.markReady(advisorSession.capture());
  const state: Record<string, any> = {
    messages: [{ role: 'assistant', content: 'old conversation' }], input: 'draft',
    engineState: 'ready', activeModelId: 'qwen', screen: 'chat', tokenCount: 250,
    marketCtx: { server: 'americas', price: 12345 }, selectedItem: { id: 'A', n: 'Item A' },
    streaming: false, streamBuffer: '', fetchingData: false, showItemPicker: false,
    backendInfo: { backendUsed: 'gpu', isMediaTek: false, hasVision: true },
    isPremium: false,
  };
  const requests: ReturnType<typeof deferred<any>>[] = [];
  const streams: { prompt: string; callbacks: any }[] = [];
  const alerts: any[] = [];
  const analytics = { generation: 1 as number | null, events: [] as string[] };
  const track = (name: string, token: number | null) => { if (token !== null && token === analytics.generation) analytics.events.push(name); };
  const resets: string[] = [];
  const refs = {
    advisorSession, previousServerRef: { current: 'americas' }, activeModelRef: { current: 'qwen' as string | null },
    cleanupRef: { current: null as (() => void) | null }, resetInFlightRef: { current: null as Promise<void> | null }, resetSessionRef: { current: null },
    modelAttemptRef: { current: 0 }, initializedModelRef: { current: 'qwen' as string | null },
    premiumRef: { current: false },
    streamTextRef: { current: '' },
  };
  const llm: Record<string, any> = {
    async resetConversation(_prompt: string, server: string) { resets.push(server); return true; },
    async initialize() { return { backendUsed: 'cpu', isMediaTek: false, hasVision: false }; },
    async destroy() { return true; },
    sendMessage(prompt: string, cb: any) { streams.push({ prompt, callbacks: cb }); return () => {}; },
    sendMessageWithImage(prompt: string, _path: string, cb: any) { streams.push({ prompt, callbacks: cb }); return () => {}; },
  };
  const setters = Object.fromEntries(Object.keys(state).map((key) => [
    `set${key[0].toUpperCase()}${key.slice(1)}`,
    (next: any) => { state[key] = typeof next === 'function' ? next(state[key]) : next; },
  ]));
  function render(server = 'americas') {
    advisorSession.configure(server);
    refs.premiumRef.current = state.isPremium;
    const env: Record<string, any> = {
      ...state, ...refs, ...setters, server, renderSession: advisorSession.capture(), lang: 'fr', playerCity: null,
      renderRequest: advisorSession.captureRequest(),
      renderStream: advisorSession.captureStream(),
      getMarketplaceFeeAnswer,
      getModelById, evaluateAdvisorDecision, formatAdvisorDecision,
      t: (key: string) => key, LLM: llm, Platform: { OS: 'android' },
      SERVERS: { americas: 'url:americas', europe: 'url:europe', asia: 'url:asia' },
      SYSTEM_PROMPT_TOKENS: 250, RESET_THRESHOLD: 3686, WARNING_THRESHOLD: 3072, MAX_TOKENS: 4096,
      estimateTokens: (text: string) => Math.ceil(text.length / 4),
      buildSystemPrompt: (_lang: string, region: string) => region,
      buildAnalysisPrompt: (ctx: any) => JSON.stringify(ctx),
      buildQuestionPrompt: (question: string, ctx: any) => JSON.stringify({ question, ctx }),
      fetchMarketContext: () => { const d = deferred<any>(); requests.push(d); return d.promise; },
      parseMarketQuery: () => ({}), onCityDetected: undefined,
      captureAnalyticsAuthorization: () => analytics.generation, trackAIModelStart() {},
      trackAIPrompt: (_model: string, token: number | null) => track('prompt', token),
      trackAIImageSent: (_model: string, token: number | null) => track('image', token),
      getModelFilename: (model: any) => model.filename,
      Alert: { alert: (...args: any[]) => alerts.push(args) },
      ImagePicker: {},
    };
    for (const [name, expression] of callbacks) env[name] = compile(expression, env);
    env.serverEffect = compile(serverEffect, env);
    return env;
  }
  return { advisorSession, state, refs, llm, requests, streams, alerts, resets, render, analytics };
}

test('server switch clears market context, preserves draft/transcript, and resets native scope', async () => {
  const h = harness();
  const europe = h.render('europe');
  europe.serverEffect();
  await h.refs.resetInFlightRef.current;
  assert.equal(h.state.marketCtx, null);
  assert.equal(h.state.selectedItem, null);
  assert.equal(h.state.input, 'draft');
  assert.equal(h.state.messages[0].content, 'old conversation');
  assert.equal(h.state.messages.length, 2);
  assert.deepEqual(h.resets, ['url:europe']);
  assert.equal(h.state.engineState, 'ready');
});

test('old market response cannot commit even before the server-change effect', async () => {
  const h = harness();
  const pending = h.render().handleItemSelect({ id: 'A', n: 'Item A' });
  h.render('europe');
  h.requests[0].resolve({ server: 'americas', price: 12345 });
  await pending;
  assert.equal(h.state.marketCtx, null);
  assert.equal(h.streams.length, 0);
});

test('newest item request wins and stale errors cannot stop its spinner or alert', async () => {
  const h = harness();
  const env = h.render();
  const first = env.handleItemSelect({ id: 'A', n: 'A' });
  const second = env.handleItemSelect({ id: 'B', n: 'B' });
  h.requests[0].reject(new Error('old failure'));
  await first;
  assert.equal(h.state.fetchingData, true);
  assert.equal(h.alerts.length, 0);
  h.requests[1].resolve({ server: 'americas', item: 'B' });
  await second;
  assert.equal(h.state.selectedItem.id, 'B');
  assert.equal(h.state.marketCtx.item, 'B');
  assert.equal(h.state.fetchingData, false);
  assert.equal(h.streams.length, 1);
});

for (const action of ['handleReset', 'handleBackToModels', 'handleStartModel', 'unmount']) {
  test(`pending analysis cannot return after ${action}`, async () => {
    const h = harness();
    const env = h.render();
    const pending = env.handleItemSelect({ id: 'A', n: 'A' });
    if (action === 'unmount') h.advisorSession.dispose();
    else await env[action]({ id: 'other', filename: 'other.litertlm' });
    h.requests[0].resolve({ server: 'americas', price: 12345 });
    await pending;
    assert.equal(h.state.marketCtx, null);
    assert.equal(h.streams.length, 0);
  });
}

test('Europe then Asia resets are serialized and Asia is never lost to Europe deduplication', async () => {
  const h = harness();
  const europeReset = deferred<boolean>();
  const asiaReset = deferred<boolean>();
  h.llm.resetConversation = (_prompt: string, url: string) => {
    h.resets.push(url);
    return url === 'url:europe' ? europeReset.promise : asiaReset.promise;
  };
  h.render('europe').serverEffect();
  await tick();
  h.render('asia').serverEffect();
  const latestReset = h.refs.resetInFlightRef.current;
  europeReset.resolve(true);
  await tick();
  assert.deepEqual(h.resets, ['url:europe', 'url:asia']);
  assert.equal(h.state.engineState, 'loading');
  assert.equal(h.refs.resetInFlightRef.current, latestReset, 'old finally must not erase the Asia promise');
  asiaReset.resolve(true);
  await latestReset;
  assert.equal(h.state.engineState, 'ready');
  assert.equal(h.advisorSession.isReady(h.advisorSession.capture()), true);
});

test('server changes away and back before an effect still reconcile the invalidated session', async () => {
  const h = harness();
  h.render('europe');
  h.render('americas').serverEffect();
  await h.refs.resetInFlightRef.current;
  assert.deepEqual(h.resets, ['url:americas']);
  assert.equal(h.advisorSession.isReady(h.advisorSession.capture()), true);
  assert.equal(h.state.marketCtx, null);
  h.render('americas').serverEffect();
  assert.deepEqual(h.resets, ['url:americas'], 'a stable rerender must not reset again');
});

test('late stream callbacks cannot resurrect messages after reset or affect a newer stream', async () => {
  const h = harness();
  const env = h.render();
  env.sendToLLM('old');
  const old = h.streams[0].callbacks;
  await env.handleReset();
  h.render().sendToLLM('new');
  old.onToken('old token'); old.onDone(); old.onError('old error');
  assert.equal(h.state.messages.length, 1);
  assert.equal(h.state.messages[0].content, 'new');
  assert.equal(h.state.streaming, true);
  assert.equal(h.state.streamBuffer, '');
  h.streams[1].callbacks.onToken('current');
  h.streams[1].callbacks.onDone();
  assert.equal(h.state.messages.at(-1).content, 'current');
  assert.equal(h.state.streaming, false);
});

test('double send from the same render admits only one native inference', () => {
  const h = harness();
  const env = h.render();
  env.sendToLLM('one'); env.sendToLLM('two');
  assert.equal(h.streams.length, 1);
});

test('an unrestricted model still receives the actual analysis data after Hello, not the UI label', async () => {
  const h = harness();
  h.refs.activeModelRef.current = 'gemma4-e2b'; h.state.activeModelId = 'gemma4-e2b';
  h.state.marketCtx = null;
  h.state.messages = [];
  h.state.input = 'Hello';
  const hello = h.render();
  hello.buildQuestionPrompt = realQuestionPrompt;
  await hello.handleSend();
  assert.equal(h.streams.length, 1);
  assert.match(h.streams[0].prompt, /User question: Hello$/);
  h.streams[0].callbacks.onToken('Greetings');
  h.streams[0].callbacks.onDone();

  const item = { id: 'T4_BAG', n: "Adept's Bag", t: '4', c: 'equipment', sc: '', ss: '', iv: 0 };
  const ctx = {
    item, quality: 1, history7d: [], history30d: [],
    prices: [{ item_id: item.id, city: 'Martlock', quality: 1,
      sell_price_min: 12345, sell_price_max: 12345, buy_price_min: 12000, buy_price_max: 12000,
      sell_price_min_date: new Date().toISOString(), buy_price_max_date: new Date().toISOString() }],
  };
  const analysis = h.render();
  analysis.buildAnalysisPrompt = realAnalysisPrompt;
  const pending = analysis.handleItemSelect(item);
  h.requests[0].resolve(ctx);
  await pending;
  assert.equal(h.streams.length, 2);
  assert.match(h.streams[1].prompt, /^AI_DECISION_INPUT/);
  assert.match(h.streams[1].prompt, /Adept's Bag/);
  assert.match(h.streams[1].prompt, /Martlock: sell=12345/);
  assert.doesNotMatch(h.streams[1].prompt, /Greetings|User question: Hello|advisorAnalyzing/);
  assert.equal(h.state.messages.at(-1).content, "advisorAnalyzing Adept's Bag...");
  assert.equal(h.resets.length, 0, 'item analysis currently shares native conversation history');

  h.streams[0].callbacks.onToken('stale greeting');
  h.streams[0].callbacks.onDone();
  assert.equal(h.state.streamBuffer, '');
  assert.equal(h.state.streaming, true);
  // Preserve an off-topic model result rather than silently substituting advice.
  h.streams[1].callbacks.onToken('Hello.');
  h.streams[1].callbacks.onDone();
  assert.equal(h.state.messages.at(-1).content, 'Hello.');
});

test('a current item API failure alerts and never sends a replacement analysis or greeting', async () => {
  const h = harness();
  const pending = h.render().handleItemSelect({ id: 'T4_BAG', n: "Adept's Bag" });
  h.requests[0].reject(new Error('API error: 503'));
  await pending;
  assert.equal(h.streams.length, 0);
  assert.equal(h.state.marketCtx, null);
  assert.equal(h.state.fetchingData, false);
  assert.equal(h.alerts.length, 1);
  assert.equal(h.alerts[0][1], 'API error: 503');
  assert.equal(h.state.messages.length, 1, 'existing transcript remains unchanged');
});

test('restricted Qwen item analysis publishes canonical losses locally before any model text can appear', async () => {
  const h = harness();
  h.refs.activeModelRef.current = 'qwen35-08b'; h.state.activeModelId = 'qwen35-08b';
  h.state.messages = []; h.state.isPremium = false;
  h.llm.sendMessage = () => assert.fail('restricted item analysis must not call the model');
  const item = { id: 'T4_BAG', n: "Adept's Bag", t: '4', c: 'equipment', sc: '', ss: '', iv: 0 };
  const row = (city: string, sell: number, buy: number) => ({ item_id: item.id, city, quality: 1,
    sell_price_min: sell, buy_price_max: buy, sell_price_min_date: new Date().toISOString(), buy_price_max_date: new Date().toISOString() });
  const pending = h.render().handleItemSelect(item);
  h.state.isPremium = true; h.render(); // current setting at completion, not at fetch start
  h.requests[0].resolve({ server: 'americas', item, quality: 1, history7d: [], history30d: [],
    prices: [row('Bridgewatch', 3796, 0), row('Thetford', 0, 2993)] });
  await pending;
  const report = h.state.messages.at(-1);
  assert.equal(report.source, 'calculator'); assert.match(report.content, /non généré/);
  assert.match(report.content, /2993 − 3796 − 120 = -923/);
  assert.match(report.content, /Aucun signal positif/);
  assert.equal(h.streams.length, 0); assert.equal(h.state.streaming, false);
  assert.equal(h.state.fetchingData, false); assert.equal(h.state.tokenCount, 250);
});

test('restricted Qwen report rejects missing server provenance instead of inventing safe data', async () => {
  const h = harness(); h.refs.activeModelRef.current = 'qwen35-08b';
  const item = { id: 'T4_BAG', n: "Adept's Bag" };
  const pending = h.render().handleItemSelect(item);
  h.requests[0].resolve({ item, quality: 1, prices: [], history7d: [], history30d: [] });
  await pending;
  assert.equal(h.state.messages.at(-1).source, 'calculator');
  assert.match(h.state.messages.at(-1).content, /identité non vérifiée/);
  assert.equal(h.streams.length, 0);
});

test('Qwen free chat remains model output with visible warning, outside the calculated analysis guarantee', async () => {
  const h = harness(); h.refs.activeModelRef.current = 'qwen35-08b'; h.state.activeModelId = 'qwen35-08b';
  h.state.input = 'What about this item?';
  await h.render().handleSend();
  assert.equal(h.streams.length, 1);
  h.streams[0].callbacks.onToken('Unvalidated model advice'); h.streams[0].callbacks.onDone();
  assert.equal(h.state.messages.at(-1).source, 'model');
  assert.equal(h.state.messages.at(-1).content, 'Unvalidated model advice');
  assert.match(source, /Experimental AI chat: unvalidated output can contradict calculations/);
  assert.match(source, /calculatorOnlyAnalysis && msg\.role === 'assistant' && msg\.source !== 'calculator'/);
  assert.match(source, /calculatorOnlyAnalysis && <Text style=\{styles\.analysisSafetyNotice\}>\{unverifiedAIWarning\}/);
});

test('Qwen registry disables native tools in automatic and CPU starts while Gemma keeps them', async () => {
  for (const [id, cpu, expectedTools] of [['qwen35-08b', false, false], ['qwen35-08b', true, false], ['gemma4-e2b', false, true]] as const) {
    const h = harness();
    const calls: any[][] = [];
    h.llm.initialize = async (...args: any[]) => { calls.push(args); return { backendUsed: 'cpu', hasVision: false }; };
    await h.render().handleStartModel(AVAILABLE_MODELS.find((model) => model.id === id), cpu);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][4], expectedTools);
    assert.equal(calls[0][5], cpu);
    assert.equal(h.state.engineState, 'ready');
  }
});

test('initialization finishing after return to models cannot reopen the chat', async () => {
  const h = harness();
  const initialized = deferred<any>();
  h.llm.initialize = () => initialized.promise;
  const env = h.render();
  const starting = env.handleStartModel({ id: 'new', filename: 'new.litertlm' });
  await tick();
  const leaving = env.handleBackToModels();
  initialized.resolve({ backendUsed: 'cpu', isMediaTek: false });
  await Promise.all([starting, leaving]);
  assert.equal(h.state.engineState, 'idle');
  assert.equal(h.state.activeModelId, null);
  assert.equal(h.state.screen, 'models');
  assert.deepEqual(h.state.messages, []);
});

test('server change during initialization waits for init then configures the current server', async () => {
  const h = harness();
  h.state.screen = 'models';
  const initialized = deferred<any>();
  h.llm.initialize = () => initialized.promise;
  const starting = h.render().handleStartModel({ id: 'new', filename: 'new.litertlm' });
  await tick();
  h.render('europe').serverEffect();
  initialized.resolve({ backendUsed: 'cpu', isMediaTek: false });
  await starting;
  await h.refs.resetInFlightRef.current;
  assert.deepEqual(h.resets, ['url:europe']);
  assert.equal(h.state.engineState, 'ready');
  assert.equal(h.state.screen, 'chat');
  assert.equal(h.advisorSession.isReady(h.advisorSession.capture()), true);
});

test('reset failure leaves sends blocked and is reported, not falsely marked ready', async () => {
  const h = harness();
  h.llm.resetConversation = async () => { throw new Error('reset failed'); };
  await h.render().handleReset();
  h.render().sendToLLM('must not send');
  assert.equal(h.state.engineState, 'error');
  assert.equal(h.streams.length, 0);
  assert.equal(h.alerts.length, 1);
});

test('failed replacement during a server switch never advertises the retained old native model as the new one', async () => {
  const h = harness();
  const initialized = deferred<any>();
  h.llm.initialize = () => initialized.promise;
  const starting = h.render().handleStartModel({ id: 'replacement', filename: 'other.litertlm' });
  await tick();
  h.render('europe').serverEffect();
  initialized.reject(new Error('replacement failed; native may still retain old model'));
  await starting;
  await h.refs.resetInFlightRef.current;
  assert.equal(h.state.engineState, 'error');
  assert.equal(h.advisorSession.isReady(h.advisorSession.capture()), false);
  assert.deepEqual(h.resets, [], 'do not reset a different retained engine');
  assert.equal(h.alerts.length, 1);
});

test('image picker response after a model/session switch is ignored', async () => {
  const h = harness();
  const picker = deferred<any>();
  let opened = 0;
  const env = h.render();
  env.ImagePicker.launchImageLibraryAsync = () => { opened++; return picker.promise; };
  const pending = env.handlePickImage();
  assert.equal(opened, 1);
  await env.handleBackToModels();
  picker.resolve({ canceled: false, assets: [{ uri: 'file://photo.jpg' }] });
  await pending;
  assert.equal(h.streams.length, 0);
  assert.equal(h.state.input, 'draft');
});

test('city callback completion cannot send an old-server prompt or erase the draft', async () => {
  const h = harness();
  const city = deferred<void>();
  const env = h.render();
  env.parseMarketQuery = () => ({ city: 'Caerleon' });
  env.onCityDetected = () => city.promise;
  const pending = env.handleSend();
  h.render('europe').serverEffect();
  city.resolve();
  await pending;
  assert.equal(h.streams.length, 0);
  assert.equal(h.state.input, 'draft');
});

test('old render callbacks cannot borrow the new session after an explicit reset', async () => {
  const h = harness();
  const oldRender = h.render();
  await oldRender.handleReset();
  await oldRender.handleSend();
  await oldRender.handleItemSelect({ id: 'old', n: 'old' });
  oldRender.sendToLLM('old context');
  assert.equal(h.requests.length, 0);
  assert.equal(h.streams.length, 0);
  assert.equal(h.state.input, 'draft');
  assert.equal(h.state.marketCtx, null);
});

test('item selection during an awaited city update invalidates the old question context', async () => {
  const h = harness();
  const city = deferred<void>();
  const env = h.render();
  env.parseMarketQuery = () => ({ city: 'Caerleon' });
  env.onCityDetected = () => city.promise;
  const question = env.handleSend();
  const analysis = env.handleItemSelect({ id: 'B', n: 'B' });
  city.resolve();
  await question;
  assert.equal(h.streams.length, 0);
  assert.equal(h.state.input, 'draft');
  h.requests[0].resolve({ server: 'americas', item: 'B' });
  await analysis;
  assert.equal(h.streams.length, 1);
  assert.match(h.streams[0].prompt, /"item":"B"/);
});

test('old item-context callbacks cannot borrow a completed newer request from the same session', async () => {
  const h = harness();
  const itemA = h.render();
  const analysis = itemA.handleItemSelect({ id: 'B', n: 'B' });
  h.requests[0].resolve({ server: 'americas', item: 'B' });
  await analysis;
  h.streams[0].callbacks.onDone();
  await itemA.handleSend();
  itemA.sendImageToLLM('file://old-photo.jpg');
  assert.equal(h.streams.length, 1, 'stale item A context must not be sent after B completed');
  assert.equal(h.state.input, 'draft');
  await h.render().handleSend();
  assert.equal(h.streams.length, 2, 'a current-render question still works');
  assert.match(h.streams[1].prompt, /"item":"B"/);
});

test('normal Start retains automatic mode and CPU Start forwards an explicit choice', async () => {
  for (const preferCpuText of [false, true]) {
    const h = harness();
    const calls: any[][] = [];
    h.llm.initialize = async (...args: any[]) => {
      calls.push(args);
      return { backendUsed: preferCpuText ? 'cpu' : 'gpu', isMediaTek: false, hasVision: !preferCpuText };
    };
    const model = { id: 'qwen35-08b', filename: 'same-VL.litertlm', multimodal: true, toolCalling: true };
    if (preferCpuText) await h.render().handleStartModel(model, true);
    else await h.render().handleStartModel(model);
    assert.deepEqual(calls, [['same-VL.litertlm', 'americas', 'url:americas', true, true, preferCpuText]]);
    assert.equal(h.state.backendInfo.hasVision, !preferCpuText);
    assert.equal(h.state.backendInfo.backendUsed, preferCpuText ? 'cpu' : 'gpu');
    assert.equal(h.state.screen, 'chat');
    assert.equal(h.state.engineState, 'ready');
  }
});

test('actual text-only or unknown capability blocks picker, camera permission and image sends', async () => {
  for (const backendInfo of [null, { backendUsed: 'cpu', isMediaTek: false, hasVision: false },
    { backendUsed: 'gpu', isMediaTek: false, hasVision: false }]) {
    const h = harness();
    h.state.backendInfo = backendInfo;
    const env = h.render();
    env.ImagePicker.launchImageLibraryAsync = () => assert.fail('must not open picker');
    env.ImagePicker.requestCameraPermissionsAsync = () => assert.fail('must not request camera permission');
    await env.handlePickImage();
    await env.handleTakePhoto();
    env.sendImageToLLM('file://image.jpg');
    assert.equal(h.streams.length, 0);
    assert.equal(h.state.input, 'draft');
  }
});

test('actual vision capability still admits an image in automatic mode', async () => {
  const h = harness();
  const env = h.render();
  env.ImagePicker.launchImageLibraryAsync = async () => ({ canceled: false, assets: [{ uri: 'file://photo.jpg' }] });
  await env.handlePickImage();
  assert.equal(h.streams.length, 1);
  assert.equal(h.state.streaming, true);
});

test('capabilities survive a server change during model initialization, then reset', async () => {
  const h = harness();
  const initialized = deferred<any>();
  h.llm.initialize = () => initialized.promise;
  const starting = h.render().handleStartModel({ id: 'new', filename: 'same-VL.litertlm' }, true);
  await tick();
  h.render('europe').serverEffect();
  initialized.resolve({ backendUsed: 'cpu', isMediaTek: false, hasVision: false });
  await starting;
  await h.refs.resetInFlightRef.current;
  assert.deepEqual(h.state.backendInfo, { backendUsed: 'cpu', isMediaTek: false, hasVision: false, maxOutputTokens: undefined });
  await h.render('europe').handleReset();
  assert.equal(h.state.backendInfo.hasVision, false);
  assert.equal(h.state.backendInfo.backendUsed, 'cpu');
});

test('a pending image selection cannot reach a replacement CPU-only engine', async () => {
  const h = harness();
  const picker = deferred<any>();
  const old = h.render();
  old.ImagePicker.launchImageLibraryAsync = () => picker.promise;
  const pending = old.handlePickImage();
  await h.render().handleStartModel({ id: 'cpu', filename: 'same-VL.litertlm' }, true);
  picker.resolve({ canceled: false, assets: [{ uri: 'file://old.jpg' }] });
  await pending;
  old.sendImageToLLM('file://old.jpg');
  assert.equal(h.streams.length, 0);
  assert.equal(h.state.input, 'draft');
});

test('an old initialization cannot publish capabilities after leaving the model', async () => {
  const h = harness();
  const initialized = deferred<any>();
  h.llm.initialize = () => initialized.promise;
  const starting = h.render().handleStartModel({ id: 'new', filename: 'same-VL.litertlm' });
  await tick();
  const leaving = h.render().handleBackToModels();
  initialized.resolve({ backendUsed: 'gpu', isMediaTek: false, hasVision: true });
  await Promise.all([starting, leaving]);
  assert.equal(h.state.backendInfo, null);
  assert.equal(h.state.screen, 'models');
});

test('simple Premium and Non-Premium rate questions use calculator replies without inference', async () => {
  const h = harness();
  h.state.input = 'What is the Premium sales tax';
  const premium = h.render();
  premium.parseMarketQuery = () => assert.fail('fee FAQ must not search items');
  await premium.handleSend();
  assert.match(h.state.messages.at(-1).content, /taxe de vente Premium 4 %/);
  h.state.input = 'What is the non-premium sales tax';
  await h.render().handleSend();
  assert.match(h.state.messages.at(-1).content, /taxe de vente Non-Premium 8 %/);
  assert.match(h.state.messages.at(-1).content, /non générée/);
  assert.equal(h.streams.length, 0);
  assert.equal(h.requests.length, 0);
  assert.equal(h.state.tokenCount, 250, 'local FAQ is not native conversation tokens');
});

test('FAQ obeys readiness, stream and stale-request guards and deduplicates an old render', async () => {
  const h = harness();
  h.state.input = 'What is the Premium sales tax';
  const old = h.render();
  old.sendToLLM('still running');
  const count = h.state.messages.length;
  await old.handleSend();
  assert.equal(h.state.messages.length, count);
  h.streams[0].callbacks.onDone();
  await old.handleSend();
  const after = h.state.messages.length;
  await old.handleSend();
  assert.equal(h.state.messages.length, after);
  assert.equal(h.streams.length, 1);
  await h.render().handleReset();
  await old.handleSend();
  assert.deepEqual(h.state.messages, []);
});

test('question after Premium toggle supplies the current setting without reinitializing', async () => {
  const h = harness();
  const captured: boolean[] = [];
  const old = h.render();
  old.buildQuestionPrompt = (_q: string, _ctx: any, _lang: string, _city: string, premium: boolean) => {
    captured.push(premium); return 'market question';
  };
  h.state.isPremium = true;
  h.render();
  await old.handleSend();
  assert.deepEqual(captured, [true]);
  assert.equal(h.streams.length, 1);
});

test('market fetch uses current Premium setting when it completes after a toggle', async () => {
  const h = harness();
  const captured: boolean[] = [];
  const env = h.render();
  env.buildAnalysisPrompt = (_ctx: any, _lang: string, premium: boolean) => {
    captured.push(premium); return 'analysis';
  };
  const pending = env.handleItemSelect({ id: 'A', n: 'A' });
  h.state.isPremium = true;
  h.render();
  h.requests[0].resolve({ item: 'A' });
  await pending;
  assert.deepEqual(captured, [true]);
  assert.equal(h.streams.length, 1);
});

test('Stop invalidates before cleanup, retains latest partial text and waits for reset before reuse', async () => {
  const h = harness();
  const resetting = deferred<boolean>();
  h.llm.resetConversation = () => resetting.promise;
  let cancelled = 0;
  h.llm.sendMessage = (prompt: string, callbacks: any) => {
    h.streams.push({ prompt, callbacks });
    return () => {
      cancelled++;
      assert.equal(h.advisorSession.isStreaming(), false, 'invalidate before native cleanup');
      callbacks.onError('late rejection during cancellation');
    };
  };
  h.render().sendToLLM('question');
  h.streams[0].callbacks.onToken('part one');
  const stop = h.render();
  h.streams[0].callbacks.onToken(' and latest'); // newer than the Stop render
  const pending = stop.handleStop();
  await stop.handleStop(); // second tap must not duplicate cancellation/reset
  assert.equal(cancelled, 1);
  assert.equal(h.state.engineState, 'loading');
  assert.equal(h.state.streaming, false);
  assert.equal(h.state.input, 'draft');
  assert.equal(h.state.marketCtx.price, 12345);
  assert.equal(h.state.messages.at(-2).content, 'part one and latest');
  assert.match(h.state.messages.at(-1).content, /incomplète/);
  const count = h.state.messages.length;
  h.streams[0].callbacks.onToken('obsolete');
  h.streams[0].callbacks.onDone();
  h.render().sendToLLM('blocked until reset');
  assert.equal(h.streams.length, 1);
  assert.equal(h.state.messages.length, count);
  resetting.resolve(true);
  await pending;
  assert.equal(h.state.engineState, 'ready');
  h.render().sendToLLM('new');
  assert.equal(h.streams.length, 2);
});

test('an old Stop callback cannot cancel a newer stream even within the same session', async () => {
  const h = harness();
  h.render().sendToLLM('first');
  const old = h.render();
  h.streams[0].callbacks.onDone();
  h.render().sendToLLM('second');
  await old.handleStop();
  assert.equal(h.advisorSession.isStreaming(), true);
  assert.equal(h.resets.length, 0);
  assert.equal(h.state.messages.at(-1).content, 'second');
});

test('native timeout keeps the partial answer and only recovers after successful reset', async () => {
  const h = harness();
  const resetting = deferred<boolean>();
  h.llm.resetConversation = () => resetting.promise;
  h.render().sendToLLM('question');
  h.streams[0].callbacks.onToken('REASON RISKS');
  h.streams[0].callbacks.onError('Native inference timed out');
  assert.equal(h.state.engineState, 'loading');
  assert.equal(h.state.messages.at(-2).content, 'REASON RISKS');
  assert.match(h.state.messages.at(-1).content, /Native inference timed out/);
  resetting.reject(new Error('Engine not initialized after quarantine'));
  await h.refs.resetInFlightRef.current;
  assert.equal(h.state.engineState, 'error');
  assert.equal(h.advisorSession.isReady(h.advisorSession.capture()), false);
  h.render().sendToLLM('must remain blocked');
  assert.equal(h.streams.length, 1);
  assert.equal(h.alerts.length, 1);
});

test('synchronous send failure does not leave stale cleanup after recovery', async () => {
  const h = harness();
  let cleanups = 0;
  h.llm.sendMessage = (_prompt: string, callbacks: any) => {
    callbacks.onError('failed before native acceptance');
    return () => { cleanups++; };
  };
  h.render().sendToLLM('question');
  await h.refs.resetInFlightRef.current;
  assert.equal(cleanups, 1);
  assert.equal(h.refs.cleanupRef.current, null);
  assert.equal(h.state.engineState, 'ready');
});

test('image generation Stop also uses the current partial text and resets once', async () => {
  const h = harness();
  h.render().sendImageToLLM('file://photo.jpg');
  const stop = h.render();
  h.streams[0].callbacks.onToken('latest image description');
  await stop.handleStop();
  assert.equal(h.state.messages.at(-2).content, 'latest image description');
  assert.deepEqual(h.resets, ['url:americas']);
  assert.equal(h.state.engineState, 'ready');
});

test('Hello remains an inference request, not a fabricated local success', async () => {
  const h = harness();
  h.state.input = 'Hello';
  const env = h.render();
  await env.handleSend();
  assert.equal(h.streams.length, 1);
  assert.equal(h.state.streaming, true);
  assert.equal(h.state.messages.at(-1).role, 'user');
  assert.equal(h.state.messages.at(-1).content, 'Hello');
});

for (const initial of [null, 1]) {
  test(`item analysis preserves consent authorization across market lookup (initial ${initial})`, async () => {
    const h = harness(); h.analytics.generation = initial;
    const env = h.render();
    const pending = env.handleItemSelect({ id: 'A', n: 'A' });
    h.analytics.generation = 2;
    h.requests[0].resolve({ server: 'americas', price: 100 });
    await pending;
    assert.equal(h.streams.length, 1);
    assert.deepEqual(h.analytics.events, []);
  });
  test(`image picker preserves consent authorization across selection (initial ${initial})`, async () => {
    const h = harness(); h.analytics.generation = initial;
    const env = h.render(), pick = deferred<any>();
    env.ImagePicker.launchImageLibraryAsync = () => pick.promise;
    const pending = env.handlePickImage();
    h.analytics.generation = 2;
    pick.resolve({ canceled: false, assets: [{ uri: 'file://image.jpg' }] });
    await pending;
    assert.equal(h.streams.length, 1);
    assert.deepEqual(h.analytics.events, []);
  });
  test(`text send preserves consent authorization across a pending reset (initial ${initial})`, async () => {
    const h = harness(); h.analytics.generation = initial;
    const env = h.render(), reset = deferred<void>();
    h.refs.resetInFlightRef.current = reset.promise;
    const pending = env.handleSend();
    h.analytics.generation = 2;
    h.refs.resetInFlightRef.current = null;
    reset.resolve();
    await pending;
    assert.equal(h.streams.length, 1);
    assert.deepEqual(h.analytics.events, []);
  });
}

test('authorized direct prompts and images are still counted', () => {
  const text = harness(); text.render().sendToLLM('question');
  assert.deepEqual(text.analytics.events, ['prompt']);
  const image = harness(); image.render().sendImageToLLM('file://image.jpg');
  assert.deepEqual(image.analytics.events, ['image']);
});
