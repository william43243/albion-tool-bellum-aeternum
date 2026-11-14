import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LOCAL_MODEL_SETTINGS,
  sanitizeLocalModelSettings,
  validateLocalModelSettings,
} from '../lib/localModelSettings';

const settings = () => ({ ...DEFAULT_LOCAL_MODEL_SETTINGS });

test('local settings accept the engine default or user-selected context across the supported range', () => {
  for (const contextTokens of [null, 2000, 4096, 8192, 30000, 32000]) {
    assert.equal(validateLocalModelSettings({ ...settings(), contextTokens }), null);
  }
  assert.equal(validateLocalModelSettings({ ...settings(), contextTokens: 4096 }, 4096), null);
  assert.equal(validateLocalModelSettings({ ...settings(), contextTokens: 8192 }, 4096), 'contextTokens');
  assert.equal(validateLocalModelSettings({ ...settings(), contextTokens: null }, 4096), null);
});

test('invalid context sizes are rejected before they reach the native runtime', () => {
  for (const contextTokens of [1999, 32001, -1, 4096.5, NaN, Infinity, -Infinity]) {
    assert.equal(validateLocalModelSettings({ ...settings(), contextTokens }), 'contextTokens');
  }
});

test('sampling accepts supported endpoints and rejects out-of-range or non-finite values', () => {
  for (const topK of [1, 100]) assert.equal(validateLocalModelSettings({ ...settings(), topK }), null);
  for (const topP of [0, 1]) assert.equal(validateLocalModelSettings({ ...settings(), topP }), null);
  for (const temperature of [0, 2]) assert.equal(validateLocalModelSettings({ ...settings(), temperature }), null);
  for (const topK of [0, 101, 1.5, NaN, Infinity]) assert.equal(validateLocalModelSettings({ ...settings(), topK }), 'topK');
  for (const topP of [-0.1, 1.1, NaN, Infinity, -Infinity]) assert.equal(validateLocalModelSettings({ ...settings(), topP }), 'topP');
  for (const temperature of [-0.1, 2.1, NaN, Infinity, -Infinity]) assert.equal(validateLocalModelSettings({ ...settings(), temperature }), 'temperature');
});

test('corrupt or obsolete persisted settings fall back safely; valid choices survive', () => {
  for (const stored of [null, [], 'bad', { contextTokens: 90000 }, { autoCompress: 'yes' }, { preferCpuText: 1 }]) {
    assert.deepEqual(sanitizeLocalModelSettings(stored), settings());
  }
  const chosen = { ...settings(), contextTokens: 8192, autoCompress: false, preferCpuText: true };
  assert.deepEqual(sanitizeLocalModelSettings(chosen), chosen);
  assert.deepEqual(sanitizeLocalModelSettings(chosen, 4096), settings());
  assert.deepEqual(sanitizeLocalModelSettings({ topK: 8 }), { ...settings(), topK: 8 });
});
