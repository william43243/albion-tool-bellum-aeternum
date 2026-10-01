import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  'android/app/src/main/java/com/albion/market/litert/LiteRTModule.kt',
  'utf8',
);

test('initialize and destroy share one lifecycle mutex', () => {
  assert.match(source, /private val lifecycleMutex = Mutex\(\)/);
  const initialize = source.slice(source.indexOf('fun initialize('), source.indexOf('fun sendMessage('));
  const destroy = source.slice(source.indexOf('fun destroy('), source.indexOf('// ─── Helpers'));
  assert.match(initialize, /lifecycleMutex\.withLock/);
  assert.match(destroy, /lifecycleMutex\.withLock/);
  assert.match(initialize, /conversationMutex\.withLock/);
  assert.match(destroy, /conversationMutex\.withLock/);
});

test('conversation callbacks cannot hold the mutex forever', () => {
  assert.match(source, /CONVERSATION_TIMEOUT_MS/);
  assert.match(source, /withTimeout\(CONVERSATION_TIMEOUT_MS\)/);
});

test('reset closes the old conversation before publishing its replacement', () => {
  const resetBody = source.slice(source.indexOf('fun resetConversation'), source.indexOf('fun destroy'));
  const publish = resetBody.indexOf('conversation = candidateConversation');
  const closeOld = resetBody.indexOf('"reset old conversation close"');
  assert.ok(closeOld >= 0 && publish > closeOld, 'reset must settle old conversation closure before publication');
  assert.match(resetBody, /cleanupLateResult = \{ closeRuntimeDirect\(candidateConversation, eng\) \}/);
  assert.match(resetBody, /cleanupLateFailure = \{ closeRuntimeDirect\(candidateConversation, eng\) \}/);
});

test('failed engine initialization closes the candidate resource', () => {
  assert.doesNotMatch(source, /Engine\([^)]*\)\.also \{ it\.initialize\(\) \}/);
  assert.match(source, /private fun createInitializedEngine\([\s\S]*candidate\.close\(\)/);
});

test('initialize commits the replacement before closing the old runtime', () => {
  const initialize = source.slice(source.indexOf('fun initialize('), source.indexOf('fun sendMessage('));
  assert.doesNotMatch(initialize.slice(0, initialize.indexOf('val isMediaTek')), /conversation\?\.close\(\)|engine\?\.close\(\)/);
  const commit = initialize.indexOf('conversation = newConversation');
  const oldClose = initialize.indexOf('closeRuntimeBounded(oldConversation, oldEngine', commit);
  assert.ok(commit >= 0, 'new conversation commit is missing');
  assert.ok(oldClose > commit, 'old runtime is closed before replacement commit');
});

test('accepted cancellation releases the inference completion gate', () => {
  const cancelStart = source.indexOf('private suspend fun cancelRegisteredInference');
  const cancelEnd = source.indexOf('private fun quarantineConversation', cancelStart);
  const body = source.slice(cancelStart, cancelEnd);
  assert.match(body, /binding\.completion\.complete\(Unit\)/);
  assert.match(body, /binding\.cancellationResult\.complete\(error\)/);
});

test('blocking native calls use a supervised wall-clock boundary', () => {
  assert.match(source, /private suspend fun <T> boundedNativeCall/);
  assert.match(source, /task\.get\(timeoutMs, TimeUnit\.MILLISECONDS\)/);
  assert.match(source, /ownership\.compareAndSet\(0, 2\)/);
  assert.doesNotMatch(source, /task\.get\(\)/);
  assert.match(source, /boundedNativeCall\("engine initialization"/);
  assert.match(source, /boundedNativeCall\(\s*"conversation creation"/);
  assert.match(source, /boundedNativeCall\(\s*"inference start"/);
  assert.match(source, /closeRuntimeBounded\(/);
  assert.match(source, /boundedNativeCall\(label\) \{ closeRuntimeDirect/);
});

test('native timeouts quarantine runtimes behind a bounded fail-closed executor', () => {
  assert.match(source, /class NativeCallTimeoutException/);
  assert.match(source, /ThreadPoolExecutor\(/);
  assert.match(source, /MAX_NATIVE_CALL_THREADS/);
  assert.match(source, /SynchronousQueue<Runnable>\(\)/);
  assert.doesNotMatch(source, /Executors\.newFixedThreadPool/);
  assert.doesNotMatch(source, /Executors\.newCachedThreadPool/);
  assert.match(source, /catch \(timeout: NativeCallTimeoutException\)[\s\S]*throw timeout/);
  assert.match(source, /abandonCandidateRuntime = true/);
  assert.match(source, /if \(!committed && !abandonCandidateRuntime\)/);
});

test('image capability is checked atomically with conversation selection', () => {
  const image = source.slice(source.indexOf('fun sendMessageWithImage'), source.indexOf('fun cancelMessage'));
  assert.doesNotMatch(image, /if \(!hasVision\)/);
  assert.match(image, /launchInference\(requestId, promise, requireVision = true\)/);
  const launch = source.slice(source.indexOf('private fun launchInference'), source.indexOf('private fun createStreamCallback'));
  assert.match(launch, /conversationMutex\.withLock[\s\S]*if \(requireVision && !hasVision\)/);
});

test('stream completion is released even when terminal event emission throws', () => {
  const callback = source.slice(source.indexOf('private fun createStreamCallback'), source.indexOf('private fun getModelDir'));
  assert.match(callback, /private fun finishOnce[\s\S]*finally[\s\S]*onFinished\(\)/);
  assert.match(callback, /safeSendEvent\("onLiteRTDone"/);
  assert.match(callback, /safeSendEvent\("onLiteRTError"/);
});

test('inference bridge catches Throwable, preserves cancellation, and always clears its binding', () => {
  const launch = source.slice(source.indexOf('private fun launchInference'), source.indexOf('private fun createStreamCallback'));
  assert.match(launch, /catch \(error: Throwable\)/);
  assert.match(launch, /if \(error is CancellationException\) throw error/);
  assert.match(launch, /finally[\s\S]*activeInference\.compareAndSet[\s\S]*completion\.complete\(Unit\)/);
  assert.ok(launch.indexOf('accepted = true') < launch.indexOf('promise.resolve(true)'));
  assert.match(launch, /if \(accepted\)[\s\S]*cancelRegisteredInference\(binding\)/);
  assert.match(launch, /Could not cancel failed inference settlement; runtime quarantined/);
});

test('reset quarantines an engine after conversation creation timeout', () => {
  const reset = source.slice(source.indexOf('fun resetConversation'), source.indexOf('fun destroy'));
  assert.match(reset, /catch \(timeout: NativeCallTimeoutException\)/);
  assert.match(reset, /if \(engine === timedOutEngine\)/);
  assert.match(reset, /engine = null/);
  assert.match(reset, /conversation = null/);
});

test('lifecycle mutex deadlines reject bridge promises instead of escaping as cancellation', () => {
  const initialize = source.slice(source.indexOf('fun initialize('), source.indexOf('fun sendMessage('));
  const deletion = source.slice(source.indexOf('fun deleteModel'), source.indexOf('// ─── Download Helpers'));
  const reset = source.slice(source.indexOf('fun resetConversation'), source.indexOf('fun destroy'));
  assert.match(initialize, /catch \(timeout: TimeoutCancellationException\)[\s\S]*promise\.reject\("INIT_ERROR"/);
  assert.match(deletion, /catch \(timeout: TimeoutCancellationException\)[\s\S]*promise\.reject\("DELETE_ERROR"/);
  assert.match(reset, /catch \(timeout: TimeoutCancellationException\)[\s\S]*promise\.reject\("RESET_ERROR"/);
});

test('automatic inference timeout quarantines runtime when native cancellation fails', () => {
  const launch = source.slice(source.indexOf('private fun launchInference'), source.indexOf('private fun createStreamCallback'));
  const timeout = launch.slice(launch.indexOf('catch (timeout: TimeoutCancellationException)'), launch.indexOf('catch (error: Throwable)'));
  assert.match(timeout, /binding\.cancellationRequested\.set\(true\)/);
  assert.match(timeout, /cancelRegisteredInference\(binding\)/);
  assert.match(timeout, /quarantineConversation\(binding\.conversation\)/);
});

test('token callback emitter failures are contained', () => {
  const callback = source.slice(source.indexOf('private fun createStreamCallback'), source.indexOf('private fun getModelDir'));
  assert.match(callback, /override fun onMessage[\s\S]*safeSendEvent\("onLiteRTToken"/);
});

test('pre-registration inference cancellation is atomically remembered', () => {
  assert.match(source, /private val scheduledInferenceIds = ConcurrentHashMap\.newKeySet<String>\(\)/);
  assert.match(source, /private val cancelledInferenceIds = ConcurrentHashMap\.newKeySet<String>\(\)/);
  assert.match(source, /private val inferenceAdmissionLock = Any\(\)/);
  const cancel = source.slice(source.indexOf('fun cancelMessage'), source.indexOf('fun resetConversation'));
  assert.match(cancel, /synchronized\(inferenceAdmissionLock\)/);
  assert.match(cancel, /scheduledInferenceIds\.contains\(requestId\)[\s\S]*cancelledInferenceIds\.add\(requestId\)/);
  const launch = source.slice(source.indexOf('private fun launchInference'), source.indexOf('private fun createStreamCallback'));
  assert.match(launch, /scheduledInferenceIds\.add\(requestId\)/);
  assert.match(launch, /synchronized\(inferenceAdmissionLock\)[\s\S]*cancelledInferenceIds\.remove\(requestId\)/);
  assert.match(launch, /safeRejectPromise\(promise, "SEND_CANCELLED"/);
});

test('admitted cancellation remains bound until native start is cancelled', () => {
  const cancel = source.slice(source.indexOf('fun cancelMessage'), source.indexOf('fun resetConversation'));
  assert.match(cancel, /current\?\.requestId == requestId -> current\.apply \{ cancellationRequested\.set\(true\) \}/);
  assert.doesNotMatch(cancel, /activeInference\.compareAndSet\(current, null\)/);
  const binding = source.slice(source.indexOf('private data class ActiveInference'), source.indexOf('private data class NativeOutcome'));
  assert.match(binding, /cancellationRequested: AtomicBoolean/);
  assert.match(binding, /nativeStarted: AtomicBoolean/);
  assert.match(binding, /cancellationIssued: AtomicBoolean/);
  assert.match(binding, /cancellationResult: CompletableDeferred<Throwable\?>/);
  const launch = source.slice(source.indexOf('private fun launchInference'), source.indexOf('private fun createStreamCallback'));
  const start = launch.indexOf(') { start(conv, callback) }');
  const registered = launch.indexOf('binding.nativeStarted.set(true)');
  const cancellationCheck = launch.indexOf('if (binding.cancellationRequested.get())');
  assert.ok(start >= 0 && registered > start && cancellationCheck > registered);
  assert.match(launch, /cancelRegisteredInference\(binding\)/);
});

test('conversation reuse waits for captured cancellation settlement', () => {
  const launch = source.slice(source.indexOf('private fun launchInference'), source.indexOf('private fun createStreamCallback'));
  const finallyBlock = launch.slice(launch.indexOf('} finally {'));
  assert.match(finallyBlock, /binding\.cancellationRequested\.get\(\)/);
  assert.match(finallyBlock, /cancelRegisteredInference\(binding\)/);
  assert.match(finallyBlock, /binding\.terminalSettlement\.complete\(Unit\)/);
  const requestedBranch = finallyBlock.slice(finallyBlock.indexOf('if (needsCancellation'));
  assert.ok(requestedBranch.indexOf('cancelRegisteredInference(binding)') < requestedBranch.indexOf('activeInference.compareAndSet(binding, null)'));
  assert.match(requestedBranch, /!binding\.cancellationTimedOut\.get\(\)/);
});

test('destroy and invalidate use binding-aware cancellation and block admission', () => {
  assert.match(source, /private val runtimeTeardownRequested = AtomicBoolean\(false\)/);
  assert.match(source, /private val runtimeTeardownGeneration = AtomicInteger\(0\)/);
  const destroy = source.slice(source.indexOf('fun destroy('), source.indexOf('// ─── Helpers'));
  assert.match(destroy, /runtimeTeardownRequested\.set\(true\)/);
  assert.match(destroy, /requestLifecycleInferenceCancellation\(\)/);
  assert.match(destroy, /quarantineRuntimeUnsafe\(\)/);
  const invalidate = source.slice(source.indexOf('override fun invalidate'));
  assert.match(invalidate, /runtimeTeardownRequested\.set\(true\)/);
  assert.match(invalidate, /requestLifecycleInferenceCancellation\(\)/);
  assert.match(invalidate, /quarantineRuntimeUnsafe\(\)/);
  const launch = source.slice(source.indexOf('private fun launchInference'), source.indexOf('private fun createStreamCallback'));
  assert.match(launch, /if \(runtimeTeardownRequested\.get\(\)\)/);
});

test('initialize rejects a requested teardown and destroy reopens only after closure', () => {
  const initialize = source.slice(source.indexOf('fun initialize('), source.indexOf('fun sendMessage('));
  const destroy = source.slice(source.indexOf('fun destroy('), source.indexOf('// ─── Helpers'));
  assert.match(initialize, /if \(runtimeTeardownRequested\.get\(\)\)[\s\S]*safeRejectPromise\(promise, "INIT_ERROR"/);
  assert.ok(destroy.indexOf('runtimeTeardownRequested.set(false)') > destroy.indexOf('oldEngine?.let'));
});

test('registered inference cancellation paths share the one-shot guard', () => {
  const launch = source.slice(source.indexOf('private fun launchInference'), source.indexOf('private fun createStreamCallback'));
  assert.doesNotMatch(launch, /boundedNativeCall\("inference cancellation"\)/);
  assert.doesNotMatch(launch, /binding\.conversation\.cancelProcess\(\)/);
  assert.match(launch, /catch \(timeout: TimeoutCancellationException\)[\s\S]*cancelRegisteredInference\(binding\)/);
  const cancellation = source.slice(source.indexOf('private suspend fun cancelRegisteredInference'), source.indexOf('private suspend fun requestLifecycleInferenceCancellation'));
  assert.match(cancellation, /cleanupLateResult = \{[\s\S]*closeInferenceRuntimeOnce\(binding\)[\s\S]*settleLateInferenceCleanup\(binding\)/);
  assert.match(cancellation, /cleanupLateFailure = \{[\s\S]*closeInferenceRuntimeOnce\(binding\)[\s\S]*settleLateInferenceCleanup\(binding\)/);
  assert.match(cancellation, /binding\.cancellationTimedOut\.set\(true\)/);
});

test('stale initialization is rejected both after lifecycle admission and before publication', () => {
  const initialize = source.slice(source.indexOf('fun initialize('), source.indexOf('fun sendMessage('));
  const checks = initialize.match(/runtimeTeardownGeneration\.get\(\) == initializationGeneration/g) ?? [];
  assert.ok(checks.length >= 2);
  assert.match(initialize, /conversationMutex\.withLock \{[\s\S]*Initialization was superseded before publication/);
});

test('late conversation creation owns ordered cleanup of its engine', () => {
  const initialize = source.slice(source.indexOf('fun initialize('), source.indexOf('fun sendMessage('));
  assert.match(source, /private data class CandidateRuntime\(val engine: Engine, val conversation: Conversation\)/);
  assert.match(initialize, /cleanupLateResult = \{ late -> closeRuntimeDirect\(late\.conversation, late\.engine\) \}/);
  const close = source.slice(source.indexOf('private fun closeRuntimeDirect'), source.indexOf('private suspend fun closeRuntimeBounded'));
  assert.ok(close.indexOf('targetConversation?.close()') < close.indexOf('targetEngine?.close()'));
});

test('active model deletion closes conversation and engine in one ordered native task', () => {
  const deletion = source.slice(source.indexOf('fun deleteModel'), source.indexOf('// ─── Download Helpers'));
  assert.match(deletion, /closeRuntimeBounded\(oldConversation, oldEngine, "delete runtime close"\)/);
  assert.doesNotMatch(deletion, /delete conversation close|delete engine close/);
});

test('late reset and inference-start termination retains ordered runtime cleanup ownership', () => {
  const reset = source.slice(source.indexOf('fun resetConversation'), source.indexOf('fun destroy'));
  assert.match(reset, /cleanupLateFailure = \{ closeRuntimeDirect\(oldConversation, eng\) \}/);
  assert.match(reset, /finally \{[\s\S]*closeRuntimeDirect\(oldConversation, eng\)/);

  const inference = source.slice(source.indexOf('private fun launchInference'), source.indexOf('private fun createStreamCallback'));
  assert.match(inference, /cleanupLateFailure = \{[\s\S]*closeInferenceRuntimeOnce\(binding\)/);
  assert.match(inference, /cleanupLateResult = \{[\s\S]*settleLateInferenceCleanup\(binding\)/);

  const bounded = source.slice(source.indexOf('private suspend fun <T> boundedNativeCall'), source.indexOf('private fun requireExpectedSize'));
  assert.match(bounded, /cleanupLateFailure: \(Throwable\) -> Unit/);
  assert.match(bounded, /cleanupLateFailure\(error\)/);
});
