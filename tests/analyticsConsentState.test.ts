import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalyticsConsentState, ConsentStorage } from '../lib/analyticsConsentState';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('latest refusal wins over an older pending acceptance and is persisted last', async () => {
  const firstWrite = deferred<void>();
  const writes: string[] = [];
  const storage: ConsentStorage = {
    getItem: async () => null,
    setItem: async (_key, value) => {
      writes.push(value);
      if (writes.length === 1) await firstWrite.promise;
    },
    removeItem: async () => undefined,
  };
  const state = new AnalyticsConsentState(storage);

  const accept = state.set('accepted');
  await Promise.resolve();
  const refuse = state.set('refused');
  assert.equal(state.get(), 'refused');
  firstWrite.resolve();
  await Promise.all([accept, refuse]);

  assert.equal(state.get(), 'refused');
  assert.deepEqual(writes, ['accepted', 'refused']);
});

test('a stale initialization read cannot overwrite a concurrent refusal', async () => {
  const read = deferred<string | null>();
  const storage: ConsentStorage = {
    getItem: async () => read.promise,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  };
  const state = new AnalyticsConsentState(storage);

  const initialization = state.initialize();
  const refusal = state.set('refused');
  read.resolve('accepted');
  await Promise.all([initialization, refusal]);

  assert.equal(state.get(), 'refused');
});

test('failed refusal write removes stale acceptance before reporting success', async () => {
  let removed = false;
  const storage: ConsentStorage = {
    getItem: async () => 'accepted',
    setItem: async (_key, value) => {
      if (value === 'refused') throw new Error('write failed');
    },
    removeItem: async () => { removed = true; },
  };
  const state = new AnalyticsConsentState(storage);
  await state.initialize();
  await state.set('refused');

  assert.equal(state.get(), 'refused');
  assert.equal(removed, true);
});

test('failed refusal persistence and failed stale-acceptance removal are reported', async () => {
  const storage: ConsentStorage = {
    getItem: async () => 'accepted',
    setItem: async () => { throw new Error('write failed'); },
    removeItem: async () => { throw new Error('remove failed'); },
  };
  const state = new AnalyticsConsentState(storage);
  await state.initialize();

  await assert.rejects(state.set('refused'));
  assert.equal(state.get(), 'undecided');
});

test('authorization tokens cannot bless activity that happened before consent or across a consent change', async () => {
  let stored: string | null = null;
  const storage: ConsentStorage = {
    getItem: async () => stored,
    setItem: async (_key, value) => { stored = value; },
    removeItem: async () => { stored = null; },
  };
  const state = new AnalyticsConsentState(storage);
  await state.initialize();
  assert.equal(state.captureAuthorization(), null);

  await state.set('accepted');
  const acceptedGeneration = state.captureAuthorization();
  assert.equal(typeof acceptedGeneration, 'number');
  assert.equal(state.isAuthorizationCurrent(acceptedGeneration), true);

  await state.set('refused');
  assert.equal(state.isAuthorizationCurrent(acceptedGeneration), false);
});

test('external storage synchronization re-reads the latest decision and invalidates pending authorization', async () => {
  let stored: string | null = 'accepted';
  const storage: ConsentStorage = {
    getItem: async () => stored,
    setItem: async (_key, value) => { stored = value; },
    removeItem: async () => { stored = null; },
  };
  const state = new AnalyticsConsentState(storage);
  await state.initialize();
  const authorization = state.captureAuthorization();
  stored = 'refused';
  const synchronization = state.synchronizeFromStorage();
  assert.equal(state.get(), 'undecided');
  assert.equal(state.captureAuthorization(), null);
  await synchronization;
  assert.equal(state.get(), 'refused');
  assert.equal(state.isAuthorizationCurrent(authorization), false);
});
