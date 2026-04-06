package com.albion.market.litert

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
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

class LiteRTModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "LiteRTModule"
        private const val TAG = "LiteRTModule"
    }

    private var engine: Engine? = null
    private var conversation: Conversation? = null
    private var currentModelId: String? = null
    private var hasVision: Boolean = false
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val activeDownloads = mutableMapOf<Long, Triple<String, String, Promise>>()
    private var progressPollingJob: Job? = null
    private var downloadReceiver: BroadcastReceiver? = null

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

    @ReactMethod
    fun downloadModel(modelId: String, url: String, filename: String, promise: Promise) {
        try {
            val dm = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

            for (dir in getAllModelDirs()) {
                File(dir, filename).let { if (it.exists()) it.delete() }
                File(dir, "$filename.tmp").let { if (it.exists()) it.delete() }
            }

            val extDir = reactContext.getExternalFilesDir("litert-models")
            if (extDir != null && !extDir.exists()) extDir.mkdirs()

            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setTitle("AlbionMarket AI: $modelId")
                setDescription(filename)
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                setDestinationInExternalFilesDir(reactContext, "litert-models", filename)
                setAllowedOverMetered(true)
                setAllowedOverRoaming(false)
                setAllowedNetworkTypes(DownloadManager.Request.NETWORK_WIFI or DownloadManager.Request.NETWORK_MOBILE)
            }

            val downloadId = dm.enqueue(request)
            activeDownloads[downloadId] = Triple(modelId, filename, promise)
            Log.i(TAG, "Download enqueued: $modelId (id=$downloadId)")
            ensureDownloadReceiver()
            startProgressPolling(dm)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start download", e)
            promise.reject("DOWNLOAD_ERROR", "Download failed: ${e.message}", e)
        }
    }

    @ReactMethod
    fun cancelDownload(modelId: String, promise: Promise) {
        val dm = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val toRemove = activeDownloads.entries.find { it.value.first == modelId }
        if (toRemove != null) {
            dm.remove(toRemove.key)
            activeDownloads.remove(toRemove.key)
            promise.resolve(true)
        } else { promise.resolve(false) }
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
            promise.resolve(file?.delete() ?: false)
        } catch (e: Exception) { promise.reject("DELETE_ERROR", e.message, e) }
    }

    // ─── Download Helpers ────────────────────────────────────────

    private fun ensureDownloadReceiver() {
        if (downloadReceiver != null) return
        downloadReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
                val entry = activeDownloads[id] ?: return
                val (modelId, filename, promise) = entry
                val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                val query = DownloadManager.Query().setFilterById(id)
                val cursor = dm.query(query)
                if (cursor != null && cursor.moveToFirst()) {
                    val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                    cursor.close()
                    when (status) {
                        DownloadManager.STATUS_SUCCESSFUL -> {
                            val destFile = File(getModelDir(), filename)
                            sendEvent("onDownloadProgress", Arguments.createMap().apply {
                                putString("modelId", modelId); putDouble("percent", 100.0); putString("status", "complete")
                            })
                            promise.resolve(Arguments.createMap().apply {
                                putString("path", destFile.absolutePath); putDouble("sizeBytes", destFile.length().toDouble())
                            })
                            Log.i(TAG, "Download complete: $filename (${destFile.length()} bytes)")
                            activeDownloads.remove(id)
                            if (activeDownloads.isEmpty()) stopProgressPolling()
                        }
                        DownloadManager.STATUS_FAILED -> {
                            promise.reject("DOWNLOAD_FAILED", "Download failed")
                            activeDownloads.remove(id)
                            if (activeDownloads.isEmpty()) stopProgressPolling()
                        }
                    }
                } else { cursor?.close() }
            }
        }
        val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reactContext.registerReceiver(downloadReceiver, filter, Context.RECEIVER_EXPORTED)
        } else { reactContext.registerReceiver(downloadReceiver, filter) }
    }

    private fun startProgressPolling(dm: DownloadManager) {
        if (progressPollingJob?.isActive == true) return
        progressPollingJob = scope.launch {
            while (isActive && activeDownloads.isNotEmpty()) {
                for ((downloadId, entry) in activeDownloads.toMap()) {
                    val (modelId, _, _) = entry
                    val query = DownloadManager.Query().setFilterById(downloadId)
                    val cursor = dm.query(query)
                    if (cursor != null && cursor.moveToFirst()) {
                        val downloaded = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                        val total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                        val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                        cursor.close()
                        if (status == DownloadManager.STATUS_RUNNING || status == DownloadManager.STATUS_PENDING) {
                            val percent = if (total > 0) (downloaded.toDouble() / total * 100) else 0.0
                            sendEvent("onDownloadProgress", Arguments.createMap().apply {
                                putString("modelId", modelId); putDouble("bytesDownloaded", downloaded.toDouble())
                                putDouble("totalBytes", total.toDouble()); putDouble("percent", percent)
                                putString("status", if (status == DownloadManager.STATUS_RUNNING) "downloading" else "pending")
                            })
                        }
                    } else { cursor?.close() }
                }
                delay(1000)
            }
        }
    }

    private fun stopProgressPolling() { progressPollingJob?.cancel(); progressPollingJob = null }

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
        stopProgressPolling()
        try { downloadReceiver?.let { reactContext.unregisterReceiver(it) } } catch (_: Exception) {}
        scope.cancel()
        conversation?.close()
        engine?.close()
    }
}
