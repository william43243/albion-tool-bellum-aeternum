package com.albion.market.litert

import org.json.JSONArray
import org.json.JSONObject
import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.LinkedHashMap
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

class ProductionScenarioException(val code: String, message: String) : IllegalArgumentException(message)

/** Process-local user-approved copies; never reads/writes personal saved plans. */
object ProductionScenarioRegistry {
 private const val APPROVAL_MS = 30 * 60 * 1000L
 private const val MAX_PRICE_AGE_MS = 60 * 60 * 1000L
 private const val FUTURE_TOLERANCE_MS = 5 * 60 * 1000L
 private const val MAX_APPROVALS = 64
 private data class Entry(val scenario: String, val expiresAt: Long)
 private val approved = LinkedHashMap<String, Entry>()

 private fun invalid(code: String, message: String): Nothing = throw ProductionScenarioException(code, message)
 private fun timestamp(value: String): Long {
  val match = Regex("^(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2})(?:\\.(\\d{1,9}))?(Z|[+-]\\d{2}:\\d{2})?$").matchEntire(value.trim())
   ?: invalid("INVALID_PRICE_EVIDENCE", "Invalid observation timestamp.")
  val fraction = match.groupValues[2].padEnd(3, '0').take(3)
  val zone = match.groupValues[3].ifEmpty { "Z" }
  val normalized = "${match.groupValues[1]}.$fraction$zone"
  val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).apply { isLenient = false; timeZone = TimeZone.getTimeZone("UTC") }
  val position = ParsePosition(0)
  val parsed = formatter.parse(normalized, position)
  if (parsed == null || position.index != normalized.length) invalid("INVALID_PRICE_EVIDENCE", "Invalid observation timestamp.")
  return parsed.time
 }

 /** Check caller-declared AODP metadata, without asserting source authenticity. */
 fun validateEvidence(scenario: JSONObject, now: Long = System.currentTimeMillis()): Long {
  val evidence = if (!scenario.has("priceEvidence")) JSONArray() else scenario.opt("priceEvidence") as? JSONArray ?: invalid("INVALID_PRICE_EVIDENCE", "Price evidence must be an array.")
  if (evidence.length() > 65) invalid("INVALID_PRICE_EVIDENCE", "Too many price observations.")
  val materials = scenario.getJSONArray("materials")
  val metadata = scenario.optJSONObject("metadata")
  val seen = HashSet<String>()
  var expires = now + APPROVAL_MS
  val fields = setOf("key", "itemId", "source", "server", "city", "quality", "side", "value", "observedAt", "fetchedAt")
  val cities = setOf("Caerleon", "Bridgewatch", "Fort Sterling", "Lymhurst", "Thetford", "Martlock", "Brecilien")
  var declaredServer: String? = null
  for (i in 0 until evidence.length()) {
   val e = evidence.opt(i) as? JSONObject ?: invalid("INVALID_PRICE_EVIDENCE", "Invalid price observation.")
   if (e.keys().asSequence().toSet() != fields || e.opt("source") != "AODP" || e.opt("server") !in setOf("americas", "europe", "asia") || e.opt("city") !in cities)
    invalid("INVALID_PRICE_EVIDENCE", "Invalid price observation provenance.")
   val server=e.getString("server")
   if(declaredServer!=null && declaredServer!=server) invalid("INVALID_PRICE_EVIDENCE", "Observations from different servers cannot be mixed.")
   declaredServer=server
   val key = e.opt("key") as? String ?: invalid("INVALID_PRICE_EVIDENCE", "Invalid observation key.")
   val id = e.opt("itemId") as? String ?: invalid("INVALID_PRICE_EVIDENCE", "Invalid item identifier.")
   if (!id.matches(Regex("[A-Z0-9_@.-]{1,100}")) || !seen.add(key)) invalid("INVALID_PRICE_EVIDENCE", "Duplicate or invalid observation.")
   val quality = e.opt("quality")
   if (quality !is Number || quality.toDouble() % 1.0 != 0.0 || quality.toDouble() !in 1.0..5.0) invalid("INVALID_PRICE_EVIDENCE", "Invalid quality.")
   val expected: Double
   if (key == "output") {
    if (e.opt("side") !in setOf("saleImmediate", "saleOrderReference")) invalid("INVALID_PRICE_EVIDENCE", "Invalid sale side.")
    if (metadata!=null && ((metadata.has("outputItemId") && metadata.getString("outputItemId")!=id) || (metadata.has("sellCity") && metadata.getString("sellCity")!=e.optString("city")) || (metadata.has("quality") && metadata.getInt("quality")!=quality.toInt()) || (metadata.has("saleSide") && metadata.getString("saleSide")!=e.optString("side")))) invalid("INVALID_PRICE_EVIDENCE", "Sale observation does not match declared metadata.")
    expected = scenario.getDouble("outputUnitPrice")
   } else {
    val matches = (0 until materials.length()).map { materials.getJSONObject(it) }.filter { key == "material:${it.optString("itemId")}" }
    if (matches.size != 1 || matches[0].optString("itemId") != id || e.opt("side") != "purchaseImmediate") invalid("INVALID_PRICE_EVIDENCE", "Material evidence does not match the scenario.")
    if (metadata!=null && metadata.has("buyCity") && metadata.getString("buyCity")!=e.optString("city")) invalid("INVALID_PRICE_EVIDENCE", "Material observation does not match the declared city.")
    expected = matches[0].getDouble("unitPrice")
   }
   val price = e.opt("value")
   if (price !is Number || !price.toDouble().isFinite() || price.toDouble() <= 0 || price.toDouble() != expected) invalid("INVALID_PRICE_EVIDENCE", "Observed price does not match the scenario.")
   val at = timestamp(e.opt("observedAt") as? String ?: invalid("INVALID_PRICE_EVIDENCE", "Missing observation timestamp."))
   val fetchedRaw = e.opt("fetchedAt")
   if (fetchedRaw !is Number || !fetchedRaw.toDouble().isFinite() || fetchedRaw.toDouble() < 1 || fetchedRaw.toDouble() > Long.MAX_VALUE.toDouble()) invalid("INVALID_PRICE_EVIDENCE", "Invalid fetch timestamp.")
   val fetched = fetchedRaw.toLong()
   if (at > now + FUTURE_TOLERANCE_MS || fetched > now + FUTURE_TOLERANCE_MS || at > fetched + FUTURE_TOLERANCE_MS) invalid("INVALID_PRICE_EVIDENCE", "Price timestamp is in the future.")
   if (now - at > MAX_PRICE_AGE_MS) invalid("STALE_PRICE", "An identified observation is older than one hour.")
   expires = minOf(expires, at + MAX_PRICE_AGE_MS)
  }
  if (scenario.has("volumeEvidence")) {
   val e=scenario.opt("volumeEvidence") as? JSONObject ?: invalid("INVALID_VOLUME_EVIDENCE", "Volume evidence must be an object.")
   val volumeFields=setOf("source","server","itemId","city","quality","observedAt","fetchedAt","startMs","endMs","observedBuckets","requestedDays","observedUnits")
   if(e.keys().asSequence().toSet()!=volumeFields || e.opt("source")!="AODP" || e.opt("server") !in setOf("americas","europe","asia") || e.opt("city") !in cities)
    invalid("INVALID_VOLUME_EVIDENCE", "Invalid volume provenance.")
   if(declaredServer!=null && declaredServer!=e.getString("server")) invalid("INVALID_VOLUME_EVIDENCE", "Observations from different servers cannot be mixed.")
   val id=e.opt("itemId") as? String ?: invalid("INVALID_VOLUME_EVIDENCE", "Invalid item identifier.")
   if(!id.matches(Regex("[A-Z0-9_@.-]{1,100}"))) invalid("INVALID_VOLUME_EVIDENCE", "Invalid item identifier.")
   fun numeric(key:String):Double {
    val raw=e.opt(key)
    if(raw !is Number || !raw.toDouble().isFinite() || raw.toDouble()<0 || raw.toDouble()>9_000_000_000_000_000.0) invalid("INVALID_VOLUME_EVIDENCE", "Invalid volume evidence field.")
    return raw.toDouble()
   }
   val quality=numeric("quality"); val days=numeric("requestedDays"); val buckets=numeric("observedBuckets")
   val fetched=numeric("fetchedAt"); val at=numeric("observedAt"); val start=numeric("startMs"); val end=numeric("endMs"); val units=numeric("observedUnits")
   if(quality % 1 != 0.0 || quality !in 1.0..5.0 || days % 1 != 0.0 || days !in 1.0..90.0 || buckets != days || units % 1 != 0.0 || fetched % 1 != 0.0 ||
      at % 86400000.0 != 0.0 || start % 86400000.0 != 0.0 || end % 86400000.0 != 0.0 || end-start != days*86400000.0 || end != (now/86400000L)*86400000.0 || at < start || at >= end ||
      fetched < 1 || fetched > now + FUTURE_TOLERANCE_MS || at > fetched + FUTURE_TOLERANCE_MS || scenario.isNull("volumeObserved") || scenario.isNull("volumeDays") || scenario.getDouble("volumeObserved") != units || scenario.getDouble("volumeDays") != days)
    invalid("INVALID_VOLUME_EVIDENCE", "Volume evidence does not match the scenario or history window.")
   if(metadata!=null && ((metadata.has("outputItemId") && metadata.getString("outputItemId")!=id) || (metadata.has("sellCity") && metadata.getString("sellCity")!=e.optString("city")) || (metadata.has("quality") && metadata.getInt("quality")!=quality.toInt()))) invalid("INVALID_VOLUME_EVIDENCE", "History does not match declared metadata.")
   if(now-fetched > MAX_PRICE_AGE_MS) invalid("STALE_VOLUME", "The identified history snapshot is older than one hour.")
   val output=(0 until evidence.length()).map { evidence.getJSONObject(it) }.find { it.optString("key")=="output" }
   if(output!=null && (output.optString("itemId")!=id || output.optString("server")!=e.optString("server") || output.optString("city")!=e.optString("city") || output.optInt("quality")!=quality.toInt()))
    invalid("INVALID_VOLUME_EVIDENCE", "History does not match the output quote.")
   expires=minOf(expires, fetched.toLong()+MAX_PRICE_AGE_MS, end.toLong()+86400000L)
  }
  return expires
 }

 @Synchronized fun approve(scenario: JSONObject, expectedServer: String? = null): JSONObject {
  val now = System.currentTimeMillis()
  ProductionTools.validateScenario(scenario)
  requireServer(scenario, expectedServer)
  val check = ProductionEngine().execute("calculate_crafting_profit", JSONObject().put("scenario", scenario))
  if (check.optString("status") != "ok") return JSONObject().put("status", "error").put("error", check.getJSONObject("error"))
  val expires = validateEvidence(scenario, now)
  prune(now)
  if (approved.size >= MAX_APPROVALS) return JSONObject().put("status", "error").put("error", JSONObject().put("code", "REGISTRY_FULL").put("message", "Too many approved scenarios; wait for expiry."))
  val id = UUID.randomUUID().toString()
  approved[id] = Entry(scenario.toString(), expires)
  return JSONObject().put("status", "ok").put("scenarioId", id).put("expiresAtMs", expires)
 }
 private fun serverOf(scenario: JSONObject): String? {
  val evidence=scenario.optJSONArray("priceEvidence")
  return if(evidence!=null && evidence.length()>0) evidence.getJSONObject(0).getString("server") else scenario.optJSONObject("volumeEvidence")?.optString("server")
 }
 fun requireServer(scenario: JSONObject, expectedServer: String?) {
  if(expectedServer!=null && expectedServer !in setOf("americas","europe","asia")) invalid("INVALID_ARGUMENT", "Invalid active server.")
  val declaredServer=serverOf(scenario)
  if(expectedServer!=null && declaredServer!=null && declaredServer!=expectedServer) invalid("SCENARIO_SERVER_MISMATCH", "Scenario observations belong to a different server.")
 }
 @Synchronized fun resolve(id: String, expectedServer: String? = null): JSONObject {
  val now = System.currentTimeMillis()
  val entry = approved[id] ?: invalid("SCENARIO_UNAVAILABLE", "Scenario is not approved or has expired.")
  if (now > entry.expiresAt) { approved.remove(id); invalid("SCENARIO_UNAVAILABLE", "Scenario is not approved or has expired.") }
  val scenario = JSONObject(entry.scenario)
  try { validateEvidence(scenario, now) } catch (e: ProductionScenarioException) { approved.remove(id); throw e }
  requireServer(scenario, expectedServer)
  return scenario
 }
 @Synchronized fun list(expectedServer: String? = null): JSONArray {
  val now = System.currentTimeMillis(); prune(now)
  val output = JSONArray()
  for ((id, entry) in approved) {
   val scenario=JSONObject(entry.scenario); val server=serverOf(scenario)
   if(expectedServer==null || server==null || server==expectedServer) output.put(JSONObject().put("scenarioId", id).put("label", scenario.getString("label")).put("expiresAtMs", entry.expiresAt))
  }
  return output
 }
 private fun prune(now: Long) { val iterator=approved.entries.iterator(); while (iterator.hasNext()) if (now > iterator.next().value.expiresAt) iterator.remove() }
}
