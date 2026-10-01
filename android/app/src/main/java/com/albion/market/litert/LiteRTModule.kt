package com.albion.market.litert

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.StatFs
import android.system.Os
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.MessageCallback
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.SamplerConfig
import com.google.ai.edge.litertlm.tool
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutionException
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONArray
import org.json.JSONObject

class LiteRTModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "LiteRTModule"
        private const val TAG = "LiteRTModule"
        private const val DOWNLOAD_PREFS = "litert_download_state"
        private const val DOWNLOADS_KEY = "active_downloads"
        private const val LAST_DOWNLOAD_RESULT_KEY = "last_download_result"
        private const val CONVERSATION_TIMEOUT_MS = 120_000L
        private const val LIFECYCLE_WAIT_TIMEOUT_MS = 10_000L
        private const val MAX_NATIVE_CALL_THREADS = 4
        private val MODEL_FILENAME_PATTERN = Regex("^[A-Za-z0-9][A-Za-z0-9._-]*\\.litertlm$")
        private val MODEL_PARTIAL_PATTERN = Regex("^[A-Za-z0-9._-]+\\.litertlm\\.[0-9a-fA-F-]+\\.tmp$")
    }

    private var engine: Engine? = null
    private var conversation: Conversation? = null
    private var currentModelId: String? = null
    private var currentServerBaseUrl: String? = null
    private var currentSupportsTools: Boolean = false
    private var hasVision: Boolean = false
    private data class ActiveInference(
        val requestId: String,
        val conversation: Conversation,
        val engine: Engine,
        val completion: CompletableDeferred<Unit>,
        val cancellationRequested: AtomicBoolean = AtomicBoolean(false),
        val nativeStarted: AtomicBoolean = AtomicBoolean(false),
        val cancellationIssued: AtomicBoolean = AtomicBoolean(false),
        val cancellationResult: CompletableDeferred<Throwable?> = CompletableDeferred(),
        val terminalSettlement: CompletableDeferred<Unit> = CompletableDeferred(),
        val nativeStartTimedOut: AtomicBoolean = AtomicBoolean(false),
        val nativeStartSettlement: CompletableDeferred<Unit> = CompletableDeferred(),
        val cancellationTimedOut: AtomicBoolean = AtomicBoolean(false),
        val runtimeCleanupIssued: AtomicBoolean = AtomicBoolean(false),
        val runtimeCleanupSettlement: CompletableDeferred<Unit> = CompletableDeferred(),
    )
    private data class NativeOutcome<T>(val value: T? = null, val error: Throwable? = null)
    private data class CandidateRuntime(val engine: Engine, val conversation: Conversation)
    private class NativeCallTimeoutException(message: String, cause: Throwable) :
        IllegalStateException(message, cause)
    private val activeInference = AtomicReference<ActiveInference?>(null)
    private val inferenceAdmissionLock = Any()
    private val scheduledInferenceIds = ConcurrentHashMap.newKeySet<String>()
    private val cancelledInferenceIds = ConcurrentHashMap.newKeySet<String>()
    private val runtimeTeardownRequested = AtomicBoolean(false)
    private val runtimeTeardownGeneration = AtomicInteger(0)
    private var backendUsed: String = "unknown"
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val nativeExecutor = ThreadPoolExecutor(
        0,
        MAX_NATIVE_CALL_THREADS,
        30L,
        TimeUnit.SECONDS,
        SynchronousQueue<Runnable>(),
        { runnable -> Thread(runnable, "litert-native-call").apply { isDaemon = true } },
        ThreadPoolExecutor.AbortPolicy(),
    )
    private val conversationMutex = Mutex()
    private val lifecycleMutex = Mutex()

    private fun isMediaTekChipset(): Boolean {
        val soc = Build.HARDWARE.lowercase()
        val board = Build.BOARD.lowercase()
        return soc.contains("mt") || soc.contains("mediatek") ||
               board.contains("mt") || board.contains("mediatek")
    }

    private fun getChipsetInfo(): String = "${Build.HARDWARE} (${Build.BOARD})"

    private data class ActiveDownload(
        val attemptId: String,
        val modelId: String,
        val filename: String,
        val expectedSize: Long,
        val expectedSha256: String,
        val partialFilename: String,
        val backupFilename: String,
        val promise: Promise?,
    )

    private val activeDownloads = ConcurrentHashMap<Long, ActiveDownload>()
    private val processingDownloadIds = ConcurrentHashMap.newKeySet<Long>()
    private val artifactMutexes = ConcurrentHashMap<String, Mutex>()
    private val downloadStateLock = Any()
    private val downloadStateReady = CompletableDeferred<Unit>()
    private var progressPollingJob: Job? = null
    private var downloadReceiver: BroadcastReceiver? = null

    init {
        scope.launch {
            try {
                val dm = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                restoreActiveDownloads(dm)
                runCatching { cleanupCommittedBackup() }
                    .onFailure { Log.w(TAG, "Deferred committed model cleanup until acknowledgement", it) }
                cancelUntrackedModelDownloads(dm)
                if (activeDownloads.isNotEmpty()) {
                    ensureDownloadReceiver()
                    reconcileActiveDownloads(dm)
                    if (activeDownloads.isNotEmpty()) startProgressPolling(dm)
                }
                downloadStateReady.complete(Unit)
            } catch (error: Exception) {
                Log.e(TAG, "Could not restore model download state", error)
                downloadStateReady.completeExceptionally(error)
            }
        }
    }

    override fun getName(): String = NAME

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    // ─── Model Management ────────────────────────────────────────

    @ReactMethod
    fun getDownloadedModels(promise: Promise) {
        try {
            val models = Arguments.createArray()
            val seen = mutableSetOf<String>()
            for (dir in getAllModelDirs()) {
                if (!dir.exists()) continue
                dir.listFiles()
                    ?.filter { it.name.matches(MODEL_FILENAME_PATTERN) && it.canonicalFile.parentFile == dir.canonicalFile && it.name !in seen }
                    ?.forEach { file ->
                        seen.add(file.name)
                        models.pushMap(Arguments.createMap().apply {
                            putString("id", file.nameWithoutExtension)
                            putString("filename", file.name)
                            putString("path", file.absolutePath)
                            putDouble("sizeBytes", file.length().toDouble())
                        })
                    }
            }
            promise.resolve(models)
        } catch (e: Exception) {
            promise.reject("LIST_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun isModelDownloaded(modelFilename: String, expectedSizeBytes: Double, expectedSha256: String, promise: Promise) {
        scope.launch {
            try {
                val expectedSize = requireExpectedSize(expectedSizeBytes)
                migrateLegacyModelIfPresent(modelFilename, expectedSize, expectedSha256)
                val file = findModelFile(modelFilename)
                promise.resolve(file != null && ModelArtifactVerifier.isVerified(file, expectedSize, expectedSha256))
            } catch (e: Exception) {
                promise.reject("INVALID_MODEL_METADATA", e.message, e)
            }
        }
    }

    @ReactMethod
    fun getFreeDiskSpace(promise: Promise) {
        try {
            val privateDir = getModelDir()
            val stagingDir = getDownloadStagingDir()
            val privateFree = StatFs(privateDir.path).availableBytes
            val stagingFree = StatFs(stagingDir.path).availableBytes
            val privateStats = Os.stat(privateDir.path)
            val stagingStats = Os.stat(stagingDir.path)
            val installCapacity = if (privateStats.st_dev == stagingStats.st_dev) {
                privateFree / 2L
            } else {
                minOf(privateFree, stagingFree)
            }
            promise.resolve(installCapacity.toDouble())
        } catch (e: Exception) { promise.resolve(-1.0) }
    }

    @ReactMethod
    fun getActiveDownload(promise: Promise) {
        scope.launch {
            try {
                downloadStateReady.await()
                val active = activeDownloads.entries.firstOrNull()
                if (active == null) {
                    promise.resolve(readTerminalDownload())
                    return@launch
                }
                val dm = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                val snapshot = queryDownload(dm, active.key)
                if (snapshot == null) {
                    handleDownloadSnapshot(dm, active.key, null)
                    promise.resolve(readTerminalDownload())
                    return@launch
                }
                val percent = if (snapshot.total > 0) {
                    snapshot.downloaded.toDouble() / snapshot.total * 100.0
                } else {
                    0.0
                }
                promise.resolve(Arguments.createMap().apply {
                    putDouble("downloadId", active.key.toDouble())
                    putString("attemptId", active.value.attemptId)
                    putString("modelId", active.value.modelId)
                    putString("filename", active.value.filename)
                    putDouble("bytesDownloaded", snapshot.downloaded.toDouble())
                    putDouble("totalBytes", snapshot.total.toDouble())
                    putDouble("percent", percent)
                    putString("status", when (snapshot.status) {
                        DownloadManager.STATUS_RUNNING -> "downloading"
                        DownloadManager.STATUS_PENDING, DownloadManager.STATUS_PAUSED -> "pending"
                        DownloadManager.STATUS_SUCCESSFUL -> "verifying"
                        else -> "failed"
                    })
                })
            } catch (error: Exception) {
                promise.reject("DOWNLOAD_STATE_ERROR", error.message, error)
            }
        }
    }

    @ReactMethod
    fun acknowledgeDownloadResult(modelId: String, attemptId: String, downloadId: Double, promise: Promise) {
        scope.launch {
            try {
                downloadStateReady.await()
                val expectedDownloadId = requireDownloadId(downloadId)
                val serialized = synchronized(downloadStateLock) {
                    reactContext.getSharedPreferences(DOWNLOAD_PREFS, Context.MODE_PRIVATE)
                        .getString(LAST_DOWNLOAD_RESULT_KEY, null)
                } ?: run {
                    promise.resolve(false)
                    return@launch
                }
                val record = JSONObject(serialized)
                if (record.getString("modelId") != modelId ||
                    record.getString("attemptId") != attemptId ||
                    record.getLong("downloadId") != expectedDownloadId) {
                    promise.resolve(false)
                    return@launch
                }
                val status = record.optString("status")
                if (status == "complete") {
                    val filename = requireModelFilename(record.getString("filename"))
                    val backupFilename = record.getString("backupFilename")
                    val expectedSize = record.getLong("totalBytes")
                    val expectedSha256 = record.getString("expectedSha256")
                    require(backupFilename.matches(Regex("^[A-Za-z0-9][A-Za-z0-9._-]*\\.litertlm\\.[0-9a-fA-F-]+\\.backup$"))) {
                        "Invalid committed model backup filename"
                    }
                    artifactMutex(filename).withLock {
                        check(ModelArtifactVerifier.isVerified(confinedModelFile(filename), expectedSize, expectedSha256)) {
                            "Completed model is no longer verified"
                        }
                        ModelArtifactVerifier.discardBackup(confinedPrivateFile(backupFilename))
                    }
                } else if (status == "failed") {
                    val filename = requireModelFilename(record.getString("filename"))
                    val backupFilename = record.getString("backupFilename")
                    require(backupFilename.matches(Regex("^[A-Za-z0-9][A-Za-z0-9._-]*\\.litertlm\\.[0-9a-fA-F-]+\\.backup$"))) {
                        "Invalid failed model backup filename"
                    }
                    artifactMutex(filename).withLock {
                        ModelArtifactVerifier.restoreBackup(
                            confinedModelFile(filename),
                            confinedPrivateFile(backupFilename),
                        )
                    }
                } else {
                    error("Unsupported terminal download state")
                }
                val removed = synchronized(downloadStateLock) {
                    val prefs = reactContext.getSharedPreferences(DOWNLOAD_PREFS, Context.MODE_PRIVATE)
                    if (prefs.getString(LAST_DOWNLOAD_RESULT_KEY, null) != serialized) return@synchronized false
                    check(prefs.edit().remove(LAST_DOWNLOAD_RESULT_KEY).commit())
                    true
                }
                promise.resolve(removed)
            } catch (error: Exception) {
                promise.reject("DOWNLOAD_STATE_ERROR", error.message, error)
            }
        }
    }

    @ReactMethod
    fun downloadModel(
        attemptId: String,
        modelId: String,
        url: String,
        filename: String,
        expectedSizeBytes: Double,
        expectedSha256: String,
        promise: Promise,
    ) {
        scope.launch {
          try {
            downloadStateReady.await()
            require(attemptId.matches(Regex("^[A-Za-z0-9-]{16,100}$"))) { "Invalid download attempt ID" }
            requireModelFilename(filename)
            val expectedSize = requireExpectedSize(expectedSizeBytes)
            require(expectedSha256.matches(Regex("^[0-9a-fA-F]{64}$"))) {
                "Invalid model SHA-256"
            }
            val dm = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val extDir = reactContext.getExternalFilesDir("litert-models")
            if (extDir != null && !extDir.exists()) extDir.mkdirs()
            ensureDownloadReceiver()
            val operationId = UUID.randomUUID().toString()
            val partialFilename = "$filename.$operationId.tmp"
            val backupFilename = "$filename.$operationId.backup"
            val downloadId = synchronized(downloadStateLock) {
                check(activeDownloads.isEmpty()) { "Only one model download may be active" }
                val prefs = reactContext.getSharedPreferences(DOWNLOAD_PREFS, Context.MODE_PRIVATE)
                check(prefs.getString(LAST_DOWNLOAD_RESULT_KEY, null) == null) {
                    "A previous download result must be acknowledged first"
                }
                val request = DownloadManager.Request(Uri.parse(url)).apply {
                    setTitle("AlbionMarket AI: $modelId")
                    setDescription(filename)
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                    setDestinationInExternalFilesDir(reactContext, "litert-models", partialFilename)
                    setAllowedOverMetered(true)
                    setAllowedOverRoaming(false)
                    setAllowedNetworkTypes(DownloadManager.Request.NETWORK_WIFI or DownloadManager.Request.NETWORK_MOBILE)
                }
                dm.enqueue(request).also { id ->
                    val entry = ActiveDownload(
                        attemptId,
                        modelId,
                        filename,
                        expectedSize,
                        expectedSha256.lowercase(),
                        partialFilename,
                        backupFilename,
                        promise,
                    )
                    activeDownloads[id] = entry
                    try {
                        persistActiveDownloadsLocked()
                    } catch (error: Exception) {
                        activeDownloads.remove(id, entry)
                        dm.remove(id)
                        File(getDownloadStagingDir(), partialFilename).delete()
                        throw error
                    }
                }
            }
            Log.i(TAG, "Download enqueued: $modelId (id=$downloadId)")
            startProgressPolling(dm)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start download", e)
            promise.reject("DOWNLOAD_ERROR", "Download failed: ${e.message}", e)
          }
        }
    }

    @ReactMethod
    fun cancelDownload(modelId: String, attemptId: String, promise: Promise) {
        scope.launch {
            try {
                downloadStateReady.await()
            } catch (error: Exception) {
                promise.reject("DOWNLOAD_STATE_ERROR", error.message, error)
                return@launch
            }
            val dm = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val toRemove = activeDownloads.entries.find {
                it.value.modelId == modelId && it.value.attemptId == attemptId
            }
            if (toRemove == null || !processingDownloadIds.add(toRemove.key)) {
                promise.resolve(false)
                return@launch
            }
            try {
                dm.remove(toRemove.key)
                synchronized(downloadStateLock) {
                    if (activeDownloads.remove(toRemove.key, toRemove.value)) {
                        try {
                            persistActiveDownloadsLocked()
                        } catch (commitError: Throwable) {
                            activeDownloads[toRemove.key] = toRemove.value
                            throw commitError
                        }
                    }
                }
                File(getDownloadStagingDir(), toRemove.value.partialFilename).delete()
                safeRejectPromise(toRemove.value.promise, "DOWNLOAD_CANCELLED", "Download cancelled by user")
                safeResolvePromise(promise, true, "accepted download cancellation")
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                promise.reject("DOWNLOAD_CANCEL_ERROR", error.message, error)
            } finally {
                processingDownloadIds.remove(toRemove.key)
                if (activeDownloads.isEmpty()) stopProgressPolling()
            }
        }
    }

    @ReactMethod
    fun deleteModel(filename: String, promise: Promise) {
        scope.launch {
            val modelFilename = try {
                downloadStateReady.await()
                requireModelFilename(filename)
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                promise.reject("DELETE_ERROR", error.message, error)
                return@launch
            }
            lifecycleMutex.withLock {
                artifactMutex(modelFilename).withLock {
                  try {
                    val retainedFilename = synchronized(downloadStateLock) {
                        reactContext.getSharedPreferences(DOWNLOAD_PREFS, Context.MODE_PRIVATE)
                            .getString(LAST_DOWNLOAD_RESULT_KEY, null)
                            ?.let(::JSONObject)
                            ?.takeIf { it.optString("status") == "complete" }
                            ?.optString("filename")
                    }
                    check(retainedFilename != modelFilename) {
                        "Cannot delete a model while its completed download result is pending acknowledgement"
                    }
                    withTimeout(LIFECYCLE_WAIT_TIMEOUT_MS) {
                        conversationMutex.withLock {
                            val file = findModelFile(modelFilename)
                            if (file != null && file.nameWithoutExtension == currentModelId) {
                                val oldConversation = conversation
                                val oldEngine = engine
                                conversation = null
                                engine = null
                                currentModelId = null
                                closeRuntimeBounded(oldConversation, oldEngine, "delete runtime close")
                            }
                            promise.resolve(file?.delete() ?: false)
                        }
                    }
                  } catch (timeout: TimeoutCancellationException) {
                    promise.reject("DELETE_ERROR", timeout.message, timeout)
                  } catch (e: Throwable) {
                    if (e is CancellationException) throw e
                    promise.reject("DELETE_ERROR", e.message, e)
                  }
                }
            }
        }
    }

    // ─── Download Helpers ────────────────────────────────────────

    private fun ensureDownloadReceiver() {
        synchronized(downloadStateLock) {
            if (downloadReceiver != null) return
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context, intent: Intent) {
                    val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
                    if (id < 0 || !activeDownloads.containsKey(id)) return
                    val pendingResult = goAsync()
                    scope.launch {
                        try {
                            val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                            handleDownloadSnapshot(dm, id, queryDownload(dm, id))
                        } finally {
                            pendingResult.finish()
                        }
                    }
                }
            }
            ContextCompat.registerReceiver(
                reactContext,
                receiver,
                IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                ContextCompat.RECEIVER_EXPORTED,
            )
            downloadReceiver = receiver
        }
    }

    private fun startProgressPolling(dm: DownloadManager) {
        if (progressPollingJob?.isActive == true) return
        progressPollingJob = scope.launch {
            while (isActive && activeDownloads.isNotEmpty()) {
                for ((downloadId, entry) in activeDownloads.toMap()) {
                    val snapshot = queryDownload(dm, downloadId)
                    if (snapshot == null || snapshot.status == DownloadManager.STATUS_SUCCESSFUL || snapshot.status == DownloadManager.STATUS_FAILED) {
                        handleDownloadSnapshot(dm, downloadId, snapshot)
                    } else if (snapshot.status == DownloadManager.STATUS_RUNNING || snapshot.status == DownloadManager.STATUS_PENDING) {
                        val percent = if (snapshot.total > 0) (snapshot.downloaded.toDouble() / snapshot.total * 100) else 0.0
                        sendEvent("onDownloadProgress", Arguments.createMap().apply {
                            putDouble("downloadId", downloadId.toDouble())
                            putString("attemptId", entry.attemptId)
                            putString("modelId", entry.modelId)
                            putString("filename", entry.filename)
                            putDouble("bytesDownloaded", snapshot.downloaded.toDouble())
                            putDouble("totalBytes", snapshot.total.toDouble())
                            putDouble("percent", percent)
                            putString("status", if (snapshot.status == DownloadManager.STATUS_RUNNING) "downloading" else "pending")
                        })
                    }
                }
                delay(1000)
            }
        }
    }

    private data class DownloadSnapshot(val status: Int, val downloaded: Long, val total: Long)

    private fun queryDownload(dm: DownloadManager, id: Long): DownloadSnapshot? {
        return dm.query(DownloadManager.Query().setFilterById(id))?.use { cursor ->
            if (!cursor.moveToFirst()) return@use null
            DownloadSnapshot(
                cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)),
                cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)),
                cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)),
            )
        }
    }

    private suspend fun handleDownloadSnapshot(dm: DownloadManager, id: Long, snapshot: DownloadSnapshot?) {
        val entry = activeDownloads[id] ?: return
        val terminal = snapshot == null || snapshot.status == DownloadManager.STATUS_SUCCESSFUL || snapshot.status == DownloadManager.STATUS_FAILED
        if (!terminal || !processingDownloadIds.add(id)) return
        artifactMutex(entry.filename).withLock {
        var transitioned = false
        try {
            val downloadedFile = File(getDownloadStagingDir(), entry.partialFilename)
            val privatePartial = confinedPrivateFile(entry.partialFilename)
            val destFile = confinedModelFile(entry.filename)
            val backupFile = confinedPrivateFile(entry.backupFilename)

            // Recovery path for a crash after atomic promotion but before the
            // active->terminal SharedPreferences transaction committed.
            if (!downloadedFile.exists() && ModelArtifactVerifier.isVerified(destFile, entry.expectedSize, entry.expectedSha256)) {
                commitTerminalTransition(id, entry, "complete", entry.expectedSize)
                transitioned = true
                runCatching { ModelArtifactVerifier.discardBackup(backupFile) }
                    .onFailure { Log.w(TAG, "Deferred committed backup cleanup until acknowledgement", it) }
                safeEmitDownloadTerminal(id, entry, "complete", entry.expectedSize)
                entry.promise?.resolve(Arguments.createMap().apply {
                    putString("path", destFile.absolutePath)
                    putDouble("sizeBytes", entry.expectedSize.toDouble())
                })
                return
            }

            if (snapshot?.status == DownloadManager.STATUS_SUCCESSFUL) {
                try {
                    val verifiedSize = ModelArtifactVerifier.importAndPromote(
                        downloadedFile,
                        privatePartial,
                        destFile,
                        backupFile,
                        entry.expectedSize,
                        entry.expectedSha256,
                    )
                    commitTerminalTransition(id, entry, "complete", verifiedSize)
                    transitioned = true
                    runCatching { ModelArtifactVerifier.discardBackup(backupFile) }
                        .onFailure { Log.w(TAG, "Deferred committed backup cleanup until acknowledgement", it) }
                    safeEmitDownloadTerminal(id, entry, "complete", verifiedSize)
                    entry.promise?.resolve(Arguments.createMap().apply {
                        putString("path", destFile.absolutePath)
                        putDouble("sizeBytes", verifiedSize.toDouble())
                    })
                    Log.i(TAG, "Download verified and promoted: ${entry.filename} ($verifiedSize bytes)")
                } catch (error: Exception) {
                    if (!activeDownloads.containsKey(id)) throw error
                    Log.e(TAG, "Downloaded model failed integrity verification", error)
                    runCatching { ModelArtifactVerifier.restoreBackup(destFile, backupFile) }
                        .getOrElse { restoreError ->
                            Log.e(TAG, "Could not restore previous model after failed promotion", restoreError)
                            return
                        }
                    commitTerminalTransition(id, entry, "failed", 0L)
                    transitioned = true
                    safeEmitDownloadTerminal(id, entry, "failed", 0L)
                    entry.promise?.reject("DOWNLOAD_INTEGRITY_ERROR", error.message, error)
                }
            } else {
                dm.remove(id)
                downloadedFile.delete()
                runCatching { ModelArtifactVerifier.restoreBackup(destFile, backupFile) }
                    .getOrElse { restoreError ->
                        Log.e(TAG, "Could not restore previous model after download failure", restoreError)
                        return
                    }
                commitTerminalTransition(id, entry, "failed", 0L)
                transitioned = true
                safeEmitDownloadTerminal(id, entry, "failed", 0L)
                entry.promise?.reject("DOWNLOAD_FAILED", "Download failed or disappeared")
            }
        } catch (error: Throwable) {
            if (error is CancellationException) throw error
            // Keep the active record and Promise unsettled so polling/startup
            // reconciliation can retry a failed durable state transition.
            Log.e(TAG, "Could not durably finalize model download", error)
        } finally {
            processingDownloadIds.remove(id)
            if (transitioned && activeDownloads.isEmpty()) stopProgressPolling()
        }
        }
    }

    private fun emitDownloadTerminal(id: Long, entry: ActiveDownload, status: String, bytesDownloaded: Long) {
        sendEvent("onDownloadProgress", Arguments.createMap().apply {
            putDouble("downloadId", id.toDouble())
            putString("attemptId", entry.attemptId)
            putString("modelId", entry.modelId)
            putString("filename", entry.filename)
            putDouble("bytesDownloaded", bytesDownloaded.toDouble())
            putDouble("totalBytes", entry.expectedSize.toDouble())
            putDouble("percent", if (status == "complete") 100.0 else 0.0)
            putString("status", status)
        })
    }

    private fun safeEmitDownloadTerminal(id: Long, entry: ActiveDownload, status: String, bytesDownloaded: Long) {
        try {
            emitDownloadTerminal(id, entry, status, bytesDownloaded)
        } catch (error: Throwable) {
            Log.e(TAG, "Could not emit terminal download event", error)
        }
    }

    private fun commitTerminalTransition(
        id: Long,
        entry: ActiveDownload,
        status: String,
        bytesDownloaded: Long,
    ) = synchronized(downloadStateLock) {
        check(activeDownloads[id] === entry) { "Download state changed before terminal commit" }
        check(
            reactContext.getSharedPreferences(DOWNLOAD_PREFS, Context.MODE_PRIVATE)
                .getString(LAST_DOWNLOAD_RESULT_KEY, null) == null
        ) { "Previous terminal download result is not acknowledged" }

        check(activeDownloads.remove(id, entry)) { "Could not detach active download" }
        val activeRecords = serializeActiveDownloadsLocked()
        val terminalRecord = JSONObject().apply {
            put("downloadId", id)
            put("attemptId", entry.attemptId)
            put("modelId", entry.modelId)
            put("filename", entry.filename)
            put("bytesDownloaded", bytesDownloaded)
            put("totalBytes", entry.expectedSize)
            put("percent", if (status == "complete") 100.0 else 0.0)
            put("status", status)
            put("backupFilename", entry.backupFilename)
            put("expectedSha256", entry.expectedSha256)
        }
        val committed = reactContext.getSharedPreferences(DOWNLOAD_PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(DOWNLOADS_KEY, activeRecords.toString())
            .putString(LAST_DOWNLOAD_RESULT_KEY, terminalRecord.toString())
            .commit()
        if (!committed) {
            activeDownloads[id] = entry
            error("Could not atomically persist terminal download state")
        }
    }

    private suspend fun reconcileActiveDownloads(dm: DownloadManager) {
        for (id in activeDownloads.keys.toList()) {
            val snapshot = queryDownload(dm, id)
            if (snapshot == null || snapshot.status == DownloadManager.STATUS_SUCCESSFUL || snapshot.status == DownloadManager.STATUS_FAILED) {
                handleDownloadSnapshot(dm, id, snapshot)
            }
        }
    }

    private fun persistActiveDownloads() = synchronized(downloadStateLock) {
        persistActiveDownloadsLocked()
    }

    private fun persistActiveDownloadsLocked() {
        check(
            reactContext.getSharedPreferences(DOWNLOAD_PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(DOWNLOADS_KEY, serializeActiveDownloadsLocked().toString())
                .commit()
        ) { "Could not persist model download state" }
    }

    private fun serializeActiveDownloadsLocked(): JSONArray {
        val records = JSONArray()
        activeDownloads.forEach { (id, entry) ->
            records.put(JSONObject().apply {
                put("id", id)
                put("attemptId", entry.attemptId)
                put("modelId", entry.modelId)
                put("filename", entry.filename)
                put("expectedSize", entry.expectedSize)
                put("expectedSha256", entry.expectedSha256)
                put("partialFilename", entry.partialFilename)
                put("backupFilename", entry.backupFilename)
            })
        }
        return records
    }

    private fun readTerminalDownload(): WritableMap? = synchronized(downloadStateLock) {
        val prefs = reactContext.getSharedPreferences(DOWNLOAD_PREFS, Context.MODE_PRIVATE)
        val serialized = prefs.getString(LAST_DOWNLOAD_RESULT_KEY, null) ?: return@synchronized null
        val record = runCatching { JSONObject(serialized) }.getOrElse {
            check(prefs.edit().remove(LAST_DOWNLOAD_RESULT_KEY).commit())
            return@synchronized null
        }
        Arguments.createMap().apply {
            putDouble("downloadId", record.getLong("downloadId").toDouble())
            putString("attemptId", record.getString("attemptId"))
            putString("modelId", record.getString("modelId"))
            putString("filename", record.getString("filename"))
            putDouble("bytesDownloaded", record.getLong("bytesDownloaded").toDouble())
            putDouble("totalBytes", record.getLong("totalBytes").toDouble())
            putDouble("percent", record.getDouble("percent"))
            putString("status", record.getString("status"))
        }
    }

    private fun restoreActiveDownloads(dm: DownloadManager) {
        synchronized(downloadStateLock) {
            val serialized = reactContext.getSharedPreferences(DOWNLOAD_PREFS, Context.MODE_PRIVATE)
                .getString(DOWNLOADS_KEY, null) ?: return
            val records = runCatching { JSONArray(serialized) }.getOrElse {
                Log.e(TAG, "Discarding invalid persisted download state", it)
                JSONArray()
            }
            if (records.length() > 1) {
                val ids = (0 until records.length()).mapNotNull { index ->
                    runCatching { records.getJSONObject(index).getLong("id") }.getOrNull()
                }
                ids.forEach { dm.remove(it) }
                activeDownloads.clear()
                check(
                    reactContext.getSharedPreferences(DOWNLOAD_PREFS, Context.MODE_PRIVATE)
                        .edit().putString(DOWNLOADS_KEY, "[]").commit()
                ) { "Could not clear ambiguous persisted download state" }
                Log.e(TAG, "Cancelled ambiguous persisted model downloads: ${ids.size}")
                return
            }
            for (index in 0 until records.length()) {
                runCatching {
                    val record = records.getJSONObject(index)
                    val filename = record.getString("filename")
                    val partialFilename = record.getString("partialFilename")
                    val backupFilename = record.getString("backupFilename")
                    val hash = record.getString("expectedSha256").lowercase()
                    requireModelFilename(filename)
                    require(partialFilename.matches(Regex("^[A-Za-z0-9._-]+\\.litertlm\\.[0-9a-fA-F-]+\\.tmp$")))
                    require(backupFilename.matches(Regex("^[A-Za-z0-9._-]+\\.litertlm\\.[0-9a-fA-F-]+\\.backup$")))
                    require(hash.matches(Regex("^[0-9a-f]{64}$")))
                    activeDownloads[record.getLong("id")] = ActiveDownload(
                        record.getString("attemptId"),
                        record.getString("modelId"),
                        filename,
                        record.getLong("expectedSize"),
                        hash,
                        partialFilename,
                        backupFilename,
                        null,
                    )
                }.onFailure { Log.e(TAG, "Ignoring invalid persisted download record", it) }
            }
            persistActiveDownloadsLocked()
        }
    }

    private fun cancelUntrackedModelDownloads(dm: DownloadManager) {
        val trackedIds = activeDownloads.keys.toSet()
        val modelDir = getDownloadStagingDir().canonicalFile
        val orphanIds = mutableListOf<Long>()
        val orphanFiles = mutableListOf<File>()
        dm.query(DownloadManager.Query())?.use { cursor ->
            val idColumn = cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_ID)
            val uriColumn = cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI)
            val titleColumn = cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TITLE)
            val descriptionColumn = cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_DESCRIPTION)
            while (cursor.moveToNext()) {
                val id = cursor.getLong(idColumn)
                if (id in trackedIds) continue
                val path = if (cursor.isNull(uriColumn)) null else runCatching {
                    Uri.parse(cursor.getString(uriColumn)).path
                }.getOrNull()
                val candidate = path?.let { File(it).canonicalFile }
                val ownedByPath = candidate?.parentFile == modelDir && candidate.name.matches(MODEL_PARTIAL_PATTERN)
                val title = if (cursor.isNull(titleColumn)) "" else cursor.getString(titleColumn)
                val description = if (cursor.isNull(descriptionColumn)) "" else cursor.getString(descriptionColumn)
                val ownedPendingRow = title.startsWith("AlbionMarket AI: ") &&
                    description.matches(MODEL_FILENAME_PATTERN)
                if (ownedByPath || ownedPendingRow) {
                    orphanIds += id
                    candidate?.let { orphanFiles += it }
                }
            }
        }
        orphanIds.forEach { dm.remove(it) }
        orphanFiles.forEach { it.delete() }
        if (orphanIds.isNotEmpty()) Log.w(TAG, "Cancelled ${orphanIds.size} untracked model download(s)")
    }

    private suspend fun cleanupCommittedBackup() {
        val record = synchronized(downloadStateLock) {
            val serialized = reactContext.getSharedPreferences(DOWNLOAD_PREFS, Context.MODE_PRIVATE)
                .getString(LAST_DOWNLOAD_RESULT_KEY, null) ?: return
            runCatching { JSONObject(serialized) }.getOrNull() ?: return
        }
        val status = record.optString("status")
        if (status != "complete" && status != "failed") return
        val filename = record.optString("filename")
        val backupFilename = record.optString("backupFilename")
        val hash = record.optString("expectedSha256").lowercase()
        val expectedSize = record.optLong("totalBytes", -1L)
        val metadataValid = filename.matches(MODEL_FILENAME_PATTERN) &&
            backupFilename.matches(Regex("^[A-Za-z0-9][A-Za-z0-9._-]*\\.litertlm\\.[0-9a-fA-F-]+\\.backup$")) &&
            hash.matches(Regex("^[0-9a-f]{64}$")) && expectedSize > 0L
        if (!metadataValid) {
            record.put("status", "failed")
            record.put("bytesDownloaded", 0L)
            record.put("percent", 0.0)
            synchronized(downloadStateLock) {
                check(
                    reactContext.getSharedPreferences(DOWNLOAD_PREFS, Context.MODE_PRIVATE)
                        .edit().putString(LAST_DOWNLOAD_RESULT_KEY, record.toString()).commit()
                ) { "Could not persist invalid terminal model recovery" }
            }
            return
        }

        artifactMutex(filename).withLock {
            val finalFile = confinedModelFile(filename)
            val backupFile = confinedPrivateFile(backupFilename)
            if (status == "failed") {
                if (backupFile.exists()) ModelArtifactVerifier.restoreBackup(finalFile, backupFile)
                return@withLock
            }
            if (ModelArtifactVerifier.isVerified(finalFile, expectedSize, hash)) {
                ModelArtifactVerifier.discardBackup(backupFile)
                return@withLock
            }

            record.put("status", "failed")
            record.put("bytesDownloaded", 0L)
            record.put("percent", 0.0)
            synchronized(downloadStateLock) {
                check(
                    reactContext.getSharedPreferences(DOWNLOAD_PREFS, Context.MODE_PRIVATE)
                        .edit().putString(LAST_DOWNLOAD_RESULT_KEY, record.toString()).commit()
                ) { "Could not persist failed startup model recovery" }
            }
            if (backupFile.exists()) {
                ModelArtifactVerifier.restoreBackup(finalFile, backupFile)
            } else if (finalFile.exists()) {
                check(finalFile.delete()) { "Could not remove invalid completed model" }
            }
        }
    }

    private fun stopProgressPolling() { progressPollingJob?.cancel(); progressPollingJob = null }

    // ─── Engine Lifecycle ────────────────────────────────────────

    @ReactMethod
    fun initialize(modelFilename: String, systemPrompt: String, serverBaseUrl: String, supportsVision: Boolean, supportsTools: Boolean, promise: Promise) {
        if (runtimeTeardownRequested.get()) {
            safeRejectPromise(promise, "INIT_ERROR", "Runtime teardown is in progress")
            return
        }
        val initializationGeneration = runtimeTeardownGeneration.get()
        scope.launch {
            lifecycleMutex.withLock {
                var newEngine: Engine? = null
                var newConversation: Conversation? = null
                var committed = false
                var abandonCandidateRuntime = false
                try {
                    check(!runtimeTeardownRequested.get() && runtimeTeardownGeneration.get() == initializationGeneration) {
                        "Initialization was superseded by runtime teardown"
                    }
                    val modelFile = findModelFile(modelFilename)
                    if (modelFile == null) {
                        promise.reject("MODEL_NOT_FOUND", "Model not found: $modelFilename")
                        return@withLock
                    }

                    val isMediaTek = isMediaTekChipset()
                if (isMediaTek) Log.i(TAG, "MediaTek chipset detected: ${getChipsetInfo()}")

                // Determine whether a GPU backend can be instantiated at all
                val gpuBackend: Backend? = try {
                    Backend.GPU()
                } catch (e: Exception) {
                    Log.w(TAG, "GPU backend constructor failed (chipset=${getChipsetInfo()}), will use CPU: ${e.message}")
                    null
                }
                var newBackendUsed = if (gpuBackend != null) "gpu" else "cpu"
                var newHasVision = false

                // Tier 1 — GPU + vision, only for models that ship a vision encoder.
                // Text-only models (e.g. DeepSeek R1) must not receive a vision
                // backend: LiteRT-LM can defer the missing-encoder failure until
                // createConversation(), producing NOT_FOUND: TF_LITE_VISION_ENCODER.
                if (supportsVision && gpuBackend != null) {
                    try {
                        val config = EngineConfig(
                            modelPath = modelFile.absolutePath,
                            backend = gpuBackend,
                            visionBackend = if (supportsVision) gpuBackend else null,
                            cacheDir = reactContext.cacheDir.path
                        )
                        newEngine = boundedNativeCall("engine initialization", cleanupLateResult = { late -> runCatching { late.close() } }) {
                            createInitializedEngine(config)
                        }
                        newHasVision = true
                        Log.i(TAG, "Engine initialized WITH vision (GPU)")
                    } catch (timeout: NativeCallTimeoutException) {
                        throw timeout
                    } catch (e: Exception) {
                        Log.w(TAG, "GPU+vision init failed: ${e.message}")
                        newEngine = null
                    }
                }

                // Tier 2 — GPU text-only
                if (newEngine == null && gpuBackend != null) {
                    try {
                        val config = EngineConfig(
                            modelPath = modelFile.absolutePath,
                            backend = gpuBackend,
                            cacheDir = reactContext.cacheDir.path
                        )
                        newEngine = boundedNativeCall("engine initialization", cleanupLateResult = { late -> runCatching { late.close() } }) {
                            createInitializedEngine(config)
                        }
                        newHasVision = false
                        Log.i(TAG, "Engine initialized text-only (GPU)")
                    } catch (timeout: NativeCallTimeoutException) {
                        throw timeout
                    } catch (e: Exception) {
                        Log.w(TAG, "GPU text-only init failed: ${e.message}")
                        newEngine = null
                        newBackendUsed = "cpu"
                    }
                }

                // Tier 3 — CPU text-only (last resort, works on all devices)
                if (newEngine == null) {
                    newBackendUsed = "cpu"
                    try {
                        val config = EngineConfig(
                            modelPath = modelFile.absolutePath,
                            backend = Backend.CPU(),
                            cacheDir = reactContext.cacheDir.path
                        )
                        newEngine = boundedNativeCall("engine initialization", cleanupLateResult = { late -> runCatching { late.close() } }) {
                            createInitializedEngine(config)
                        }
                        newHasVision = false
                        Log.i(TAG, "Engine initialized text-only (CPU fallback)")
                    } catch (timeout: NativeCallTimeoutException) {
                        throw timeout
                    } catch (e: Exception) {
                        Log.e(TAG, "CPU fallback init also failed: ${e.message}")
                        throw Exception(
                            "Failed to start the AI engine on this device. " +
                            "Your chipset (${getChipsetInfo()}) may not be fully supported by LiteRT yet. " +
                            "Try a smaller model or check for an app update.\n\nDetails: ${e.message}"
                        )
                    }
                }

                // LiteRT-LM 0.16.1 attempts to resolve a vision encoder when
                // tool providers are attached to text-only model conversations.
                // Market context is already fetched and injected by JS, so keep
                // tools for the explicitly multimodal path only.
                val toolList = if (supportsTools) {
                    AlbionTools(serverBaseUrl, reactContext).allTools().map { tool(it) }
                } else {
                    emptyList()
                }
                val convConfig = ConversationConfig(
                    systemInstruction = Contents.of(systemPrompt),
                    samplerConfig = SamplerConfig(topK = 20, topP = 0.9, temperature = 0.3),
                    tools = toolList,
                )
                try {
                    val candidateEngine = checkNotNull(newEngine)
                    val candidateRuntime = boundedNativeCall(
                        "conversation creation",
                        cleanupLateResult = { late -> closeRuntimeDirect(late.conversation, late.engine) },
                    ) {
                        CandidateRuntime(candidateEngine, candidateEngine.createConversation(convConfig))
                    }
                    newConversation = candidateRuntime.conversation
                } catch (timeout: NativeCallTimeoutException) {
                    throw timeout
                } catch (visionError: Exception) {
                    if (!newHasVision) throw visionError
                    // Some .litertlm packages advertise multimodal metadata but do
                    // not ship TF_LITE_VISION_ENCODER. Keep text chat usable and
                    // explicitly disable image capability instead of failing here.
                    Log.w(TAG, "Vision conversation unavailable; retrying text-only: ${visionError.message}")
                    val visionEngine = checkNotNull(newEngine)
                    boundedNativeCall("engine close") { visionEngine.close() }
                    val fallbackBackend = gpuBackend ?: Backend.CPU()
                    val fallbackConfig = EngineConfig(
                        modelPath = modelFile.absolutePath,
                        backend = fallbackBackend,
                        cacheDir = reactContext.cacheDir.path
                    )
                    val fallbackEngine = boundedNativeCall("engine initialization", cleanupLateResult = { late -> runCatching { late.close() } }) {
                        createInitializedEngine(fallbackConfig)
                    }
                    newEngine = fallbackEngine
                    newHasVision = false
                    val fallbackRuntime = boundedNativeCall(
                        "conversation creation",
                        cleanupLateResult = { late -> closeRuntimeDirect(late.conversation, late.engine) },
                    ) {
                        CandidateRuntime(fallbackEngine, fallbackEngine.createConversation(convConfig))
                    }
                    newConversation = fallbackRuntime.conversation
                }

                val readyEngine = checkNotNull(newEngine)
                checkNotNull(newConversation)
                withTimeout(LIFECYCLE_WAIT_TIMEOUT_MS) {
                    conversationMutex.withLock {
                        check(!runtimeTeardownRequested.get() && runtimeTeardownGeneration.get() == initializationGeneration) {
                            "Initialization was superseded before publication"
                        }
                        val oldEngine = engine
                        val oldConversation = conversation
                        engine = readyEngine
                        conversation = newConversation
                        currentModelId = modelFile.nameWithoutExtension
                        currentServerBaseUrl = serverBaseUrl
                        currentSupportsTools = supportsTools
                        hasVision = newHasVision
                        backendUsed = newBackendUsed
                        if (runtimeTeardownGeneration.get() == initializationGeneration) {
                            runtimeTeardownRequested.set(false)
                        }
                        committed = true

                        runCatching { closeRuntimeBounded(oldConversation, oldEngine, "replaced runtime close") }
                            .onFailure { Log.w(TAG, "Failed to close replaced runtime", it) }
                    }
                }

                promise.resolve(Arguments.createMap().apply {
                    putBoolean("success", true)
                    putBoolean("hasVision", hasVision)
                    putString("backendUsed", backendUsed)
                    putBoolean("isMediaTek", isMediaTek)
                    putString("chipset", getChipsetInfo())
                })
                Log.i(TAG, "Engine ready: ${modelFile.name}, vision=$hasVision, tools=${toolList.size}")
            } catch (timeout: TimeoutCancellationException) {
                if (!committed) {
                    runCatching { closeRuntimeBounded(newConversation, newEngine, "lifecycle-timeout runtime close") }
                        .onFailure { Log.w(TAG, "Failed to close lifecycle-timeout runtime", it) }
                }
                promise.reject("INIT_ERROR", timeout.message, timeout)
            } catch (e: Throwable) {
                if (e is CancellationException) throw e
                if (e is NativeCallTimeoutException) abandonCandidateRuntime = true
                if (!committed && !abandonCandidateRuntime) {
                    runCatching { closeRuntimeBounded(newConversation, newEngine, "rejected runtime close") }
                        .onFailure { Log.w(TAG, "Failed to close rejected runtime", it) }
                }
                Log.e(TAG, "Failed to initialize engine", e)
                promise.reject("INIT_ERROR", e.message, e)
            }
          }
        }
    }

    @ReactMethod
    fun sendMessage(userMessage: String, requestId: String, promise: Promise) {
        launchInference(requestId, promise) { conv, callback ->
            conv.sendMessageAsync(userMessage, callback)
        }
    }

    @ReactMethod
    fun sendMessageWithImage(userMessage: String, imagePath: String, requestId: String, promise: Promise) {
        launchInference(requestId, promise, requireVision = true) { conv, callback ->
            val imageFile = File(imagePath)
            require(imageFile.isFile) { "Image not found: $imagePath" }
            val content = Contents.of(Content.ImageFile(imagePath), Content.Text(userMessage))
            conv.sendMessageAsync(content, callback)
        }
    }

    /** Cancel only the currently active inference request. A stale JS cleanup
     * must never interrupt a newer request that reused the conversation. */
    @ReactMethod
    fun cancelMessage(requestId: String, promise: Promise) {
        var queuedCancellation = false
        val binding = synchronized(inferenceAdmissionLock) {
            val current = activeInference.get()
            when {
                current?.requestId == requestId -> current.apply { cancellationRequested.set(true) }
                scheduledInferenceIds.contains(requestId) -> {
                    cancelledInferenceIds.add(requestId)
                    queuedCancellation = true
                    null
                }
                else -> null
            }
        }
        if (binding == null) {
            promise.resolve(queuedCancellation)
            return
        }
        if (!binding.nativeStarted.get()) {
            promise.resolve(true)
            return
        }
        scope.launch {
            val error = cancelRegisteredInference(binding)
            if (error == null) {
                promise.resolve(true)
            } else {
                conversationMutex.withLock { quarantineConversation(binding.conversation) }
                promise.reject("CANCEL_ERROR", error.message, error)
            }
        }
    }

    @ReactMethod
    fun resetConversation(systemPrompt: String, serverBaseUrl: String, promise: Promise) {
        scope.launch {
            lifecycleMutex.withLock {
                var timedOutEngine: Engine? = null
                try {
                    withTimeout(LIFECYCLE_WAIT_TIMEOUT_MS) {
                        conversationMutex.withLock {
                            val eng = engine ?: throw IllegalStateException("Engine not initialized.")
                            timedOutEngine = eng
                            val resetServerBaseUrl = serverBaseUrl.also {
                                require(it in setOf(
                                    "https://west.albion-online-data.com/api/v2/stats",
                                    "https://europe.albion-online-data.com/api/v2/stats",
                                    "https://east.albion-online-data.com/api/v2/stats",
                                )) { "Unsupported Albion server" }
                            }
                            val resetTools = if (currentSupportsTools) {
                                AlbionTools(resetServerBaseUrl, reactContext).allTools().map { apiTool -> tool(apiTool) }
                            } else {
                                emptyList()
                            }
                            val convConfig = ConversationConfig(
                                systemInstruction = Contents.of(systemPrompt),
                                samplerConfig = SamplerConfig(topK = 20, topP = 0.9, temperature = 0.3),
                                tools = resetTools,
                            )
                            val oldConversation = conversation
                            val candidateConversation = boundedNativeCall(
                                "conversation creation",
                                cleanupLateResult = { late ->
                                    try {
                                        late.close()
                                    } finally {
                                        closeRuntimeDirect(oldConversation, eng)
                                    }
                                },
                                cleanupLateFailure = { closeRuntimeDirect(oldConversation, eng) },
                            ) { eng.createConversation(convConfig) }
                            oldConversation?.let { previous ->
                                boundedNativeCall(
                                    "reset old conversation close",
                                    cleanupLateResult = { closeRuntimeDirect(candidateConversation, eng) },
                                    cleanupLateFailure = { closeRuntimeDirect(candidateConversation, eng) },
                                ) { previous.close() }
                            }
                            conversation = candidateConversation
                            currentServerBaseUrl = resetServerBaseUrl
                        }
                    }
                    promise.resolve(true)
                } catch (timeout: NativeCallTimeoutException) {
                    conversationMutex.withLock {
                        if (engine === timedOutEngine) {
                            engine = null
                            conversation = null
                            currentModelId = null
                            hasVision = false
                            activeInference.getAndSet(null)?.completion?.complete(Unit)
                        }
                    }
                    promise.reject("RESET_ERROR", timeout.message, timeout)
                } catch (timeout: TimeoutCancellationException) {
                    promise.reject("RESET_ERROR", timeout.message, timeout)
                } catch (e: Throwable) {
                    if (e is CancellationException) throw e
                    promise.reject("RESET_ERROR", e.message, e)
                }
            }
        }
    }

    @ReactMethod
    fun destroy(promise: Promise) {
        runtimeTeardownGeneration.incrementAndGet()
        runtimeTeardownRequested.set(true)
        scope.launch {
            lifecycleMutex.withLock {
                try {
                    val cancellationError = requestLifecycleInferenceCancellation()
                    if (cancellationError != null) {
                        quarantineRuntimeUnsafe()
                        throw IllegalStateException("Could not cancel active inference during destroy", cancellationError)
                    }
                    withTimeout(LIFECYCLE_WAIT_TIMEOUT_MS * 2L) {
                        conversationMutex.withLock {
                            val oldConversation = conversation
                            val oldEngine = engine
                            quarantineRuntimeUnsafe()
                            closeRuntimeBounded(oldConversation, oldEngine, "destroy runtime close")
                        }
                    }
                    runtimeTeardownRequested.set(false)
                    promise.resolve(true)
                } catch (error: Throwable) {
                    quarantineRuntimeUnsafe()
                    if (error is CancellationException && error !is TimeoutCancellationException) throw error
                    promise.reject("DESTROY_ERROR", error.message, error)
                }
            }
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────

    private fun createInitializedEngine(config: EngineConfig): Engine {
        val candidate = Engine(config)
        try {
            candidate.initialize()
            return candidate
        } catch (error: Throwable) {
            runCatching { candidate.close() }
            throw error
        }
    }

    private fun closeRuntimeDirect(targetConversation: Conversation?, targetEngine: Engine?) {
        var failure: Throwable? = null
        try {
            targetConversation?.close()
        } catch (error: Throwable) {
            failure = error
        }
        try {
            targetEngine?.close()
        } catch (error: Throwable) {
            failure?.addSuppressed(error) ?: run { failure = error }
        }
        failure?.let { throw it }
    }

    private suspend fun closeRuntimeBounded(
        targetConversation: Conversation?,
        targetEngine: Engine?,
        label: String,
    ) {
        if (targetConversation == null && targetEngine == null) return
        boundedNativeCall(label) { closeRuntimeDirect(targetConversation, targetEngine) }
    }

    private suspend fun <T> boundedNativeCall(
        label: String,
        timeoutMs: Long = LIFECYCLE_WAIT_TIMEOUT_MS,
        cleanupLateResult: (T) -> Unit = {},
        cleanupLateFailure: (Throwable) -> Unit = {},
        operation: () -> T,
    ): T {
        // 0 = waiting, 1 = result published, 2 = caller timed out.
        val ownership = AtomicInteger(0)
        val outcome = AtomicReference<NativeOutcome<T>?>(null)
        val task = nativeExecutor.submit<T> {
            try {
                val result = operation()
                outcome.set(NativeOutcome(value = result))
                if (!ownership.compareAndSet(0, 1)) {
                    runCatching { cleanupLateResult(result) }
                        .onFailure { Log.w(TAG, "Late native cleanup failed for $label", it) }
                    throw java.util.concurrent.CancellationException("Late native result for $label")
                }
                result
            } catch (error: Throwable) {
                if (outcome.get() == null) {
                    outcome.set(NativeOutcome(error = error))
                    if (!ownership.compareAndSet(0, 1)) {
                        runCatching { cleanupLateFailure(error) }
                            .onFailure { Log.w(TAG, "Late native failure cleanup failed for $label", it) }
                    }
                }
                throw error
            }
        }
        return try {
            task.get(timeoutMs, TimeUnit.MILLISECONDS)
        } catch (timeout: TimeoutException) {
            if (ownership.compareAndSet(0, 2)) {
                task.cancel(true)
                throw NativeCallTimeoutException("$label timed out after ${timeoutMs}ms", timeout)
            }
            val delivered = checkNotNull(outcome.get()) { "$label completed without publishing an outcome" }
            delivered.error?.let { throw it }
            @Suppress("UNCHECKED_CAST")
            delivered.value as T
        } catch (execution: ExecutionException) {
            throw (execution.cause ?: execution)
        } catch (interrupted: InterruptedException) {
            ownership.compareAndSet(0, 2)
            task.cancel(true)
            Thread.currentThread().interrupt()
            throw interrupted
        }
    }

    private fun requireExpectedSize(value: Double): Long {
        require(value.isFinite() && value > 0.0 && value % 1.0 == 0.0 && value <= Long.MAX_VALUE.toDouble()) {
            "Expected model size must be a positive integer"
        }
        return value.toLong()
    }

    private fun requireDownloadId(value: Double): Long {
        require(value.isFinite() && value >= 0.0 && value % 1.0 == 0.0 && value <= Long.MAX_VALUE.toDouble()) {
            "Download ID must be a non-negative integer"
        }
        return value.toLong()
    }

    private suspend fun cancelRegisteredInference(binding: ActiveInference): Throwable? {
        if (binding.cancellationIssued.compareAndSet(false, true)) {
            val error = try {
                boundedNativeCall(
                    "inference cancellation",
                    cleanupLateResult = {
                        try { closeInferenceRuntimeOnce(binding) }
                        finally { settleLateInferenceCleanup(binding) }
                    },
                    cleanupLateFailure = {
                        try { closeInferenceRuntimeOnce(binding) }
                        finally { settleLateInferenceCleanup(binding) }
                    },
                ) { binding.conversation.cancelProcess() }
                null
            } catch (failure: Throwable) {
                if (failure is NativeCallTimeoutException) binding.cancellationTimedOut.set(true)
                failure
            }
            binding.completion.complete(Unit)
            binding.cancellationResult.complete(error)
        }
        return binding.cancellationResult.await()
    }

    private fun closeInferenceRuntimeOnce(binding: ActiveInference) {
        if (!binding.runtimeCleanupIssued.compareAndSet(false, true)) return
        try {
            closeRuntimeDirect(binding.conversation, binding.engine)
        } finally {
            binding.runtimeCleanupSettlement.complete(Unit)
        }
    }

    private fun settleLateInferenceCleanup(binding: ActiveInference) {
        binding.completion.complete(Unit)
        synchronized(inferenceAdmissionLock) {
            activeInference.compareAndSet(binding, null)
            scheduledInferenceIds.remove(binding.requestId)
            cancelledInferenceIds.remove(binding.requestId)
        }
        binding.terminalSettlement.complete(Unit)
    }

    private suspend fun requestLifecycleInferenceCancellation(): Throwable? {
        val binding = synchronized(inferenceAdmissionLock) {
            activeInference.get()?.apply { cancellationRequested.set(true) }
                ?: run {
                    scheduledInferenceIds.forEach(cancelledInferenceIds::add)
                    null
                }
        }
        if (binding == null) return null
        if (binding.nativeStarted.get()) cancelRegisteredInference(binding)
        withTimeout(LIFECYCLE_WAIT_TIMEOUT_MS * 2L) { binding.terminalSettlement.await() }
        return if (binding.cancellationResult.isCompleted) binding.cancellationResult.await() else null
    }

    private fun quarantineRuntimeUnsafe() {
        activeInference.getAndSet(null)?.completion?.complete(Unit)
        conversation = null
        engine = null
        currentModelId = null
        currentServerBaseUrl = null
        currentSupportsTools = false
        hasVision = false
    }

    /** Caller must hold conversationMutex. */
    private fun quarantineConversation(target: Conversation) {
        if (conversation === target) {
            conversation = null
            engine = null
            currentModelId = null
            hasVision = false
        }
    }

    private fun launchInference(
        requestId: String,
        promise: Promise,
        requireVision: Boolean = false,
        start: (Conversation, MessageCallback) -> Unit,
    ) {
        if (runtimeTeardownRequested.get()) {
            safeRejectPromise(promise, "SEND_ERROR", "Runtime teardown is in progress")
            return
        }
        if (!scheduledInferenceIds.add(requestId)) {
            safeRejectPromise(promise, "SEND_ERROR", "Inference request ID is already scheduled")
            return
        }
        scope.launch {
            conversationMutex.withLock {
                var accepted = false
                var requestBinding: ActiveInference? = null
                try {
                    val conv = conversation ?: throw IllegalStateException("Engine not initialized.")
                    val inferenceEngine = engine ?: throw IllegalStateException("Engine not initialized.")
                    if (requireVision && !hasVision) {
                        throw IllegalStateException("This model does not support images. Use a multimodal model (Qwen3.5).")
                    }
                    val binding = ActiveInference(requestId, conv, inferenceEngine, CompletableDeferred())
                    val cancelledBeforeStart = synchronized(inferenceAdmissionLock) {
                        if (runtimeTeardownRequested.get() || cancelledInferenceIds.remove(requestId)) {
                            scheduledInferenceIds.remove(requestId)
                            true
                        } else {
                            check(activeInference.compareAndSet(null, binding)) { "Another inference request is already active" }
                            false
                        }
                    }
                    if (cancelledBeforeStart) {
                        safeRejectPromise(promise, "SEND_CANCELLED", "Inference cancelled before native start")
                        return@withLock
                    }
                    requestBinding = binding
                    val callback = createStreamCallback(binding) { binding.completion.complete(Unit) }
                    boundedNativeCall(
                        "inference start",
                        cleanupLateResult = {
                            try {
                                runCatching { conv.cancelProcess() }
                            } finally {
                                closeInferenceRuntimeOnce(binding)
                                binding.nativeStartSettlement.complete(Unit)
                                settleLateInferenceCleanup(binding)
                            }
                        },
                        cleanupLateFailure = {
                            try {
                                closeInferenceRuntimeOnce(binding)
                            } finally {
                                binding.nativeStartSettlement.complete(Unit)
                                settleLateInferenceCleanup(binding)
                            }
                        },
                    ) { start(conv, callback) }
                    binding.nativeStarted.set(true)
                    binding.nativeStartSettlement.complete(Unit)
                    if (binding.cancellationRequested.get()) {
                        val cancellationError = cancelRegisteredInference(binding)
                        if (cancellationError != null) {
                            quarantineConversation(binding.conversation)
                            Log.e(TAG, "Could not cancel inference after native registration; runtime quarantined", cancellationError)
                        }
                        safeRejectPromise(promise, "SEND_CANCELLED", "Inference cancelled during native start", cancellationError)
                        return@withLock
                    }
                    accepted = true
                    promise.resolve(true)
                    withTimeout(CONVERSATION_TIMEOUT_MS) { binding.completion.await() }
                } catch (timeout: TimeoutCancellationException) {
                    requestBinding?.let { binding ->
                        binding.cancellationRequested.set(true)
                        val cancelError = cancelRegisteredInference(binding)
                        if (cancelError != null) {
                            quarantineConversation(binding.conversation)
                            Log.e(TAG, "Could not cancel timed-out inference; runtime quarantined", cancelError)
                        }
                        safeSendEvent("onLiteRTError", Arguments.createMap().apply {
                            putString("requestId", requestId)
                            putString("error", "Native inference timed out")
                        })
                    }
                } catch (error: Throwable) {
                    if (error is CancellationException) throw error
                    if (accepted) {
                        requestBinding?.let { binding ->
                            binding.cancellationRequested.set(true)
                            val cancelError = cancelRegisteredInference(binding)
                            if (cancelError != null) {
                                quarantineConversation(binding.conversation)
                                Log.e(TAG, "Could not cancel failed inference settlement; runtime quarantined", cancelError)
                            }
                        }
                    }
                    if (error is NativeCallTimeoutException && conversation === requestBinding?.conversation) {
                        requestBinding?.nativeStartTimedOut?.set(true)
                        conversation = null
                        engine = null
                        currentModelId = null
                        hasVision = false
                    }
                    Log.e(TAG, "Inference failed", error)
                    if (accepted) {
                        safeSendEvent("onLiteRTError", Arguments.createMap().apply {
                            putString("requestId", requestId)
                            putString("error", error.message ?: "Unknown inference error")
                        })
                    } else {
                        safeRejectPromise(promise, "SEND_ERROR", error.message ?: "Inference failed", error)
                    }
                } finally {
                    val binding = requestBinding
                    if (binding == null) {
                        synchronized(inferenceAdmissionLock) {
                            scheduledInferenceIds.remove(requestId)
                            cancelledInferenceIds.remove(requestId)
                        }
                    } else {
                        val needsCancellation = synchronized(inferenceAdmissionLock) {
                            val requested = binding.cancellationRequested.get()
                            if (!requested && !binding.nativeStartTimedOut.get()) {
                                activeInference.compareAndSet(binding, null)
                                scheduledInferenceIds.remove(requestId)
                                cancelledInferenceIds.remove(requestId)
                            }
                            requested
                        }
                        if (needsCancellation && !binding.nativeStartTimedOut.get()) {
                            val cancellationError = cancelRegisteredInference(binding)
                            if (cancellationError != null) {
                                quarantineConversation(binding.conversation)
                                Log.e(TAG, "Could not settle requested inference cancellation; runtime quarantined", cancellationError)
                            }
                            if (!binding.cancellationTimedOut.get()) {
                                synchronized(inferenceAdmissionLock) {
                                    activeInference.compareAndSet(binding, null)
                                    scheduledInferenceIds.remove(requestId)
                                    cancelledInferenceIds.remove(requestId)
                                }
                            }
                        }
                        binding.completion.complete(Unit)
                        if (!binding.nativeStartTimedOut.get() && !binding.cancellationTimedOut.get()) {
                            binding.terminalSettlement.complete(Unit)
                        }
                    }
                }
            }
        }
    }

    private fun createStreamCallback(binding: ActiveInference, onFinished: () -> Unit = {}) = object : MessageCallback {
        private val finished = AtomicBoolean(false)
        private fun finishOnce(): Boolean {
            if (finished.compareAndSet(false, true)) {
                val wasActive = activeInference.compareAndSet(binding, null)
                return try {
                    wasActive
                } finally {
                    onFinished()
                }
            }
            return false
        }
        override fun onMessage(message: Message) {
            if (activeInference.get() !== binding) return
            safeSendEvent("onLiteRTToken", Arguments.createMap().apply {
                putString("requestId", binding.requestId); putString("token", message.toString())
            })
        }
        override fun onDone() {
            if (finishOnce()) {
                safeSendEvent("onLiteRTDone", Arguments.createMap().apply { putString("requestId", binding.requestId) })
            }
        }
        override fun onError(throwable: Throwable) {
            if (finishOnce()) {
                safeSendEvent("onLiteRTError", Arguments.createMap().apply {
                    putString("requestId", binding.requestId); putString("error", throwable.message ?: "Unknown error")
                })
            }
        }
    }

    private fun getModelDir(): File = File(reactContext.filesDir, "litert-models").also {
        if (!it.exists()) check(it.mkdirs()) { "Could not create private model directory" }
    }

    private fun getDownloadStagingDir(): File {
        val directory = reactContext.getExternalFilesDir("litert-models")
            ?: error("External download staging is unavailable")
        if (!directory.exists()) check(directory.mkdirs()) { "Could not create download staging directory" }
        return directory
    }

    private fun getAllModelDirs(): List<File> = listOf(getModelDir())

    private fun requireModelFilename(filename: String): String {
        require(filename.matches(MODEL_FILENAME_PATTERN)) { "Invalid model filename" }
        require(File(filename).name == filename) { "Model filename must be a basename" }
        return filename
    }

    private fun confinedPrivateFile(basename: String): File {
        require(File(basename).name == basename && basename != "." && basename != "..") {
            "Private artifact path must be a basename"
        }
        val directory = getModelDir().canonicalFile
        val candidate = File(directory, basename).canonicalFile
        require(candidate.parentFile == directory && candidate.name == basename) {
            "Private artifact escapes model directory"
        }
        return candidate
    }

    private fun confinedModelFile(filename: String): File =
        confinedPrivateFile(requireModelFilename(filename))

    private fun artifactMutex(filename: String): Mutex =
        artifactMutexes.getOrPut(requireModelFilename(filename)) { Mutex() }

    private fun findModelFile(filename: String): File? {
        requireModelFilename(filename)
        val file = confinedModelFile(filename)
        return file.takeIf { it.isFile }
    }

    private suspend fun migrateLegacyModelIfPresent(
        filename: String,
        expectedSize: Long,
        expectedSha256: String,
    ) {
        val basename = requireModelFilename(filename)
        artifactMutex(basename).withLock {
            val finalFile = confinedModelFile(basename)
            val stagingDir = getDownloadStagingDir().canonicalFile
            val legacyFile = File(stagingDir, basename).canonicalFile
            require(legacyFile.parentFile == stagingDir && legacyFile.name == basename) {
                "Legacy model escapes staging directory"
            }
            val stalePartials = getModelDir().listFiles().orEmpty().filter {
                it.name.startsWith("$basename.") && it.name.endsWith(".legacy.tmp")
            }
            stalePartials.forEach { check(it.delete()) { "Could not remove stale legacy migration partial" } }
            val staleBackups = getModelDir().listFiles().orEmpty().filter {
                it.name.startsWith("$basename.") && it.name.endsWith(".legacy.backup")
            }
            if (!ModelArtifactVerifier.isVerified(finalFile, expectedSize, expectedSha256)) {
                val verifiedBackup = staleBackups.firstOrNull {
                    ModelArtifactVerifier.isVerified(it, expectedSize, expectedSha256)
                }
                if (verifiedBackup != null) {
                    ModelArtifactVerifier.restoreBackup(finalFile, verifiedBackup)
                }
            }
            staleBackups.forEach { backup ->
                if (backup.exists()) ModelArtifactVerifier.discardBackup(backup)
            }
            if (ModelArtifactVerifier.isVerified(finalFile, expectedSize, expectedSha256)) {
                if (legacyFile.exists()) check(legacyFile.delete()) { "Could not delete redundant legacy model" }
                return@withLock
            }
            if (!legacyFile.isFile) return@withLock
            if (!ModelArtifactVerifier.isVerified(legacyFile, expectedSize, expectedSha256)) {
                check(legacyFile.delete()) { "Could not delete invalid legacy model" }
                return@withLock
            }
            if (StatFs(getModelDir().path).availableBytes < expectedSize) {
                Log.w(TAG, "Not enough private space to migrate legacy model $basename")
                return@withLock
            }
            if (finalFile.exists()) check(finalFile.delete()) { "Could not remove invalid private model before migration" }
            val migrationId = UUID.randomUUID().toString()
            val privatePartial = confinedPrivateFile("$basename.$migrationId.legacy.tmp")
            val backupFile = confinedPrivateFile("$basename.$migrationId.legacy.backup")
            ModelArtifactVerifier.importAndPromote(
                legacyFile,
                privatePartial,
                finalFile,
                backupFile,
                expectedSize,
                expectedSha256,
                deleteSourceOnFailure = false,
            )
            ModelArtifactVerifier.discardBackup(backupFile)
        }
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(eventName, params)
    }

    private fun safeSendEvent(eventName: String, params: WritableMap) {
        try {
            sendEvent(eventName, params)
        } catch (error: Throwable) {
            if (error is CancellationException) throw error
            Log.e(TAG, "Could not emit React event $eventName", error)
        }
    }

    private fun safeResolvePromise(promise: Promise, value: Any?, label: String) {
        try {
            promise.resolve(value)
        } catch (error: Throwable) {
            if (error is CancellationException) throw error
            Log.e(TAG, "Could not resolve React promise for $label", error)
        }
    }

    private fun safeRejectPromise(
        promise: Promise?,
        code: String,
        message: String,
        cause: Throwable? = null,
    ) {
        if (promise == null) return
        try {
            if (cause == null) promise.reject(code, message) else promise.reject(code, message, cause)
        } catch (error: Throwable) {
            if (error is CancellationException) throw error
            Log.e(TAG, "Could not reject React promise for $code", error)
        }
    }

    override fun invalidate() {
        runtimeTeardownGeneration.incrementAndGet()
        runtimeTeardownRequested.set(true)
        super.invalidate()
        stopProgressPolling()
        try { downloadReceiver?.let { reactContext.unregisterReceiver(it) } } catch (_: Exception) {}
        runBlocking {
            runCatching {
                withTimeout(LIFECYCLE_WAIT_TIMEOUT_MS * 3L) {
                    lifecycleMutex.withLock {
                        val cancellationError = requestLifecycleInferenceCancellation()
                        if (cancellationError != null) {
                            quarantineRuntimeUnsafe()
                            throw IllegalStateException("Could not cancel active inference while invalidating", cancellationError)
                        }
                        conversationMutex.withLock {
                            val oldConversation = conversation
                            val oldEngine = engine
                            quarantineRuntimeUnsafe()
                            runCatching {
                                closeRuntimeBounded(oldConversation, oldEngine, "invalidate runtime close")
                            }.onFailure { closeError ->
                                Log.w(TAG, "Failed to close runtime while invalidating", closeError)
                            }
                        }
                    }
                }
            }.onFailure {
                quarantineRuntimeUnsafe()
                Log.w(TAG, "Timed out or failed while invalidating LiteRT runtime", it)
            }
        }
        scope.cancel()
        nativeExecutor.shutdownNow()
    }
}