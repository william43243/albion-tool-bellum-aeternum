package com.albion.market.litert

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CancellationException
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** Executes the same deterministic engine as the AI tools on one background worker. */
class ProductionModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
 private val worker = Executors.newSingleThreadExecutor()
 private val active = AtomicReference<AtomicBoolean?>(null)
 override fun getName() = "ProductionModule"

 @ReactMethod fun execute(action: String, requestJson: String, server: String, promise: Promise) {
  if (action !in ProductionTools.actions || server !in setOf("americas", "europe", "asia") || requestJson.length > ProductionTools.MAX_ARGUMENT_BYTES ||
      requestJson.toByteArray(Charsets.UTF_8).size > ProductionTools.MAX_ARGUMENT_BYTES) {
   promise.resolve(ProductionTools.error(action, "INVALID_ARGUMENT", "Unknown action or request too large.").toString()); return
  }
  val cancelled = AtomicBoolean(false)
  if (!active.compareAndSet(null, cancelled)) {
   promise.resolve(ProductionTools.error(action, "BUSY", "A production analysis is already running.").toString()); return
  }
  try {
   worker.execute {
    val result = try {
     ProductionTools.execute(action, JSONObject(requestJson), { cancelled.get() || Thread.currentThread().isInterrupted }, server)
    } catch (e: ProductionScenarioException) {
     ProductionTools.error(action, e.code, e.message ?: "Price evidence is invalid.")
    } catch (_: CancellationException) {
     ProductionTools.error(action, "CANCELLED", "Analysis was cancelled.")
    } catch (_: Exception) {
     ProductionTools.error(action, "INVALID_ARGUMENT", "Invalid production request.")
    }
    active.compareAndSet(cancelled, null)
    promise.resolve(result.toString())
   }
  } catch (_: RejectedExecutionException) {
   active.compareAndSet(cancelled, null)
   promise.resolve(ProductionTools.error(action, "UNAVAILABLE", "Production analysis is unavailable.").toString())
  }
 }
 /** Estimate initial material weight from an explicit subset of the local source index. */
 @ReactMethod fun calculateWeight(materialsJson: String, indexJson: String, promise: Promise) {
  fun failure(code: String, message: String) = JSONObject().put("status", "error").put("error", JSONObject().put("code", code).put("message", message)).toString()
  if (materialsJson.toByteArray(Charsets.UTF_8).size > 65536 || indexJson.toByteArray(Charsets.UTF_8).size > 262144) {
   promise.resolve(failure("LIMIT_EXCEEDED", "Weight request is too large.")); return
  }
  val cancelled = AtomicBoolean(false)
  if (!active.compareAndSet(null, cancelled)) { promise.resolve(failure("BUSY", "A production operation is already running.")); return }
  try {
   worker.execute {
    val result = try {
     if (cancelled.get()) throw CancellationException()
     val computed = ProductionWeightEngine.calculate(JSONArray(materialsJson), JSONObject(indexJson))
     if (cancelled.get()) throw CancellationException()
     computed.toString()
    } catch (_: CancellationException) {
     failure("CANCELLED", "Weight analysis was cancelled.")
    } catch (_: Exception) {
     failure("INVALID_ARGUMENT", "Invalid weight request.")
    }
    active.compareAndSet(cancelled, null)
    promise.resolve(result)
   }
  } catch (_: RejectedExecutionException) {
   active.compareAndSet(cancelled, null); promise.resolve(failure("UNAVAILABLE", "Weight analysis is unavailable."))
  }
 }
 /** The UI calls this only after an explicit user action. The AI has no approval tool. */
 @ReactMethod fun approveScenario(scenarioJson: String, server: String, promise: Promise) {
  fun failure(code: String, message: String) = JSONObject().put("status", "error").put("error", JSONObject().put("code", code).put("message", message)).toString()
  if (server !in setOf("americas", "europe", "asia") || scenarioJson.length > 65536 || scenarioJson.toByteArray(Charsets.UTF_8).size > 65536) {
   promise.resolve(failure("INVALID_ARGUMENT", "Scenario is too large.")); return
  }
  val cancelled = AtomicBoolean(false)
  if (!active.compareAndSet(null, cancelled)) { promise.resolve(failure("BUSY", "A production operation is already running.")); return }
  try {
   worker.execute {
    val result = try {
     if(cancelled.get()) throw CancellationException()
     ProductionScenarioRegistry.approve(JSONObject(scenarioJson), server)
    } catch (e: ProductionScenarioException) {
     JSONObject().put("status", "error").put("error", JSONObject().put("code", e.code).put("message", e.message ?: "Invalid price evidence."))
    } catch (_: CancellationException) {
     JSONObject().put("status", "error").put("error", JSONObject().put("code", "CANCELLED").put("message", "Approval was cancelled."))
    } catch (_: Exception) {
     JSONObject().put("status", "error").put("error", JSONObject().put("code", "INVALID_ARGUMENT").put("message", "Invalid production scenario."))
    }
    active.compareAndSet(cancelled, null); promise.resolve(result.toString())
   }
  } catch (_: RejectedExecutionException) {
   active.compareAndSet(cancelled, null); promise.resolve(failure("UNAVAILABLE", "Production analysis is unavailable."))
  }
 }
 @ReactMethod fun cancel(promise: Promise) { active.get()?.set(true); promise.resolve(null) }
 override fun invalidate() { active.get()?.set(true); worker.shutdownNow(); super.invalidate() }
}
