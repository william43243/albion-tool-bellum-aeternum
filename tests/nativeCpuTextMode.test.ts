import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { AVAILABLE_MODELS } from '../lib/models';

const native = readFileSync('android/app/src/main/java/com/albion/market/litert/LiteRTModule.kt', 'utf8');
const initialize = native.slice(native.indexOf('fun initialize('), native.indexOf('fun sendMessage('));
const screen = readFileSync('screens/AdvisorScreen.tsx', 'utf8');

// Run both real TypeScript bridge functions on Android with only native IO faked.
function loadInitialize(file: string, env: Record<string, any>) {
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'initialize');
  assert.ok(fn);
  const js = ts.transpileModule(fn.getText(ast).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('env', `with (env) { ${js}; return initialize; }`)(env);
}

test('Android bridge preserves the CPU/text choice and defaults to automatic mode', async () => {
  const calls: any[][] = [];
  const result = { success: true, backendUsed: 'cpu', hasVision: false, isMediaTek: false };
  const liteRT = loadInitialize('lib/litert.ts', {
    Platform: { OS: 'android' }, LiteRTModule: { initialize: async (...args: any[]) => { calls.push(args); return result; } },
  });
  const llm = loadInitialize('lib/llm.ts', { isWeb: false, LiteRT: { initialize: liteRT } });
  assert.equal(await llm('model', 'prompt', 'server', true, true, true), result);
  await llm('model', 'prompt', 'server', true, true);
  await llm('model', 'prompt', 'server', true, false, true);
  assert.deepEqual(calls, [
    ['model', 'prompt', 'server', true, true, true],
    ['model', 'prompt', 'server', true, true, false],
    ['model', 'prompt', 'server', true, false, true],
  ]);
});

test('CPU/text option preserves the exact multimodal artifact and normal Start', () => {
  assert.deepEqual(AVAILABLE_MODELS.filter((model) => model.cpuTextOption).map((model) => model.id), ['qwen35-08b']);
  const qwen = AVAILABLE_MODELS.find((model) => model.id === 'qwen35-08b')!;
  assert.equal(qwen.multimodal, true);
  assert.equal(qwen.toolCalling, false, 'this VL template has no native tool format');
  assert.equal(qwen.filename, 'Qwen3.5-0.8B-VL_int8.litertlm');
  assert.equal(qwen.sha256, 'e3360b658c929ff35ab740a21f5e4b688096a72e351b8d347e26ccda314121b7');
  assert.match(screen, /onPress=\{\(\) => handleStartModel\(model\)\}/);
  assert.match(screen, /model\.cpuTextOption && isDownloaded && !isDownloading/);
  assert.match(screen, /onPress=\{\(\) => handleStartModel\(model, true\)\}/);
  assert.match(screen, /!isWeb && backendInfo\?\.hasVision === true/);
});

test('native explicit CPU mode skips both GPU tiers and leaves vision unset', () => {
  assert.match(initialize, /supportsTools: Boolean, preferCpuText: Boolean, promise: Promise/);
  assert.match(initialize, /val gpuBackend: Backend\? = if \(preferCpuText\) null else try \{\s*Backend\.GPU\(\)/);
  assert.match(initialize, /if \(supportsVision && gpuBackend != null\)/);
  assert.match(initialize, /if \(newEngine == null && gpuBackend != null\)/);
  const cpuTier = initialize.slice(initialize.indexOf('// Tier 3'), initialize.indexOf('// Tool support'));
  assert.match(cpuTier, /backend = Backend\.CPU\(\)/);
  assert.match(cpuTier, /newHasVision = false/);
  assert.doesNotMatch(cpuTier, /visionBackend|Backend\.GPU/);
  // No fallback from text-only conversation failure can silently turn vision on.
  assert.match(initialize, /if \(!newHasVision\) throw visionError/);
  assert.match(initialize, /currentSupportsTools = supportsTools/);
  assert.match(initialize, /val toolList = if \(supportsTools\) \{[\s\S]*?\} else \{\s*emptyList\(\)/);
});

test('conversation reset reuses the chosen engine instead of changing backend', () => {
  const reset = native.slice(native.indexOf('fun resetConversation('), native.indexOf('private fun createInitializedEngine'));
  assert.doesNotMatch(reset, /Backend\.GPU|Backend\.CPU|EngineConfig\(/);
  assert.match(reset, /currentSupportsTools/);
  assert.match(reset, /val resetTools = if \(currentSupportsTools\) \{[\s\S]*?\} else \{\s*emptyList\(\)/);
  assert.match(reset, /tools = resetTools/);
});

test('failed initialization only closes a live handle and vision fallback relinquishes a closed handle', () => {
  const create = native.slice(native.indexOf('private fun createInitializedEngine'), native.indexOf('private fun closeRuntimeDirect'));
  assert.match(create, /if \(candidate\.isInitialized\(\)\) \{\s*runCatching \{ candidate\.close\(\) \}/);
  assert.match(create, /initialization\.quarantine\(\)/);
  assert.match(initialize, /closeRuntimeBounded\(null, visionEngine, "engine close", initialization\)\s*(?:\/\/[^\n]*\n\s*)*newEngine = null\s*val fallbackBackend/);
});
