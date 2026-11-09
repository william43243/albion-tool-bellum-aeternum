import assert from 'node:assert/strict';
import test from 'node:test';
import { createLatestRequestScope } from '../lib/latestRequest';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function recorder() {
  const values: string[] = [];
  const errors: unknown[] = [];
  const loading: boolean[] = [];
  return { values, errors, loading, handlers: {
    onSuccess: (value: string) => { values.push(value); },
    onError: (error: unknown) => { errors.push(error); },
    onLoadingChange: (value: boolean) => { loading.push(value); },
  } };
}

for (const filter of ['quality', 'city', 'server', 'watchlist', 'unmount']) {
  test(`ignores a response invalidated by ${filter}`, async () => {
    const scope = createLatestRequestScope();
    const response = deferred<string>();
    const recorded = recorder();
    const request = scope.run(() => response.promise, recorded.handlers);
    scope.invalidate();
    response.resolve('obsolete');
    await request;
    assert.deepEqual(recorded.values, []);
    assert.deepEqual(recorded.errors, []);
    assert.deepEqual(recorded.loading, [true]);
  });
}

test('an older completion cannot clear the newer request loading state', async () => {
  const scope = createLatestRequestScope();
  const first = deferred<string>();
  const second = deferred<string>();
  const recorded = recorder();
  const oldRequest = scope.run(() => first.promise, recorded.handlers);
  const newRequest = scope.run(() => second.promise, recorded.handlers);
  first.resolve('old');
  await oldRequest;
  assert.deepEqual(recorded.loading, [true, true]);
  assert.deepEqual(recorded.values, []);
  second.resolve('new');
  await newRequest;
  assert.deepEqual(recorded.values, ['new']);
  assert.deepEqual(recorded.loading, [true, true, false]);
});

test('late failures do not show an error or change the newer request spinner', async () => {
  const scope = createLatestRequestScope();
  const first = deferred<string>();
  const second = deferred<string>();
  const recorded = recorder();
  const oldRequest = scope.run(() => first.promise, recorded.handlers);
  scope.invalidate();
  const newRequest = scope.run(() => second.promise, recorded.handlers);
  first.reject(new Error('obsolete failure'));
  await oldRequest;
  assert.deepEqual(recorded.errors, []);
  assert.deepEqual(recorded.loading, [true, true]);
  second.resolve('new');
  await newRequest;
  assert.deepEqual(recorded.values, ['new']);
});

test('current failures are reported and finish loading', async () => {
  const scope = createLatestRequestScope();
  const recorded = recorder();
  const error = new Error('current failure');
  await scope.run(async () => { throw error; }, recorded.handlers);
  assert.deepEqual(recorded.errors, [error]);
  assert.deepEqual(recorded.loading, [true, false]);
});

test('a multi-batch request can stop after its scope becomes obsolete', async () => {
  const scope = createLatestRequestScope();
  const firstBatch = deferred<string>();
  let secondBatchRequested = false;
  const recorded = recorder();
  const request = scope.run(async (isCurrent) => {
    const value = await firstBatch.promise;
    if (!isCurrent()) return value;
    secondBatchRequested = true;
    return 'second batch';
  }, recorded.handlers);
  scope.invalidate();
  firstBatch.resolve('obsolete batch');
  await request;
  assert.equal(secondBatchRequested, false);
  assert.deepEqual(recorded.values, []);
});
