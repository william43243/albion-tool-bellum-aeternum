package com.albion.market.litert

import android.content.Context
import android.util.Log
import com.albion.market.BuildConfig
import com.google.ai.edge.litertlm.OpenApiTool
import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer
import java.util.Locale
import java.security.MessageDigest

/** Static, evidence-labelled planner used by both the UI bridge and AI tools. */
class PlanEngine(private val context: Context) {
 private val map by lazy { JSONObject(context.assets.open("world-map.local.json").bufferedReader().use { it.readText() }) }
 private val catalogBytes by lazy { context.assets.open("plan-catalog.json").use { it.readBytes() } }
 private val catalog by lazy { JSONObject(String(catalogBytes, Charsets.UTF_8)) }
 private val catalogFingerprint by lazy { MessageDigest.getInstance("SHA-256").digest(catalogBytes).joinToString("") { "%02x".format(it.toInt() and 255) } }
 private val expectedCatalogFingerprint = "52543f9fa29aac63279d86a72f6b6b432742bb439a008cdcb09ecd824b955170"
 private fun rows(array: JSONArray): List<JSONObject> = (0 until array.length()).map { array.getJSONObject(it) }
 private fun strings(array: JSONArray): List<String> = (0 until array.length()).map { array.getString(it) }
 private val zones by lazy { rows(map.getJSONArray("zones")) }
 private val byId by lazy { zones.associateBy { it.getString("id") } }
 private val graph by lazy { WorldRouteGraph(zones.map { z -> WorldRouteGraph.Zone(z.getString("id"), z.getString("name"), z.getString("risk"), strings(z.getJSONArray("exits"))) }) }
 private val sources by lazy { rows(catalog.getJSONArray("sources")).associate { it.getString("id") to it.getString("url") } }
 private val totals by lazy { rows(catalog.getJSONArray("zone_totals")).associateBy { it.getString("zone_id") } }
 private fun norm(value: String) = Normalizer.normalize(value.trim().lowercase(Locale.ROOT), Normalizer.Form.NFD).replace(Regex("\\p{M}"), "")
 private fun aliases(category: String) = when(category) {
  "ore" -> listOf("ore", "minerai", "mineral")
  "wood" -> listOf("wood", "bois", "madera")
  "stone" -> listOf("stone", "rock", "pierre", "piedra")
  "fiber" -> listOf("fiber", "fibre", "fibra")
  "hide" -> listOf("hide", "skin", "peau", "cuir", "piel")
  else -> emptyList()
 }
 private fun matches(q:String, item:JSONObject):Boolean {
  if(q.isEmpty()) return true
  val name=norm(item.getString("name")); val id=norm(item.optString("resource_id",item.optString("mob_id")))
  val category=item.optString("category")
  return name.contains(q) || id.contains(q) || aliases(category).any { it == q }
 }
 private fun answer(status:String, warnings:List<String> = emptyList(), result:List<JSONObject> = emptyList()) = JSONObject()
  .put("status",status).put("warnings",JSONArray(warnings)).put("results",JSONArray(result))
  .put("mapRevision",map.getJSONObject("provenance").getString("revision"))
  .put("schemaVersion",catalog.getString("schema_version"))
  .put("catalogFingerprint",catalogFingerprint)

 fun search(p: JSONObject): JSONObject {
  require(catalogFingerprint == expectedCatalogFingerprint) { "PLAN_CATALOG_MISMATCH" }
  val q=norm(p.getString("query")); val kind=p.getString("kind")
  val tier=p.getInt("tier"); val enchantment=p.getInt("enchantment")
  val start=p.getString("startZoneId").trim(); val policy=p.getString("policy")
  val excluded=strings(p.getJSONArray("excludedRisks")).toSet()
  require(q.length<=120 && start.length in 1..120 && kind in setOf("resource","creature","mob") && tier in 0..8 && enchantment in -1..4)
  require(policy in setOf("fewest_transitions","fewest_lethal") && excluded.all { it in setOf("blue","yellow","red","black","city","unknown") })
  val origin=byId[start] ?: zones.find { norm(it.getString("name")) == norm(start) }
   ?: return answer("invalid_request", listOf("Starting zone is not mapped."))
  if(origin.getString("risk") in excluded) return answer("invalid_request",listOf("Starting zone is excluded by the risk filter."))
  val entries=if(kind=="resource") rows(catalog.getJSONArray("resources")) else rows(catalog.getJSONArray("mobs")).filter { it.getString("category") == if(kind=="creature") "harvestable" else "hostile" }
  val selected=entries.filter { matches(q,it) && (tier==0 || (!it.isNull("tier") && it.getInt("tier")==tier)) }
  if(selected.isEmpty()) return answer("no_data",listOf("No catalogue entries match the request."))
  val candidates=mutableListOf<JSONObject>()
  val routes=mutableMapOf<String,List<String>>()
  val chosen=selected.associateBy { it.optString(if(kind=="resource") "resource_id" else "mob_id") }
  for(occ in rows(catalog.getJSONArray("zone_occurrences"))) {
    val item=chosen[occ.optString(if(kind=="resource") "resource_id" else "mob_id")] ?: continue
    if(occ.isNull("theoretical_quantity")) continue
    if(enchantment != -1 && (occ.isNull("enchantment") || occ.getInt("enchantment")!=enchantment)) continue
    val z=byId[occ.getString("zone_id")] ?: continue
    val risk=z.getString("risk"); if(risk in excluded) continue
    val biome=z.getString("biome")
    val ids=routes.getOrPut(z.getString("id")) { graph.route(origin.getString("id"),z.getString("id"),policy,excluded) }
    val hazards=ids.count { byId[it]!!.getString("risk") in setOf("red","black","unknown") }
    val path=if(ids.isEmpty()) JSONObject().put("status","unreachable").put("zoneIds",JSONArray()).put("transitions",JSONObject.NULL)
     else JSONObject().put("status","found").put("zoneIds",JSONArray(ids)).put("transitions",ids.size-1).put("hazardZones",hazards)
    val refs=(strings(item.getJSONArray("source_refs"))+strings(occ.getJSONArray("source_refs"))).distinct().mapNotNull { sources[it] }
    val total=totals[z.getString("id")]
    val proportion=if(total==null || occ.isNull("resource_id")) JSONObject.NULL else JSONObject()
     .put("percent",100.0*occ.getJSONObject("theoretical_quantity").getDouble("value")/total.getDouble("value"))
     .put("numerator",occ.getJSONObject("theoretical_quantity").getDouble("value"))
     .put("denominator",total.getDouble("value"))
     .put("basis","share_of_documented_zone_nodes_all_tiers_and_enchantments")
    candidates.add(JSONObject().put("zoneId",z.getString("id")).put("zoneName",z.getString("name")).put("biome",biome).put("risk",risk).put("tier",z.getInt("tier"))
     .put("matchedName",item.getString("name")).put("resourceTier",occ.opt("tier") ?: JSONObject.NULL).put("resourceId",occ.opt("resource_id") ?: JSONObject.NULL).put("mobId",occ.opt("mob_id") ?: JSONObject.NULL)
     .put("spawnType",occ.getString("spawn_type")).put("enchantment",occ.opt("enchantment") ?: JSONObject.NULL).put("evidence","documented").put("confidence",occ.getString("confidence"))
     .put("theoreticalQuantity",occ.getJSONObject("theoretical_quantity")).put("theoreticalProportion",proportion).put("sourceRefs",JSONArray(refs)).put("route",path))
  }
  val comparable=candidates.map { val n=it.getJSONObject("theoreticalQuantity"); Triple(it.getString("matchedName"),n.getString("unit"),n.getString("scope")) }.distinct().size==1
  val sorted=candidates.sortedWith(compareBy<JSONObject> { if(it.getJSONObject("route").getString("status")=="found") 0 else 1 }
   .thenBy { if(policy=="fewest_lethal") it.getJSONObject("route").optInt("hazardZones",Int.MAX_VALUE) else 0 }
   .thenByDescending { if(comparable) it.getJSONObject("theoreticalQuantity").getDouble("value") else 0.0 }
   .thenBy { if(it.getJSONObject("route").getString("status")=="found") it.getJSONObject("route").getInt("transitions") else Int.MAX_VALUE }
   .thenBy { it.getString("zoneId") }.thenBy { it.getString("matchedName") }).take(30)
  val warnings=listOf("Third-party theoretical node counts are static estimates, not live availability, guaranteed spawn or harvest yield. Source and game-data versions can differ.","Routes count transitions, not travel distance; safety is not guaranteed. Enchantment-specific zone quantities are unavailable.")
  return answer(if(sorted.isEmpty()) "no_data" else "ok",warnings,sorted).put("request",JSONObject().put("query",p.getString("query")).put("kind",kind).put("tier",tier).put("enchantment",enchantment).put("startZoneId",origin.getString("id")).put("policy",policy).put("excludedRisks",JSONArray(excluded.sorted())))
 }
 /** Compact, lossless-for-the-model projection of the ranked planner result.
  * Source URLs are listed once; each result references zero-based source indexes. */
 private fun compact(full:JSONObject, params:JSONObject):JSONObject {
  val request=full.optJSONObject("request") ?: JSONObject().apply {
   for (key in listOf("query","kind","tier","enchantment","startZoneId","excludedRisks","policy")) put(key,params.get(key))
  }
  val urls=mutableListOf<String>()
  val result=JSONArray()
  for (item in rows(full.getJSONArray("results"))) {
   val refs=JSONArray()
   for (url in strings(item.getJSONArray("sourceRefs"))) {
    var index=urls.indexOf(url)
    if(index<0) { urls.add(url); index=urls.lastIndex }
    refs.put(index)
   }
   val route=item.getJSONObject("route")
   result.put(JSONObject().put("zoneId",item.getString("zoneId")).put("zoneName",item.getString("zoneName")).put("biome",item.getString("biome")).put("zoneTier",item.getInt("tier"))
    .put("kind",request.getString("kind")).put("resourceId",item.get("resourceId")).put("mobId",item.get("mobId"))
    .put("name",item.getString("matchedName")).put("tier",item.get("resourceTier")).put("enchantment",item.get("enchantment"))
    .put("quantity",item.get("theoreticalQuantity")).put("theoreticalProportion",item.get("theoreticalProportion")).put("confidence",item.getString("confidence")).put("risk",item.getString("risk"))
    .put("route",JSONObject().put("status",route.getString("status")).put("zoneIds",route.getJSONArray("zoneIds")).put("transitions",route.get("transitions")))
    .put("sourceIndexes",refs))
  }
  val warnings=JSONArray()
  if(full.getString("status")!="ok") for (warning in strings(full.getJSONArray("warnings"))) warnings.put(warning)
  else if(strings(full.getJSONArray("warnings")).any { it.startsWith("No enchantment filter was supplied") }) warnings.put("No enchantment filter was supplied; do not claim a specific level was applied.")
  warnings.put("Static estimates, not live availability, yield or safety. Null enchantment counts combine all enchantments. Routes count zone transitions, not distance.")
  return JSONObject().put("status",full.getString("status")).put("request",request).put("results",result)
   .put("sources",JSONArray(urls)).put("warnings",warnings)
 }
 private fun makeTool(compactResult:Boolean) = object: OpenApiTool {
  override fun getToolDescriptionJsonString() = """{"name":"plan_gathering","description":"Find zones with a documented resource tier and theoretical node count, with computed static routes and uncertainty. Counts are not live availability or harvest yield. Use tier 0 and enchantment -1 for unspecified values; startZoneId may be a zone ID or exact name. Excluded risks apply to every zone on the route.","parameters":{"type":"object","properties":{"query":{"type":"string"},"kind":{"type":"string","enum":["resource","creature","mob"]},"tier":{"type":"integer"},"enchantment":{"type":"integer"},"startZoneId":{"type":"string"},"excludedRisks":{"type":"array","items":{"type":"string","enum":["blue","yellow","red","black","city","unknown"]}},"policy":{"type":"string","enum":["fewest_transitions","fewest_lethal"]}},"required":["query","kind","tier","enchantment","startZoneId","excludedRisks","policy"]}}"""
  override fun execute(paramsJsonString:String):String {
   if(BuildConfig.DEBUG) Log.d("PlanTool", "invoked")
   return try {
    val params=JSONObject(paramsJsonString)
    if(BuildConfig.DEBUG) {
     val keys=listOf("query","kind","tier","enchantment","startZoneId","excludedRisks","policy")
     val shape=keys.joinToString(" ") { key -> val value=params.opt(key); val type=when(value) { null,JSONObject.NULL -> "missing"; is String -> "string"; is Number -> "number"; is JSONArray -> "array"; is Boolean -> "boolean"; else -> "object" }; "$key=$type" }
     Log.d("PlanTool", "argument types: $shape")
    }
    // Some local models omit this optional filter even when the tool schema
    // requests the explicit -1 sentinel. Never infer a particular enchantment.
    val enchantmentOmitted=!params.has("enchantment") || params.isNull("enchantment")
    if(enchantmentOmitted) params.put("enchantment",-1)
    val result=search(params)
    if(enchantmentOmitted) result.getJSONArray("warnings").put("No enchantment filter was supplied; results combine all enchantment levels. Do not claim a specific enchantment was applied.")
    if(BuildConfig.DEBUG) Log.d("PlanTool", "completed: " + result.getString("status"))
    (if(compactResult) compact(result,params) else result).toString()
   } catch (error:Exception) {
    if(BuildConfig.DEBUG) Log.d("PlanTool", "invalid or unavailable: " + error.javaClass.simpleName)
    JSONObject().put("error","PLAN_INVALID_OR_UNAVAILABLE").toString()
   }
  }
 }
 val tool: OpenApiTool = makeTool(false)
 val localTool: OpenApiTool = makeTool(true)
 /** Compact lookup by exact zone name or canonical id; missing data is never zero. */
 fun zoneResources(zone:String):JSONObject {
  require(catalogFingerprint == expectedCatalogFingerprint) { "PLAN_CATALOG_MISMATCH" }
  require(zone.isNotBlank() && zone.length<=120)
  val z=byId[zone.trim()] ?: zones.find { norm(it.getString("name"))==norm(zone) }
   ?: return JSONObject().put("status","invalid_zone").put("resources",JSONArray())
  val id=z.getString("id"); val total=totals[id]
  val items=rows(catalog.getJSONArray("resources")).associateBy { it.getString("resource_id") }
  val resources=JSONArray(); val urls=linkedSetOf<String>()
  for(o in rows(catalog.getJSONArray("zone_occurrences"))) {
   if(o.getString("zone_id")!=id || o.isNull("resource_id") || o.isNull("theoretical_quantity")) continue
   val item=items[o.getString("resource_id")] ?: continue
   val quantity=o.getJSONObject("theoretical_quantity").getDouble("value")
   val percent=if(total==null) JSONObject.NULL else 100.0*quantity/total.getDouble("value")
   strings(o.getJSONArray("source_refs")).mapNotNullTo(urls) { sources[it] }
   resources.put(JSONObject().put("resourceId",item.getString("resource_id")).put("category",item.getString("category"))
    .put("name",item.getString("name")).put("tier",o.getInt("tier")).put("nodes",quantity).put("zonePercent",percent))
  }
  return JSONObject().put("status",if(resources.length()==0) "no_data" else if(total==null) "partial" else "ok")
   .put("zoneId",id).put("zoneName",z.getString("name")).put("risk",z.getString("risk"))
   .put("totalNodes",total?.getDouble("value") ?: JSONObject.NULL).put("resources",resources).put("sources",JSONArray(urls.toList()))
   .put("percentBasis","share of documented theoretical nodes in this zone, all tiers and enchantments combined")
   .put("warning","Static third-party estimates, not live availability, yield or a guarantee. Missing data is unknown.")
 }
 val zoneResourcesTool:OpenApiTool = object:OpenApiTool {
  override fun getToolDescriptionJsonString() = """{"name":"get_zone_resources","description":"Look up documented resource types, tiers and theoretical percentage for one exact zone name or ID. Percentages are shares of the zone's theoretical nodes across all tiers and enchantments, not live spawn probabilities or yield. No data means unknown, not absent.","parameters":{"type":"object","properties":{"zone":{"type":"string"}},"required":["zone"]}}"""
  override fun execute(paramsJsonString:String):String = try { zoneResources(JSONObject(paramsJsonString).getString("zone")).toString() } catch (_:Exception) { JSONObject().put("error","ZONE_RESOURCES_INVALID_OR_UNAVAILABLE").toString() }
 }
}
