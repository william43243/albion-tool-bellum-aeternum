package com.albion.market.litert

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject

class PlanModule(private val context: ReactApplicationContext): ReactContextBaseJavaModule(context) {
 override fun getName() = "PlanModule"
 @ReactMethod fun search(request: String, promise: Promise) {
  try { promise.resolve(PlanEngine(context).search(JSONObject(request)).toString()) }
  catch (_: Exception) { promise.resolve(JSONObject().put("status","data_error").put("warnings",org.json.JSONArray()).put("results",org.json.JSONArray()).toString()) }
 }
}
