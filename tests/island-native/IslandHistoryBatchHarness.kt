import com.albion.market.litert.IslandHistoryBatch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset

private const val DAY = 86_400_000L
private val now = Instant.parse("2026-11-18T02:00:00Z").toEpochMilli()
private val end = Math.floorDiv(now, DAY) * DAY
private val start = end - 90 * DAY
private fun request(ids: List<String> = listOf("T1_CARROT", "T2_AGARIC", "T3_WHEAT")) = JSONObject()
 .put("item_ids", JSONArray(ids)).put("city", "Fort Sterling").put("days", 90)
private fun sample(id: String, extraBoundary: Boolean = false): JSONObject {
 val data = JSONArray()
 for (day in 0 until 90) data.put(JSONObject().put("timestamp", Instant.ofEpochMilli(start + day * DAY).toString())
  .put("avg_price", 100 + day).put("item_count", 10))
 if (extraBoundary) data.put(JSONObject().put("timestamp", Instant.ofEpochMilli(end).toString()).put("avg_price", 999999).put("item_count", 10))
 return JSONObject().put("item_id", id).put("location", "Fort Sterling").put("quality", 1).put("data", data)
}
private fun find(result: JSONObject, id: String): JSONObject {
 val rows = result.getJSONArray("results")
 return (0 until rows.length()).map { rows.getJSONObject(it) }.single { it.getString("item_id") == id }
}
fun main() {
 var calls = 0; var url = ""
 val service = IslandHistoryBatch("americas", { requested -> calls++; url = requested
  JSONArray().put(sample("T1_CARROT", true)).put(sample("T2_AGARIC")).toString()
 }, { Instant.parse(it).toEpochMilli() }, { now })
 val result = service.get(request())
 check(result.getString("status") == "ok" && calls == 1)
 check(url.contains("T1_CARROT,T2_AGARIC,T3_WHEAT.json") && url.contains("date=2026-08-20") && url.contains("end_date=2026-11-18"))
 check(result.getInt("requested_days") == 90 && result.getString("city") == "Fort Sterling")
 val carrot = find(result, "T1_CARROT")
 check(carrot.getString("status") == "ok" && carrot.getInt("usable_days") == 90 && carrot.getInt("missing_days") == 0)
 check(carrot.getInt("average") == 144 && carrot.getJSONArray("observations").length() == 90)
 check(find(result, "T3_WHEAT").getString("status") == "MISSING")
 val bad = service.get(request().put("item_ids", JSONArray().put("../evil")))
 check(bad.getJSONObject("error").getString("code") == "INVALID_DATA" && calls == 1)
 val duplicate = IslandHistoryBatch("americas", { JSONArray().put(sample("T1_CARROT")).put(sample("T1_CARROT")).toString() },
  { Instant.parse(it).toEpochMilli() }, { now }).get(request(listOf("T1_CARROT")))
 check(find(duplicate, "T1_CARROT").getString("status") == "INVALID_DATA")
 val throttled = IslandHistoryBatch("americas", { throw IllegalStateException("AODP HTTP 429") },
  { Instant.parse(it).toEpochMilli() }, { now }).get(request())
 check(throttled.getJSONObject("error").getString("code") == "RATE_LIMITED")
 check(service.get(request()) { true }.getJSONObject("error").getString("code") == "CANCELLED")
 check(calls == 1)
 val fixture = System.getenv("ISLAND_HISTORY_FIXTURE")
 if (!fixture.isNullOrBlank()) {
  val raw = File(fixture).readText()
  val ids = listOf("T1_CARROT", "T2_BEAN", "T3_WHEAT", "T4_TURNIP", "T5_CABBAGE", "T6_POTATO", "T7_CORN", "T8_PUMPKIN", "T2_AGARIC", "T3_COMFREY", "T4_BURDOCK", "T5_TEASEL", "T6_FOXGLOVE", "T7_MULLEIN", "T8_YARROW")
  val replayNow = System.getenv("ISLAND_HISTORY_NOW")?.let { Instant.parse(it).toEpochMilli() } ?: System.currentTimeMillis()
  val replay = IslandHistoryBatch("americas", { raw }, { LocalDateTime.parse(it).toInstant(ZoneOffset.UTC).toEpochMilli() }, { replayNow }).get(request(ids))
  check(replay.getString("status") == "ok" && replay.getJSONArray("results").length() == 15)
  check(ids.all { find(replay, it).getString("status") == "ok" })
  println("LIVE HISTORY REPLAY: all 15 responses parsed with the requested 90-day boundaries")
 }
 println("ISLAND HISTORY BATCH JVM: single request, 90-day bounds, coverage, malformed and throttled data passed")
}
