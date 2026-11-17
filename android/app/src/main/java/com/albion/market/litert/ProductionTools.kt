package com.albion.market.litert

import com.google.ai.edge.litertlm.OpenApiTool
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CancellationException

/** Adapters around the shared deterministic engine. No market data is fetched here. */
object ProductionTools {
 val singleActions = setOf("calculate_crafting_profit", "analyze_market_liquidity", "calculate_focus_efficiency")
 val comparisonActions = setOf("find_profitable_crafts", "optimize_refining", "optimize_production_plan", "compare_crafting_routes")
 val actions = singleActions + comparisonActions
 val toolActions = actions + "list_production_scenarios"
 private val rankings = setOf("profit", "roi", "focus", "liquidity")
 private val scenarioKeys = setOf("label", "quantity", "outputPerCraft", "materials", "outputUnitPrice", "returnRate", "stationFeePerCraft", "focusPerCraft", "salesTaxRate", "sellOrderFeeRate", "budget", "availableFocus", "volumeObserved", "volumeDays")
 private val materialKeys = setOf("itemId", "amountPerCraft", "unitPrice", "returnable")
 const val MAX_ARGUMENT_BYTES = 1_000_000

 private fun keys(value: JSONObject) = value.keys().asSequence().toSet()
 private fun text(value: JSONObject, key: String, maxLength: Int = 120) {
  val actual = value.get(key)
  require(actual is String && actual.isNotBlank() && actual.length <= maxLength) { "INVALID_ARGUMENT" }
 }
 private fun number(value: JSONObject, key: String, nullable: Boolean = false) {
  val actual = value.get(key)
  if (nullable && actual === JSONObject.NULL) return
  require(actual is Number && actual.toDouble().isFinite()) { "INVALID_ARGUMENT" }
 }
 fun validateScenario(value: JSONObject, cancelled: () -> Boolean = { false }) {
  require(keys(value) - setOf("priceEvidence", "volumeEvidence", "metadata") == scenarioKeys) { "INVALID_ARGUMENT" }
  text(value, "label")
  if(value.has("metadata")) {
   val metadata=value.getJSONObject("metadata")
   require(keys(metadata).all { it in setOf("outputItemId","tier","enchantment","quality","category","buyCity","sellCity","productionCity","saleSide","recipe") }) { "INVALID_ARGUMENT" }
   for(key in listOf("outputItemId","category")) if(metadata.has(key)) text(metadata,key,if(key=="outputItemId") 128 else 64)
   if(metadata.has("outputItemId")) require(metadata.getString("outputItemId").matches(Regex("[A-Za-z0-9_@.-]{1,128}"))) { "INVALID_ARGUMENT" }
   for ((key, range) in listOf("tier" to 1..8, "enchantment" to 0..4, "quality" to 1..5)) if(metadata.has(key)) {
    val n=metadata.get(key); require(n is Number && n.toDouble().isFinite() && n.toDouble()%1.0==0.0 && n.toDouble()>=range.first && n.toDouble()<=range.last) { "INVALID_ARGUMENT" }
   }
   for(key in listOf("buyCity","sellCity","productionCity")) if(metadata.has(key)) require(metadata.get(key) is String && metadata.getString(key) in setOf("Caerleon","Bridgewatch","Fort Sterling","Lymhurst","Thetford","Martlock","Brecilien")) { "INVALID_ARGUMENT" }
   if(metadata.has("saleSide")) require(metadata.get("saleSide") is String && metadata.getString("saleSide") in setOf("saleImmediate","saleOrderReference")) { "INVALID_ARGUMENT" }
  }
  for (key in listOf("quantity", "outputPerCraft", "outputUnitPrice", "returnRate", "stationFeePerCraft", "focusPerCraft", "salesTaxRate", "sellOrderFeeRate")) number(value, key)
  ProductionEngine().validateRecipeMetadata(value)
  if(value.optJSONObject("metadata")?.optString("saleSide") == "saleImmediate") require(value.getDouble("sellOrderFeeRate")==0.0) { "INVALID_ARGUMENT" }
  for (key in listOf("budget", "availableFocus", "volumeObserved", "volumeDays")) number(value, key, true)
  val materials = value.getJSONArray("materials")
  require(materials.length() in 1..64) { "INVALID_ARGUMENT" }
  for (i in 0 until materials.length()) {
   if (cancelled()) throw CancellationException()
   val material = materials.getJSONObject(i)
   require(keys(material) == materialKeys) { "INVALID_ARGUMENT" }
   text(material, "itemId", 128); number(material, "amountPerCraft"); number(material, "unitPrice")
   require(material.get("returnable") is Boolean) { "INVALID_ARGUMENT" }
  }
  ProductionScenarioRegistry.validateEvidence(value)
 }
 fun validateRequest(action: String, value: JSONObject, cancelled: () -> Boolean = { false }) {
  if (cancelled()) throw CancellationException()
  require(action in actions) { "UNKNOWN_ACTION" }
  if (action in singleActions) {
   require(keys(value) == setOf("scenario")) { "INVALID_ARGUMENT" }
   validateScenario(value.getJSONObject("scenario"), cancelled)
  } else if (action == "optimize_production_plan" && keys(value) == setOf("scenario", "optimizeQuantity")) {
   require(value.get("optimizeQuantity") == true) { "INVALID_ARGUMENT" }
   validateScenario(value.getJSONObject("scenario"), cancelled)
  } else if (action == "optimize_production_plan" && keys(value) == setOf("steps", "budget", "availableFocus")) {
   number(value, "budget", true); number(value, "availableFocus", true)
   val steps=value.getJSONArray("steps")
   require(steps.length() in 2..12) { "INVALID_ARGUMENT" }
   for (i in 0 until steps.length()) {
    val step=steps.getJSONObject(i)
    require(keys(step) == setOf("outputItemId", "scenario")) { "INVALID_ARGUMENT" }
    text(step, "outputItemId", 128)
    val stepId=step.getString("outputItemId"); val item=step.getJSONObject("scenario")
    validateScenario(item, cancelled)
    val metadata=item.optJSONObject("metadata")
    require(metadata==null || !metadata.has("outputItemId") || metadata.getString("outputItemId")==stepId) { "INVALID_ARGUMENT" }
    val evidence=item.optJSONArray("priceEvidence")
    if(evidence!=null) for(j in 0 until evidence.length()) { val quote=evidence.getJSONObject(j); if(quote.optString("key")=="output") require(quote.getString("itemId")==stepId) { "INVALID_ARGUMENT" } }
    val volume=item.optJSONObject("volumeEvidence")
    require(volume==null || volume.getString("itemId")==stepId) { "INVALID_ARGUMENT" }
   }
  } else {
   require(keys(value) == setOf("scenarios", "ranking")) { "INVALID_ARGUMENT" }
   require(value.get("ranking") is String && value.getString("ranking") in rankings) { "INVALID_ARGUMENT" }
   val scenarios = value.getJSONArray("scenarios")
   require(scenarios.length() in 1..2000) { "INVALID_ARGUMENT" }
   var materialCount=0
   for (i in 0 until scenarios.length()) {
    val item=scenarios.getJSONObject(i); validateScenario(item, cancelled)
    materialCount += item.getJSONArray("materials").length()
    require(materialCount<=8192) { "INVALID_ARGUMENT" }
   }
  }
 }
 fun error(action: String, code: String, message: String) = JSONObject().put("status", "error").put("action", action)
  .put("error", JSONObject().put("code", code).put("message", message))

 private fun description(action: String): String {
  val purpose = when (action) {
   "list_production_scenarios" -> "List only scenarios explicitly approved by the user in the application."
   "calculate_crafting_profit" -> "Calculate one approved production scenario."
   "analyze_market_liquidity" -> "Evaluate only the past volume entered for one approved scenario; never imply guaranteed fills."
   "calculate_focus_efficiency" -> "Calculate focus use and total net profit per focus for one approved scenario; this is not incremental focus profit."
   "find_profitable_crafts" -> "Rank approved scenarios; this does not search recipes or current markets."
   "optimize_refining" -> "Compare approved single-stage refining scenarios; no multi-stage chain is inferred."
   "optimize_production_plan" -> "Compare approved single-scenario alternatives; this is not a multi-recipe production plan."
   "compare_crafting_routes" -> "Compare approved production alternatives; travel routes and transport costs are not calculated."
   else -> throw IllegalArgumentException("UNKNOWN_ACTION")
  }
  return "$purpose Call list_production_scenarios first, use only returned IDs, and ask the user to approve scenarios in the application if none are available. The assumptions are not independently verified; identified stale observations are rejected. No execution or market fill is guaranteed."
 }
 private fun definition(action: String): JSONObject {
  val properties = JSONObject()
  if (action in singleActions) properties.put("scenarioId", JSONObject().put("type", "string"))
  else if (action in comparisonActions) properties.put("scenarioIds", JSONObject().put("type", "array").put("items", JSONObject().put("type", "string")))
   .put("ranking", JSONObject().put("type", "string").put("enum", JSONArray(listOf("profit", "roi", "focus", "liquidity"))))
  val required = if (action in singleActions) JSONArray(listOf("scenarioId")) else if (action in comparisonActions) JSONArray(listOf("scenarioIds", "ranking")) else JSONArray()
  return JSONObject().put("name", action).put("description", description(action))
   .put("parameters", JSONObject().put("type", "object").put("additionalProperties", false).put("properties", properties).put("required", required))
 }
 private fun annotate(result: JSONObject): JSONObject = result.put("dataSource", "caller_supplied_unverified")
  .put("observedAtMs", JSONObject.NULL)
  .put("sourceWarning", "Inputs are supplied by the caller; their origin, freshness, prices and recipes are not verified. No order execution or fill is guaranteed.")
 fun execute(action: String, request: JSONObject, cancelled: () -> Boolean = { false }, expectedServer: String? = null): JSONObject {
  validateRequest(action, request, cancelled)
  val single=request.optJSONObject("scenario"); if(single!=null) ProductionScenarioRegistry.requireServer(single,expectedServer)
  val ranked=request.optJSONArray("scenarios"); if(ranked!=null) for(i in 0 until ranked.length()) ProductionScenarioRegistry.requireServer(ranked.getJSONObject(i),expectedServer)
  val steps=request.optJSONArray("steps"); if(steps!=null) for(i in 0 until steps.length()) ProductionScenarioRegistry.requireServer(steps.getJSONObject(i).getJSONObject("scenario"),expectedServer)
  val result=ProductionEngine(cancelled).execute(action, request)
  if(result.optString("status")=="ok") {
   val single=request.optJSONObject("scenario")
   if(single!=null && result.optJSONObject("result")!=null) result.getJSONObject("result").put("metadata",single.optJSONObject("metadata") ?: JSONObject.NULL)
   val scenarios=request.optJSONArray("scenarios"); val results=result.optJSONArray("results")
   if(scenarios!=null && results!=null) for(i in 0 until results.length()) {
    val row=results.getJSONObject(i); val index=row.optInt("inputIndex",-1)
    if(index in 0 until scenarios.length()) row.put("metadata",scenarios.getJSONObject(index).optJSONObject("metadata") ?: JSONObject.NULL)
   }
  }
  return annotate(result)
 }
 fun validateToolRequest(action: String, request: JSONObject) {
  require(action in toolActions) { "UNKNOWN_ACTION" }
  if (action == "list_production_scenarios") { require(keys(request).isEmpty()) { "INVALID_ARGUMENT" }; return }
  fun id(value: Any): String {
   require(value is String && value.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))) { "INVALID_ARGUMENT" }
   return value
  }
  if (action in singleActions) {
   require(keys(request) == setOf("scenarioId")) { "INVALID_ARGUMENT" }; id(request.get("scenarioId"))
  } else {
   require(keys(request) == setOf("scenarioIds", "ranking")) { "INVALID_ARGUMENT" }
   require(request.get("ranking") is String && request.getString("ranking") in rankings) { "INVALID_ARGUMENT" }
   val ids=request.getJSONArray("scenarioIds")
   require(ids.length() in 1..64) { "INVALID_ARGUMENT" }
   val seen=HashSet<String>()
   for (i in 0 until ids.length()) require(seen.add(id(ids.get(i)))) { "INVALID_ARGUMENT" }
  }
 }
 fun all(cancelled: () -> Boolean = { false }, expectedServer: String? = null): List<OpenApiTool> = toolActions.sorted().map { action -> object : OpenApiTool {
  override fun getToolDescriptionJsonString() = definition(action).toString()
  override fun execute(paramsJsonString: String): String = try {
   require(paramsJsonString.length <= 16384) { "INVALID_ARGUMENT" }
   val params=JSONObject(paramsJsonString)
   validateToolRequest(action, params)
   if (action == "list_production_scenarios") JSONObject().put("status", "ok").put("scenarios", ProductionScenarioRegistry.list(expectedServer)).put("warning", "Approved assumptions only; values, sources and market freshness are not independently verified.").toString()
   else {
    val resolved=JSONObject()
    if (action in singleActions) resolved.put("scenario", ProductionScenarioRegistry.resolve(params.getString("scenarioId"), expectedServer))
    else {
     val ids=params.getJSONArray("scenarioIds"); val scenarios=JSONArray()
     for (i in 0 until ids.length()) { if(cancelled()) throw CancellationException(); scenarios.put(ProductionScenarioRegistry.resolve(ids.getString(i), expectedServer)) }
     resolved.put("scenarios", scenarios).put("ranking", params.getString("ranking"))
    }
    val output=ProductionTools.execute(action, resolved, cancelled, expectedServer).put("dataSource", "user_approved_assumptions").put("sourceWarning", "Values were explicitly approved as a scenario by the user, but recipes, provenance and current prices are not independently verified. Orders may not fill.").toString()
    if(output.length>48000) error(action, "RESULT_LIMIT", "Result too large for an AI context; compare fewer scenarios.").toString() else output
   }
  } catch (e: ProductionScenarioException) {
   error(action, e.code, e.message ?: "Scenario unavailable.").toString()
  } catch (_: CancellationException) {
   error(action, "CANCELLED", "Analysis was cancelled.").toString()
  } catch (_: Exception) {
   error(action, "INVALID_ARGUMENT", "Invalid scenario identifier or ranking.").toString()
  }
 } }
}
