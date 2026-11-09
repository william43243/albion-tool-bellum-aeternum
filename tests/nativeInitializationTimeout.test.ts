import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('android/app/src/main/java/com/albion/market/litert/LiteRTModule.kt', 'utf8');

test('every engine startup tier has a dedicated bounded cold-compilation budget', () => {
  const startup = source.match(/ENGINE_INITIALIZATION_TIMEOUT_MS = ([\d_]+)L/);
  assert.ok(startup);
  const timeout = Number(startup[1].replaceAll('_', ''));
  assert.equal(timeout, 300_000);
  // Observed on S22: native graph initialization/cleanup kept progressing until
  // approximately 84s after start, despite the old 10s wrapper failure.
  assert.ok(timeout > 84_000);
  const calls = [...source.matchAll(/boundedNativeCall\("engine initialization",([^\n]*)/g)];
  assert.equal(calls.length, 4, 'vision, GPU text, CPU text and vision-conversation fallback');
  for (const call of calls) {
    assert.match(call[1], /timeoutMs = ENGINE_INITIALIZATION_TIMEOUT_MS/);
    assert.match(call[1], /cleanupLateResult = \{ late -> late\.close\(\) \}/);
    assert.match(call[1], /initialization = initialization/);
  }
});

test('short lifecycle deadlines and fail-closed late-result handling remain intact', () => {
  assert.match(source, /LIFECYCLE_WAIT_TIMEOUT_MS = 10_000L/);
  assert.match(source, /timeoutMs: Long = LIFECYCLE_WAIT_TIMEOUT_MS/);
  assert.match(source, /task\.get\(timeoutMs, TimeUnit\.MILLISECONDS\)/);
  assert.match(source, /ownership\.compareAndSet\(0, 2\)/);
  assert.match(source, /task\.cancel\(true\)/);
  assert.match(source, /cleanupLateResult\(result\)/);
  assert.match(source, /catch \(timeout: NativeCallTimeoutException\) \{\s*throw timeout/g);
  assert.match(source, /if \(!committed && !abandonCandidateRuntime\)/);
});

test('initialization admission outlives the caller until real native workers and cleanup settle', () => {
  assert.match(source, /companion object \{[\s\S]*private val nativeInitializationGate = NativeInitializationGate\(\)/);
  assert.match(source, /val initialization = nativeInitializationGate\.tryAcquire\(\)/);
  assert.match(source, /"INIT_IN_PROGRESS"/);
  assert.match(source, /initializationJob\.invokeOnCompletion \{ initialization\.close\(\) \}/);
  assert.match(source, /val worker = initialization\?\.trackWorker\(\)/);
  assert.match(source, /!worker\.start\(\)/);
  const bounded = source.slice(source.indexOf('private suspend fun <T> boundedNativeCall'), source.indexOf('private fun requireExpectedSize'));
  assert.match(bounded, /finally \{[\s\S]*worker\?\.finish\(\)/);
  assert.equal((bounded.match(/worker\?\.cancelBeforeStart\(\)/g) ?? []).length, 3, 'submission rejection, timeout and interrupted waiter');
  assert.match(bounded, /onFailure \{ initialization\?\.quarantine\(\); Log\.w\(TAG, "Late native cleanup/);
  assert.match(source, /cleanupLateFailure = \{ closeRuntimeDirect\(null, candidateEngine\) \}/);
  assert.match(source, /cleanupLateFailure = \{ closeRuntimeDirect\(null, fallbackEngine\) \}/);
});

test('an interrupted native waiter cannot trigger a fallback while its JNI worker is still alive', () => {
  const bounded = source.slice(source.indexOf('private suspend fun <T> boundedNativeCall'), source.indexOf('private fun requireExpectedSize'));
  const interrupted = bounded.slice(bounded.indexOf('catch (interrupted: InterruptedException)'));
  assert.match(interrupted, /Thread\.currentThread\(\)\.interrupt\(\)/);
  assert.match(interrupted, /throw NativeCallTimeoutException\(/);
  assert.doesNotMatch(interrupted, /throw interrupted/);
  const initialize = source.slice(source.indexOf('fun initialize('), source.indexOf('fun sendMessage('));
  assert.equal((initialize.match(/catch \(timeout: NativeCallTimeoutException\) \{\s*throw timeout/g) ?? []).length, 4);
  assert.match(initialize, /if \(e is NativeCallTimeoutException\) abandonCandidateRuntime = true/);
});
