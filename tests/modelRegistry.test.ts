import assert from 'node:assert/strict';
import test from 'node:test';
import { AVAILABLE_MODELS } from '../lib/models';

test('every Android model has an exact size and mandatory SHA-256', () => {
  const androidModels = AVAILABLE_MODELS;
  assert.ok(androidModels.length > 0);
  for (const model of androidModels) {
    assert.ok(Number.isSafeInteger(model.sizeBytes) && model.sizeBytes > 0, `${model.id}: sizeBytes must be exact`);
    assert.match((model as typeof model & { sha256?: string }).sha256 ?? '', /^[0-9a-f]{64}$/, `${model.id}: sha256 missing`);
  }
});

test('Qwen 3.5 uses the public immutable LiteRT artifact', () => {
  const qwen = AVAILABLE_MODELS.find((model) => model.id === 'qwen35-08b');
  assert.equal(qwen?.filename, 'Qwen3.5-0.8B-VL_int8.litertlm');
  assert.equal(qwen?.sizeBytes, 1302262448);
  assert.equal(qwen?.sha256, 'e3360b658c929ff35ab740a21f5e4b688096a72e351b8d347e26ccda314121b7');
  assert.equal(qwen?.downloadUrl, 'https://huggingface.co/litert-community/Qwen3.5-0.8B/resolve/10243c0a01d24e6b122a0e814f8c4d984c9c92d6/Qwen3.5-0.8B-VL_int8.litertlm');
});

test('the pinned Qwen 3.5 VL template is not advertised as supporting native tools', () => {
  const qwen = AVAILABLE_MODELS.find((model) => model.id === 'qwen35-08b')!;
  assert.equal(qwen.toolCalling, false);
  assert.equal(qwen.multimodal, true, 'vision capability is independent');
  assert.equal(qwen.cpuTextOption, true);
  for (const id of ['gemma4-e2b', 'gemma4-e4b']) {
    const model = AVAILABLE_MODELS.find((candidate) => candidate.id === id);
    assert.ok(model, id);
    assert.equal(model.toolCalling, true, `${id}: unchanged by this artifact-specific restriction`);
  }
});

test('calculator-only item analysis is restricted to the Qwen model tested on S22', () => {
  assert.deepEqual(AVAILABLE_MODELS.filter((model) => model.itemAnalysisMode === 'calculator-only').map((model) => model.id), ['qwen35-08b']);
});

test('every Android download is pinned to an immutable revision, never a mutable branch', () => {
  for (const model of AVAILABLE_MODELS) {
    const url = new URL(model.downloadUrl);
    assert.equal(url.protocol, 'https:', model.id);
    assert.equal(url.hostname, 'huggingface.co', model.id);
    assert.match(url.pathname, /^\/litert-community\/[^/]+\/resolve\/[0-9a-f]{40}\/[^/]+$/, model.id);
    assert.equal(decodeURIComponent(url.pathname.split('/').at(-1)!), model.filename, model.id);
  }
});

test('Qwen 2.5 retains the original artifact instead of the changed main branch metadata', () => {
  const qwen = AVAILABLE_MODELS.find((model) => model.id === 'qwen25-15b');
  assert.equal(qwen?.sizeBytes, 1597931520);
  assert.equal(qwen?.sha256, 'faa60663b333290c1496c499828b21d3e3254a788cacd8cce917ce0f761a2dc9');
  assert.equal(qwen?.downloadUrl, 'https://huggingface.co/litert-community/Qwen2.5-1.5B-Instruct/resolve/19edb84c69a0212f29a6ef17ba0d6f278b6a1614/Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv4096.litertlm');
});
