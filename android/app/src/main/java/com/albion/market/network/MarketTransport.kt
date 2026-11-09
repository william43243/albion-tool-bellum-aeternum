package com.albion.market.network

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

class MarketTransportModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val calls = ConcurrentHashMap<String, Call>()
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS).build()

    override fun getName() = "MarketTransport"

    @ReactMethod fun request(id: String, url: String, promise: Promise) {
        val parsed = url.toHttpUrlOrNull()
        if (parsed == null || parsed.scheme != "https" || parsed.port != 443 ||
            parsed.host !in setOf("west.albion-online-data.com", "europe.albion-online-data.com", "east.albion-online-data.com") ||
            parsed.username.isNotEmpty() || parsed.password.isNotEmpty() ||
            !(parsed.encodedPath.startsWith("/api/v2/stats/prices/") || parsed.encodedPath.startsWith("/api/v2/stats/history/")) ||
            !parsed.encodedPath.endsWith(".json") || url.length > 4096) {
            promise.reject("MARKET_URL_INVALID", "Invalid market URL"); return
        }
        val call = client.newCall(Request.Builder().url(parsed).header("Cache-Control", "no-store").build())
        if (calls.putIfAbsent(id, call) != null) { promise.reject("MARKET_REQUEST_DUPLICATE", "Duplicate market request"); return }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                calls.remove(id, call)
                promise.reject("MARKET_REQUEST_FAILED", "Market request failed")
            }
            override fun onResponse(call: Call, response: Response) {
                try {
                    response.use {
                        val body = if (it.isSuccessful) it.body?.byteStream()?.use { input ->
                            String(BoundedRead.read(input, 4_000_000), Charsets.UTF_8)
                        } ?: "" else ""
                        val result = Arguments.createMap().apply {
                            putInt("status", it.code); putString("body", body)
                            putString("retryAfter", it.header("Retry-After")); putString("rateLimitReset", it.header("RateLimit-Reset"))
                        }
                        promise.resolve(result)
                    }
                } catch (e: Exception) { promise.reject("MARKET_RESPONSE_INVALID", "Market response unavailable or too large") }
                finally { calls.remove(id, call) }
            }
        })
    }

    @ReactMethod fun cancel(id: String) { calls.remove(id)?.cancel() }
    override fun invalidate() { calls.values.forEach { it.cancel() }; calls.clear(); super.invalidate() }
}

class MarketTransportPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(MarketTransportModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
