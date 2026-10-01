import assert from 'node:assert/strict';
import test from 'node:test';
import { AVAILABLE_MODELS } from '../lib/models';

test('every Android model has an exact size and mandatory SHA-256', () => {
  const androidModels = AVAILABLE_MODELS.filter((model) => !model.webOnly);
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
});
