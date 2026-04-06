package com.albion.market.litert

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.util.Log
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
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

class LiteRTModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "LiteRTModule"
        private const val TAG = "LiteRTModule"
        private const val NOTIF_CHANNEL_ID = "ai_downloads"
        private const val BUFFER_SIZE = 32 * 1024  // 32 KB read buffer
    }

    private var engine: Engine? = null
    private var conversation: Conversation? = null
    private var currentModelId: String? = null
    private var hasVision: Boolean = false
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Active download jobs keyed by modelId; connection refs allow immediate cancellation
    private val activeDownloadJobs = mutableMapOf<String, Job>()
    private val activeConnections = mutableMapOf<String, HttpURLConnection>()

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
                    ?.filter { it.name.endsWith(".litertlm") && it.name !in seen }
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
    fun isModelDownloaded(modelFilename: String, promise: Promise) {
        promise.resolve(findModelFile(modelFilename) != null)
    }

    @ReactMethod
    fun getFreeDiskSpace(promise: Promise) {
        try {
            val stat = android.os.StatFs(reactContext.filesDir.path)
            promise.resolve(stat.availableBytes.toDouble())
        } catch (e: Exception) { promise.resolve(-1.0) }
    }

    /**
     * Download a model file with support for resuming an interrupted download.
     *
     * A partial download is stored as "<filename>.part" in the model directory.
     * On the next attempt the existing partial file size is sent as an HTTP
     * Range header so the server can continue from that offset (HTTP 206).
     * If the server does not support Range requests (HTTP 200) the partial
     * file is discarded and the download starts from the beginning.
     */
    @ReactMethod
    fun downloadModel(modelId: String, url: String, filename: String, promise: Promise) {
        if (activeDownloadJobs.containsKey(modelId)) {
            promise.reject("ALREADY_DOWNLOADING", "Already downloading: $modelId")
            return
        }

        val job = scope.launch(Dispatchers.IO) {
            var conn: HttpURLConnection? = null
            var fos: FileOutputStream? = null
            try {
                val destDir = getModelDir()
                if (!destDir.exists()) destDir.mkdirs()

                val partFile = File(destDir, "$filename.part")
                val destFile = File(destDir, filename)

                // Detect a previous partial download to resume
                val resumeFrom = if (partFile.exists() && partFile.length() > 0) partFile.length() else 0L

                conn = URL(url).openConnection() as HttpURLConnection
                activeConnections[modelId] = conn
                conn.connectTimeout = 30_000
                conn.readTimeout = 60_000
                conn.setRequestProperty("User-Agent", "AlbionMarket-AI/1.0")
                if (resumeFrom > 0) {
                    conn.setRequestProperty("Range", "bytes=$resumeFrom-")
                    Log.i(TAG, "Resuming $filename from byte $resumeFrom")
                }
                conn.connect()

                val responseCode = conn.responseCode
                if (responseCode != HttpURLConnection.HTTP_OK && responseCode != HttpURLConnection.HTTP_PARTIAL) {
                    promise.reject("DOWNLOAD_ERROR", "HTTP error: $responseCode")
                    return@launch
                }

                // If the server ignored the Range header and returned the full file, restart
                val actualResumeFrom = if (responseCode == HttpURLConnection.HTTP_PARTIAL) resumeFrom else 0L
                if (responseCode == HttpURLConnection.HTTP_OK && resumeFrom > 0) {
                    Log.w(TAG, "Server does not support resume, restarting $filename")
                    partFile.delete()
                }

                // Calculate total file size for progress reporting
                val contentLength = conn.contentLengthLong
                val totalBytes = when {
                    responseCode == HttpURLConnection.HTTP_PARTIAL && contentLength > 0 -> actualResumeFrom + contentLength
                    contentLength > 0 -> contentLength
                    else -> -1L
                }

                showDownloadNotification(modelId, filename, 0)

                fos = FileOutputStream(partFile, actualResumeFrom > 0)
                var bytesWritten = actualResumeFrom
                val buffer = ByteArray(BUFFER_SIZE)
                val inputStream = conn.inputStream

                // Emit an initial progress event so the UI shows the resume offset immediately
                if (actualResumeFrom > 0) {
                    val resumePct = if (totalBytes > 0) actualResumeFrom.toDouble() / totalBytes * 100 else 0.0
                    sendEvent("onDownloadProgress", Arguments.createMap().apply {
                        putString("modelId", modelId)
                        putDouble("bytesDownloaded", actualResumeFrom.toDouble())
                        putDouble("totalBytes", totalBytes.toDouble())
                        putDouble("percent", resumePct)
                        putString("status", "resuming")
                    })
                }

                var bytesRead: Int
                var cancelled = false
                var lastNotifPercent = -1
                while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                    if (!isActive) { cancelled = true; break }
                    fos.write(buffer, 0, bytesRead)
                    bytesWritten += bytesRead
                    val percent = if (totalBytes > 0) bytesWritten.toDouble() / totalBytes * 100 else 0.0
                    sendEvent("onDownloadProgress", Arguments.createMap().apply {
                        putString("modelId", modelId)
                        putDouble("bytesDownloaded", bytesWritten.toDouble())
                        putDouble("totalBytes", totalBytes.toDouble())
                        putDouble("percent", percent)
                        putString("status", "downloading")
                    })
                    // Update the system notification every 5 percentage-points to avoid flooding
                    val percentInt = percent.toInt()
                    if (percentInt >= lastNotifPercent + 5) {
                        lastNotifPercent = percentInt
                        showDownloadNotification(modelId, filename, percentInt)
                    }
                }

                fos.close(); fos = null
                inputStream.close()

                if (cancelled || !isActive) {
                    dismissDownloadNotification(modelId)
                    promise.reject("DOWNLOAD_CANCELLED", "Download cancelled")
                    return@launch
                }

                // Verify that we received all the data we expected
                if (totalBytes > 0 && bytesWritten < totalBytes) {
                    dismissDownloadNotification(modelId)
                    promise.reject("DOWNLOAD_INCOMPLETE", "Download incomplete: received $bytesWritten of $totalBytes bytes")
                    return@launch
                }

                if (destFile.exists()) destFile.delete()
                if (!partFile.renameTo(destFile)) {
                    dismissDownloadNotification(modelId)
                    promise.reject("RENAME_ERROR", "Failed to finalize download file")
                    return@launch
                }

                sendEvent("onDownloadProgress", Arguments.createMap().apply {
                    putString("modelId", modelId); putDouble("percent", 100.0); putString("status", "complete")
                })
                dismissDownloadNotification(modelId)
                promise.resolve(Arguments.createMap().apply {
                    putString("path", destFile.absolutePath); putDouble("sizeBytes", destFile.length().toDouble())
                })
                Log.i(TAG, "Download complete: $filename (${destFile.length()} bytes)")
            } catch (e: Exception) {
                fos?.close()
                dismissDownloadNotification(modelId)
                if (isActive) {
                    Log.e(TAG, "Download failed: $filename", e)
                    promise.reject("DOWNLOAD_FAILED", e.message ?: "Download failed", e)
                } else {
                    promise.reject("DOWNLOAD_CANCELLED", "Download cancelled")
                }
            } finally {
                conn?.disconnect()
                activeConnections.remove(modelId)
                activeDownloadJobs.remove(modelId)
            }
        }
        activeDownloadJobs[modelId] = job
    }

    @ReactMethod
    fun cancelDownload(modelId: String, promise: Promise) {
        val job = activeDownloadJobs.remove(modelId)
        // Disconnect immediately so the blocking read is interrupted
        activeConnections.remove(modelId)?.disconnect()
        if (job != null) {
            job.cancel()
            promise.resolve(true)
        } else {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun deleteModel(filename: String, promise: Promise) {
        try {
            val file = findModelFile(filename)
            if (file != null && file.nameWithoutExtension == currentModelId) {
                conversation?.close(); conversation = null
                engine?.close(); engine = null
                currentModelId = null
            }
            // Also remove any leftover partial download
            val partFile = File(getModelDir(), "$filename.part")
            if (partFile.exists()) partFile.delete()
            promise.resolve(file?.delete() ?: false)
        } catch (e: Exception) { promise.reject("DELETE_ERROR", e.message, e) }
    }

    // ─── Download Notification Helpers ───────────────────────────

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(NOTIF_CHANNEL_ID) == null) {
                val channel = NotificationChannel(
                    NOTIF_CHANNEL_ID,
                    "AI Model Downloads",
                    NotificationManager.IMPORTANCE_LOW
                ).apply { setShowBadge(false) }
                nm.createNotificationChannel(channel)
            }
        }
    }

    private fun showDownloadNotification(modelId: String, filename: String, percent: Int) {
        try {
            ensureNotificationChannel()
            val nm = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(reactContext, NOTIF_CHANNEL_ID)
            } else {
                @Suppress("DEPRECATION") Notification.Builder(reactContext)
            }
            val notif = builder
                .setContentTitle("AlbionMarket AI: $modelId")
                .setContentText(filename)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setProgress(100, percent, percent == 0)
                .setOngoing(true)
                .build()
            nm.notify(modelId.hashCode(), notif)
        } catch (_: Exception) {}
    }

    private fun dismissDownloadNotification(modelId: String) {
        try {
            val nm = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(modelId.hashCode())
        } catch (_: Exception) {}
    }

    // ─── Engine Lifecycle ────────────────────────────────────────

    @ReactMethod
    fun initialize(modelFilename: String, systemPrompt: String, serverBaseUrl: String, promise: Promise) {
        scope.launch {
            try {
                val modelFile = findModelFile(modelFilename)
                if (modelFile == null) {
                    promise.reject("MODEL_NOT_FOUND", "Model not found: $modelFilename")
                    return@launch
                }

                conversation?.close()
                engine?.close()

                // Determine whether a GPU backend can be instantiated at all
                var usingGpu = true
                val gpuBackend: Backend? = try {
                    Backend.GPU()
                } catch (e: Exception) {
                    Log.w(TAG, "GPU backend constructor failed, will use CPU: ${e.message}")
                    usingGpu = false
                    null
                }

                var newEngine: Engine? = null

                // Tier 1 — GPU + vision (best path for multimodal models)
                if (usingGpu && gpuBackend != null) {
                    try {
                        val config = EngineConfig(
                            modelPath = modelFile.absolutePath,
                            backend = gpuBackend,
                            visionBackend = Backend.GPU(),
                            cacheDir = reactContext.cacheDir.path
                        )
                        newEngine = Engine(config).also { it.initialize() }
                        hasVision = true
                        Log.i(TAG, "Engine initialized WITH vision (GPU)")
                    } catch (e: Exception) {
                        Log.w(TAG, "GPU+vision init failed: ${e.message}")
                        newEngine = null
                    }
                }

                // Tier 2 — GPU text-only
                if (newEngine == null && usingGpu && gpuBackend != null) {
                    try {
                        val config = EngineConfig(
                            modelPath = modelFile.absolutePath,
                            backend = gpuBackend,
                            cacheDir = reactContext.cacheDir.path
                        )
                        newEngine = Engine(config).also { it.initialize() }
                        hasVision = false
                        Log.i(TAG, "Engine initialized text-only (GPU)")
                    } catch (e: Exception) {
                        Log.w(TAG, "GPU text-only init failed: ${e.message}")
                        newEngine = null
                    }
                }

                // Tier 3 — CPU text-only (last resort, works on all devices)
                if (newEngine == null) {
                    try {
                        val config = EngineConfig(
                            modelPath = modelFile.absolutePath,
                            backend = Backend.CPU(),
                            cacheDir = reactContext.cacheDir.path
                        )
                        newEngine = Engine(config).also { it.initialize() }
                        hasVision = false
                        Log.i(TAG, "Engine initialized text-only (CPU fallback)")
                    } catch (e: Exception) {
                        Log.e(TAG, "CPU fallback init also failed: ${e.message}")
                        throw Exception(
                            "Failed to start the AI engine on this device. " +
                            "Your chipset may not be fully supported by LiteRT yet. " +
                            "Try a different model or check for an app update.\n\nDetails: ${e.message}"
                        )
                    }
                }

                engine = newEngine
                currentModelId = modelFile.nameWithoutExtension

                val albionTools = AlbionTools(serverBaseUrl, reactContext)
                val toolList = albionTools.allTools().map { tool(it) }

                val convConfig = ConversationConfig(
                    systemInstruction = Contents.of(systemPrompt),
                    samplerConfig = SamplerConfig(topK = 20, topP = 0.9, temperature = 0.3),
                    tools = toolList,
                )
                conversation = newEngine!!.createConversation(convConfig)

                promise.resolve(Arguments.createMap().apply {
                    putBoolean("success", true)
                    putBoolean("hasVision", hasVision)
                })
                Log.i(TAG, "Engine ready: ${modelFile.name}, vision=$hasVision, tools=${toolList.size}")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to initialize engine", e)
                promise.reject("INIT_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun sendMessage(userMessage: String, requestId: String, promise: Promise) {
        val conv = conversation ?: run {
            promise.reject("NOT_INITIALIZED", "Engine not initialized."); return
        }
        scope.launch {
            try {
                val callback = createStreamCallback(requestId)
                conv.sendMessageAsync(userMessage, callback)
                promise.resolve(true)
            } catch (e: Exception) {
                Log.e(TAG, "sendMessage failed", e)
                promise.reject("SEND_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun sendMessageWithImage(userMessage: String, imagePath: String, requestId: String, promise: Promise) {
        val conv = conversation ?: run {
            promise.reject("NOT_INITIALIZED", "Engine not initialized."); return
        }
        if (!hasVision) {
            promise.reject("NO_VISION", "This model does not support images. Use a multimodal model (Qwen3.5).")
            return
        }
        scope.launch {
            try {
                val imageFile = File(imagePath)
                if (!imageFile.exists()) {
                    promise.reject("IMAGE_NOT_FOUND", "Image not found: $imagePath"); return@launch
                }
                val callback = createStreamCallback(requestId)
                val content = Contents.of(Content.ImageFile(imagePath), Content.Text(userMessage))
                conv.sendMessageAsync(content, callback)
                promise.resolve(true)
            } catch (e: Exception) {
                Log.e(TAG, "sendMessageWithImage failed", e)
                promise.reject("SEND_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun resetConversation(systemPrompt: String, promise: Promise) {
        val eng = engine ?: run { promise.reject("NOT_INITIALIZED", "Engine not initialized."); return }
        scope.launch {
            try {
                conversation?.close()
                val convConfig = ConversationConfig(
                    systemInstruction = Contents.of(systemPrompt),
                    samplerConfig = SamplerConfig(topK = 20, topP = 0.9, temperature = 0.3)
                )
                conversation = eng.createConversation(convConfig)
                promise.resolve(true)
            } catch (e: Exception) { promise.reject("RESET_ERROR", e.message, e) }
        }
    }

    @ReactMethod
    fun destroy(promise: Promise) {
        scope.launch {
            try {
                conversation?.close(); conversation = null
                engine?.close(); engine = null
                currentModelId = null; hasVision = false
                promise.resolve(true)
            } catch (e: Exception) { promise.reject("DESTROY_ERROR", e.message, e) }
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────

    private fun createStreamCallback(requestId: String) = object : MessageCallback {
        override fun onMessage(message: Message) {
            sendEvent("onLiteRTToken", Arguments.createMap().apply {
                putString("requestId", requestId); putString("token", message.toString())
            })
        }
        override fun onDone() {
            sendEvent("onLiteRTDone", Arguments.createMap().apply { putString("requestId", requestId) })
        }
        override fun onError(throwable: Throwable) {
            sendEvent("onLiteRTError", Arguments.createMap().apply {
                putString("requestId", requestId); putString("error", throwable.message ?: "Unknown error")
            })
        }
    }

    private fun getModelDir(): File {
        val extDir = reactContext.getExternalFilesDir("litert-models")
        if (extDir != null) { if (!extDir.exists()) extDir.mkdirs(); return extDir }
        return File(reactContext.filesDir, "litert-models")
    }

    private fun getAllModelDirs(): List<File> {
        val dirs = mutableListOf<File>()
        reactContext.getExternalFilesDir("litert-models")?.let { dirs.add(it) }
        dirs.add(File(reactContext.filesDir, "litert-models"))
        return dirs
    }

    private fun findModelFile(filename: String): File? {
        for (dir in getAllModelDirs()) {
            val file = File(dir, filename)
            if (file.exists()) return file
        }
        return null
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(eventName, params)
    }

    override fun invalidate() {
        super.invalidate()
        // Cancel all active downloads gracefully
        activeConnections.values.forEach { try { it.disconnect() } catch (_: Exception) {} }
        activeConnections.clear()
        activeDownloadJobs.values.forEach { it.cancel() }
        activeDownloadJobs.clear()
        scope.cancel()
        conversation?.close()
        engine?.close()
    }
}
