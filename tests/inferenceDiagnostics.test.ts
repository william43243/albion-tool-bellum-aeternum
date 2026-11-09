import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync('lib/litert.ts', 'utf8');
const ast = ts.createSourceFile('litert.ts', source, ts.ScriptTarget.Latest, true);
function load(name: string, env: Record<string, any>): any {
  const fn = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn);
  const js = ts.transpileModule(fn.getText(ast).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('env', `with (env) { ${js}; return ${name}; }`)(env);
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness(debugInference?: boolean) {
  const calls: string[] = [];
  const logs: string[] = [];
  const env: Record<string, any> = {
    LiteRTModule: { debugInference },
    Crypto: {
      CryptoDigestAlgorithm: { SHA256: 'SHA256' },
      digestStringAsync: async (algorithm: string, message: string) => {
        assert.equal(algorithm, 'SHA256'); calls.push(message);
        return createHash('sha256').update(message, 'utf8').digest('hex');
      },
    },
    console: { debug: (line: string) => logs.push(line) },
  };
  return { env, calls, logs, trace: load('traceInferenceInput', env) };
}

test('debug trace hashes UTF-8 but reports UTF-16 character length without including input text', async () => {
  const h = harness(true);
  const prompt = 'AI_DECISION_INPUT\nCafé, sac 🎒';
  h.trace(prompt, 'req_test', false);
  await tick();
  assert.equal(h.calls.length, 1);
  assert.equal(h.logs.length, 1);
  assert.ok(h.logs[0].includes(`chars=${prompt.length} analysis=true image=false`));
  assert.ok(h.logs[0].includes(createHash('sha256').update(prompt, 'utf8').digest('hex')));
  assert.doesNotMatch(h.logs[0], /Café|sac|AI_DECISION_INPUT|🎒/);
  assert.match(h.logs[0], /stage=js request=req_test/);
});

test('release or absent debug flag neither hashes nor logs', async () => {
  for (const enabled of [false, undefined]) {
    const h = harness(enabled);
    h.trace('private question', 'request', true);
    await tick();
    assert.deepEqual(h.calls, []); assert.deepEqual(h.logs, []);
  }
});

test('async diagnostic completion retains request identity even when reordered', async () => {
  const h = harness(true);
  const resolve: ((value: string) => void)[] = [];
  h.env.Crypto.digestStringAsync = () => new Promise<string>((done) => resolve.push(done));
  h.trace('first', 'request_1', false); h.trace('second', 'request_2', true);
  resolve[1]('hash2'); await tick();
  resolve[0]('hash1'); await tick();
  assert.match(h.logs[0], /request=request_2.*image=true sha256=hash2/);
  assert.match(h.logs[1], /request=request_1.*image=false sha256=hash1/);
});

test('failed or pending diagnostics do not delay, alter or retry native sends', async () => {
  for (const mode of ['throw', 'reject', 'pending']) {
    const h = harness(true);
    h.env.Crypto.digestStringAsync = () => {
      if (mode === 'throw') throw new Error('private hash failure');
      if (mode === 'reject') return Promise.reject(new Error('private hash failure'));
      return new Promise(() => {});
    };
    const sent: any[][] = [];
    Object.assign(h.env, {
      emitter: { addListener: () => ({ remove() {} }) },
      traceInferenceInput: h.trace,
    });
    h.env.LiteRTModule.sendMessage = (...args: any[]) => { sent.push(args); return Promise.resolve(true); };
    h.env.LiteRTModule.cancelMessage = () => Promise.resolve(true);
    const send = load('sendMessage', h.env);
    send('unchanged prompt', { onToken() {}, onDone() {}, onError: assert.fail });
    assert.equal(sent.length, 1, 'send does not wait for its diagnostic hash');
    assert.equal(sent[0][0], 'unchanged prompt');
    await tick();
    assert.equal(sent.length, 1); assert.deepEqual(h.logs, []);
  }
});

test('native input trace is debug-only UTF-8 SHA-256 immediately before inference', () => {
  const native = readFileSync('android/app/src/main/java/com/albion/market/litert/LiteRTModule.kt', 'utf8');
  assert.match(native, /mutableMapOf\("debugInference" to BuildConfig\.DEBUG\)/);
  const input = native.slice(native.indexOf('private fun traceInferenceInput'), native.indexOf('private fun traceInferenceOutput'));
  assert.ok(input.indexOf('if (!BuildConfig.DEBUG) return') < input.indexOf('MessageDigest.getInstance'));
  assert.match(input, /MessageDigest\.getInstance\("SHA-256"\)/);
  assert.match(input, /message\.toByteArray\(Charsets\.UTF_8\)/);
  assert.match(native, /traceInferenceInput\(userMessage, requestId, false\)\s*conv\.sendMessageAsync\(userMessage, callback\)/);
  assert.match(native, /traceInferenceInput\(userMessage, requestId, true\)\s*conv\.sendMessageAsync\(content, callback\)/);
  const output = native.slice(native.indexOf('private fun traceInferenceOutput'), native.indexOf('@ReactMethod fun addListener'));
  assert.match(output, /if \(!BuildConfig.DEBUG\) return/);
  assert.doesNotMatch(output, /message|imagePath|throwable/);
  assert.match(output, /fragments=\$fragments chars=\$chars/);
});
