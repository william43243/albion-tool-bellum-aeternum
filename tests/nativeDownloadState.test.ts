import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  'android/app/src/main/java/com/albion/market/litert/LiteRTModule.kt',
  'utf8',
);
const bridgeSource = readFileSync('lib/litert.ts', 'utf8');
const advisorSource = readFileSync('screens/AdvisorScreen.tsx', 'utf8');

test('download APIs wait for persisted-state restoration', () => {
  assert.match(source, /downloadStateReady\.await\(\)/);
  assert.match(source, /fun getActiveDownload\(/);
});

test('only one model download can be active', () => {
  assert.match(source, /check\(activeDownloads\.isEmpty\(\)\)/);
});

test('terminal download state survives until explicit acknowledgement', () => {
  assert.match(source, /fun acknowledgeDownloadResult\(modelId: String, attemptId: String, downloadId: Double, promise: Promise\)/);
  assert.match(source, /record\.getString\("attemptId"\) != attemptId/);
  assert.match(source, /record\.getLong\("downloadId"\) != expectedDownloadId/);
  const start = source.indexOf('private fun readTerminalDownload(): WritableMap?');
  const end = source.indexOf('private fun restoreActiveDownloads', start);
  const body = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  const successfulRead = body.slice(body.indexOf('Arguments.createMap'));
  assert.doesNotMatch(successfulRead, /remove\(LAST_DOWNLOAD_RESULT_KEY\)/);
});

test('terminal state is persisted before completion is emitted', () => {
  const body = source.slice(source.indexOf('private suspend fun handleDownloadSnapshot'), source.indexOf('private suspend fun reconcileActiveDownloads'));
  const persisted = body.indexOf('commitTerminalTransition(id, entry, "complete"');
  const emitted = body.indexOf('safeEmitDownloadTerminal(');
  assert.ok(persisted >= 0 && emitted >= 0 && persisted < emitted);
});

test('download cancellation always releases its processing claim', () => {
  const body = source.slice(source.indexOf('fun cancelDownload'), source.indexOf('fun deleteModel'));
  assert.match(body, /scope\.launch/);
  assert.match(body, /finally[\s\S]*processingDownloadIds\.remove/);
});

test('multi-gigabyte readiness hashing runs on the IO scope', () => {
  const body = source.slice(source.indexOf('fun isModelDownloaded'), source.indexOf('fun getFreeDiskSpace'));
  assert.match(body, /scope\.launch/);
  assert.match(body, /ModelArtifactVerifier\.isVerified/);
});

test('inference cancellation is bound by atomic identity', () => {
  assert.match(source, /AtomicReference<ActiveInference/);
  const body = source.slice(source.indexOf('fun cancelMessage'), source.indexOf('fun resetConversation'));
  assert.match(body, /current\?\.requestId == requestId/);
  assert.match(source, /cancellationIssued\.compareAndSet\(false, true\)/);
  assert.doesNotMatch(body, /activeInferenceRequestId/);
});

test('untracked pending DownloadManager rows are recognized without a local URI', () => {
  const body = source.slice(source.indexOf('private fun cancelUntrackedModelDownloads'), source.indexOf('private fun cleanupCommittedBackup'));
  assert.match(body, /COLUMN_TITLE/);
  assert.match(body, /COLUMN_DESCRIPTION/);
  assert.match(body, /ownedPendingRow/);
  assert.doesNotMatch(body, /cursor\.isNull\(uriColumn\)\) continue/);
});

test('attempt identity follows downloads through persistence and events', () => {
  assert.match(source, /val attemptId: String/);
  assert.match(source, /put\("attemptId", entry\.attemptId\)/);
  assert.match(source, /putString\("attemptId", entry\.attemptId\)/);
  assert.match(bridgeSource, /event\.attemptId === attemptId/);
  assert.match(advisorSource, /currentDownloadAttemptRef\.current !== attemptId/);
  assert.match(source, /fun cancelDownload\(modelId: String, attemptId: String, promise: Promise\)/);
  assert.match(source, /it\.value\.attemptId == attemptId/);
  assert.match(bridgeSource, /cancelDownload\(modelId, attemptId\)/);
});

test('acknowledgement failure remains visible and retryable', () => {
  assert.match(advisorSource, /Could not acknowledge the result/);
  assert.match(advisorSource, /verifyCompleteAndAcknowledge/);
  assert.doesNotMatch(advisorSource, /acknowledgeDownloadResult\([^)]*\)\.catch\(\(\) => \{\}\)/);
});

test('Advisor deduplicates terminal acknowledgement and complete side effects', () => {
  assert.match(advisorSource, /acknowledgementInFlightRef = useRef\(new Map<string, Promise<void>>\(\)\)/);
  assert.match(advisorSource, /const acknowledgementKey = `\$\{active\.attemptId\}:\$\{active\.downloadId\}`/);
  assert.match(advisorSource, /acknowledgementInFlightRef\.current\.get\(acknowledgementKey\)/);
  assert.match(advisorSource, /if \(active\.status === 'complete'\)[\s\S]*verifyCompleteAndAcknowledge\(\)/);
  assert.match(advisorSource, /terminalProcessingInFlightRef = useRef\(new Map<string, Promise<void>>\(\)\)/);
  assert.match(advisorSource, /terminalProcessingInFlightRef\.current\.get\(processingKey\)/);
  assert.match(advisorSource, /const current = await LLM\.getActiveDownload\(\)/);
});

test('Advisor lets only accepted cancellation retire and clear an attempt', () => {
  const cancellation = advisorSource.slice(
    advisorSource.indexOf('const handleCancelDownload'),
    advisorSource.indexOf('const handleDeleteModel'),
  );
  assert.match(cancellation, /if \(!cancelled\) throw/);
  assert.match(cancellation, /retiredDownloadAttemptsRef\.current\.add\(attemptId\)/);

  const promiseRejection = advisorSource.slice(
    advisorSource.indexOf(".catch(async (err: any) =>"),
    advisorSource.indexOf('} catch (err: any)', advisorSource.indexOf(".catch(async (err: any) =>")),
  );
  assert.match(promiseRejection, /if \(err\?\.code === 'DOWNLOAD_CANCELLED'\) return/);
  assert.ok(
    promiseRejection.indexOf("err?.code === 'DOWNLOAD_CANCELLED'") < promiseRejection.indexOf('setDownloading(null)'),
  );
});

test('Advisor visibly settles unresolved durable failures and offers re-query', () => {
  assert.match(advisorSource, /const reconcileFailedDownload = async/);
  assert.match(advisorSource, /durable\?\.attemptId === attemptId && durable\.status === 'failed'/);
  assert.match(advisorSource, /setDownloading\(null\)[\s\S]*Could not retrieve the failed download result/);
  assert.match(advisorSource, /onPress: \(\) => void reconcileFailedDownload\(\)/);
});

test('Advisor rejects queued progress after an accepted cancellation', () => {
  const applyActiveDownload = advisorSource.slice(
    advisorSource.indexOf('const applyActiveDownload ='),
    advisorSource.indexOf('applyActiveDownloadRef.current = applyActiveDownload'),
  );
  assert.ok(
    applyActiveDownload.indexOf('retiredDownloadAttemptsRef.current.has(active.attemptId)') <
      applyActiveDownload.indexOf('setDownloading({'),
  );
  const cancellation = advisorSource.slice(
    advisorSource.indexOf('const handleCancelDownload'),
    advisorSource.indexOf('const handleDeleteModel'),
  );
  assert.ok(
    cancellation.indexOf('retiredDownloadAttemptsRef.current.add(attemptId)') <
      cancellation.indexOf('setDownloading(null)'),
  );
});

test('committed model backups are recovered on startup', () => {
  assert.match(source, /restoreActiveDownloads\(dm\)[\s\S]*cleanupCommittedBackup\(\)/);
  assert.match(source, /ModelArtifactVerifier\.discardBackup/);
});

test('verified models live only in app-private storage', () => {
  assert.match(source, /getModelDir\(\): File = File\(reactContext\.filesDir/);
  assert.match(source, /ModelArtifactVerifier\.importAndPromote/);
  const modelDirs = source.slice(source.indexOf('private fun getAllModelDirs'), source.indexOf('private fun findModelFile'));
  assert.doesNotMatch(modelDirs, /getExternalFilesDir/);
});

test('model paths require an exact confined litertlm basename', () => {
  assert.match(source, /MODEL_FILENAME_PATTERN/);
  assert.match(source, /private fun requireModelFilename/);
  assert.match(source, /File\(directory, basename\)\.canonicalFile/);
  assert.match(source, /candidate\.parentFile == directory/);
  const find = source.slice(source.indexOf('private fun findModelFile'), source.indexOf('private fun sendEvent'));
  assert.match(find, /requireModelFilename\(filename\)/);
  assert.doesNotMatch(find, /File\(dir, filename\)/);
});

test('cancellation restores active state when its durable commit fails', () => {
  const body = source.slice(source.indexOf('fun cancelDownload'), source.indexOf('fun deleteModel'));
  assert.match(body, /activeDownloads\.remove[\s\S]*persistActiveDownloadsLocked/);
  assert.match(body, /catch \(commitError: Throwable\)[\s\S]*activeDownloads\[toRemove\.key\] = toRemove\.value/);
  const accepted = body.indexOf('safeResolvePromise(promise, true');
  const originalRejected = body.indexOf('safeRejectPromise(toRemove.value.promise');
  assert.ok(originalRejected >= 0 && accepted > originalRejected, 'original download must settle before cancellation resolves');
  assert.match(body, /safeRejectPromise\(toRemove\.value\.promise/);
  assert.match(body, /safeResolvePromise\(promise, true/);
});

test('Advisor success promise reconciles and acknowledges durable terminal state', () => {
  const success = advisorSource.slice(advisorSource.indexOf('promise\n          .then'), advisorSource.indexOf('.catch(async', advisorSource.indexOf('promise\n          .then')));
  assert.match(success, /LLM\.getActiveDownload\(\)/);
  assert.match(success, /durable\?\.attemptId === attemptId && durable\.status === 'complete'/);
  assert.match(success, /applyActiveDownloadRef\.current\?\.\(durable\)/);
  const androidSuccess = success.slice(success.indexOf('const durable = await LLM.getActiveDownload()'));
  assert.doesNotMatch(androidSuccess, /currentDownloadAttemptRef\.current = null/);
});

test('Advisor exposes durable-state lookup failures with retry', () => {
  const recovery = advisorSource.slice(advisorSource.indexOf('const showDownloadRecoveryError'), advisorSource.indexOf('refreshDownloadedModels();'));
  assert.match(recovery, /catch\(showDownloadRecoveryError\)/);
  assert.match(recovery, /function syncActiveDownload/);
  assert.match(recovery, /onPress: syncActiveDownload/);
  assert.doesNotMatch(recovery, /catch\(\(\) => \{\}\)/);
});

test('artifact mutation is serialized across promotion cleanup and deletion', () => {
  assert.match(source, /private val artifactMutexes = ConcurrentHashMap<String, Mutex>/);
  const handler = source.slice(source.indexOf('private suspend fun handleDownloadSnapshot'), source.indexOf('private fun emitDownloadTerminal'));
  assert.match(handler, /artifactMutex\(entry\.filename\)\.withLock/);
  assert.match(handler, /discardBackup/);
  const deletion = source.slice(source.indexOf('fun deleteModel'), source.indexOf('// ─── Download Helpers'));
  assert.match(deletion, /artifactMutex\(modelFilename\)\.withLock/);
});

test('startup recovery never preserves an invalid complete terminal record', () => {
  const cleanup = source.slice(source.indexOf('private suspend fun cleanupCommittedBackup'), source.indexOf('private fun stopProgressPolling'));
  assert.match(cleanup, /ModelArtifactVerifier\.isVerified/);
  assert.match(cleanup, /ModelArtifactVerifier\.restoreBackup/);
  assert.match(cleanup, /put\("status", "failed"\)/);
  assert.match(cleanup, /commit\(\)/);
  assert.ok(cleanup.indexOf('putString(LAST_DOWNLOAD_RESULT_KEY') < cleanup.indexOf('ModelArtifactVerifier.restoreBackup'));
  assert.match(cleanup, /status == "failed"[\s\S]*restoreBackup/);
});

test('terminal event failures cannot prevent promise settlement', () => {
  const body = source.slice(source.indexOf('private suspend fun handleDownloadSnapshot'), source.indexOf('private fun emitDownloadTerminal'));
  assert.match(body, /safeEmitDownloadTerminal/);
  assert.doesNotMatch(body, /emitDownloadTerminal\(/);
});

test('verified legacy external models migrate into private storage', () => {
  const readiness = source.slice(source.indexOf('fun isModelDownloaded'), source.indexOf('fun getFreeDiskSpace'));
  assert.match(readiness, /migrateLegacyModelIfPresent/);
  assert.match(source, /private suspend fun migrateLegacyModelIfPresent/);
  assert.match(source, /ModelArtifactVerifier\.isVerified\(legacyFile/);
  assert.match(source, /ModelArtifactVerifier\.importAndPromote/);
  assert.match(source, /legacyFile\.delete\(\)/);
});

test('Android disk admission accounts for staging plus private copy', () => {
  const capacity = source.slice(source.indexOf('fun getFreeDiskSpace'), source.indexOf('fun getActiveDownload'));
  assert.match(capacity, /Os\.stat\(/);
  assert.match(capacity, /privateStats\.st_dev == stagingStats\.st_dev/);
  assert.match(capacity, /privateFree \/ 2L/);
  assert.match(capacity, /minOf\(privateFree, stagingFree\)/);
});

test('web download success bypasses Android durable-state acknowledgement', () => {
  const successStart = advisorSource.indexOf('.then(async function reconcileCompletedDownload');
  const success = advisorSource.slice(successStart, advisorSource.indexOf('.catch(async', successStart));
  assert.match(success, /if \(Platform\.OS === 'web'\)/);
  assert.match(success, /currentDownloadAttemptRef\.current = null/);
  assert.match(success, /refreshDownloadedModels\(\)/);
  assert.ok(success.indexOf("Platform.OS === 'web'") < success.indexOf('LLM.getActiveDownload()'));
});

test('complete terminal result is acknowledged only after exact readiness verification', () => {
  const apply = advisorSource.slice(advisorSource.indexOf('const applyActiveDownload'), advisorSource.indexOf('applyActiveDownloadRef.current = applyActiveDownload'));
  assert.match(apply, /refreshDownloadedModels\(\)[\s\S]*verified\.has\(active\.filename\)[\s\S]*return acknowledge\(\)/);
  assert.doesNotMatch(apply, /catch\(\(\) => acknowledge\(\)\)/);
  assert.match(apply, /result is preserved/);
});

test('terminal acknowledgement retains cleanup metadata until backup disposal succeeds', () => {
  const ack = source.slice(source.indexOf('fun acknowledgeDownloadResult'), source.indexOf('fun downloadModel'));
  assert.match(ack, /ModelArtifactVerifier\.discardBackup/);
  assert.match(ack, /ModelArtifactVerifier\.isVerified/);
  assert.ok(ack.indexOf('discardBackup') < ack.indexOf('remove(LAST_DOWNLOAD_RESULT_KEY)'));
});

test('legacy migration sweeps recognized operation partials and backups', () => {
  const migration = source.slice(source.indexOf('private suspend fun migrateLegacyModelIfPresent'), source.indexOf('private fun sendEvent'));
  assert.match(migration, /endsWith\("\.legacy\.tmp"\)/);
  assert.match(migration, /endsWith\("\.legacy\.backup"\)/);
  assert.match(migration, /ModelArtifactVerifier\.restoreBackup/);
  assert.match(migration, /ModelArtifactVerifier\.discardBackup/);
});

test('retryable startup backup cleanup does not poison download readiness', () => {
  const init = source.slice(source.indexOf('init {'), source.indexOf('override fun getName'));
  assert.match(init, /runCatching \{ cleanupCommittedBackup\(\) \}/);
  assert.match(init, /downloadStateReady\.complete\(Unit\)/);
});

test('retained complete terminal cannot lose its only recovery control', () => {
  const apply = advisorSource.slice(advisorSource.indexOf('const applyActiveDownload'), advisorSource.indexOf('applyActiveDownloadRef.current = applyActiveDownload'));
  assert.match(apply, /if \(active\.status === 'complete'\)[\s\S]*verifyCompleteAndAcknowledge\(\)/);
  assert.match(apply, /cancelable: false/);
  assert.match(advisorSource, /disabled=\{blockedTerminalModelId === model\.id\}/);
});

test('acknowledgement identity includes attempt ID across every bridge', () => {
  assert.match(advisorSource, /acknowledgeDownloadResult\(active\.modelId, active\.attemptId, active\.downloadId\)/);
  assert.match(bridgeSource, /acknowledgeDownloadResult\(modelId: string, attemptId: string, downloadId: number\)/);
  assert.match(bridgeSource, /LiteRTModule\.acknowledgeDownloadResult\(modelId, attemptId, downloadId\)/);
});

test('failed terminal acknowledgement restores backup before retiring recovery metadata', () => {
  const acknowledge = source.slice(source.indexOf('fun acknowledgeDownloadResult'), source.indexOf('fun downloadModel'));
  const failed = acknowledge.indexOf('status == "failed"');
  const restore = acknowledge.indexOf('ModelArtifactVerifier.restoreBackup', failed);
  const remove = acknowledge.indexOf('.remove(LAST_DOWNLOAD_RESULT_KEY)', failed);
  assert.ok(failed >= 0 && restore > failed && remove > restore);
});

test('native deletion waits for restoration and rejects a retained complete terminal', () => {
  const deletion = source.slice(source.indexOf('fun deleteModel'), source.indexOf('// ─── Download Helpers'));
  assert.match(deletion, /downloadStateReady\.await\(\)/);
  assert.match(deletion, /LAST_DOWNLOAD_RESULT_KEY/);
  assert.match(deletion, /Cannot delete a model while its completed download result is pending acknowledgement/);
});

test('committed download completion settles even when backup cleanup is deferred', () => {
  const finalization = source.slice(source.indexOf('private suspend fun handleDownloadSnapshot'), source.indexOf('private fun emitDownloadTerminal'));
  assert.match(finalization, /runCatching \{ ModelArtifactVerifier\.discardBackup\(backupFile\) \}/);
  assert.match(finalization, /Deferred committed backup cleanup until acknowledgement/);
  assert.ok(finalization.indexOf('commitTerminalTransition') < finalization.indexOf('safeEmitDownloadTerminal'));
});
