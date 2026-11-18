import com.albion.market.litert.IslandTools
import com.albion.market.litert.IslandHistoryBatch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.Instant
import kotlin.math.abs

private fun request() = JSONObject("""{
 "server":"americas","island_city":"Fort Sterling","market_city":"Fort Sterling",
 "plot_count":9,"premium":true,"focus_budget":0,"focus_per_plant":null,
 "history_days":90,"category":null,"crop_ids":null,"show_chart":false
}""")
private fun source() = JSONObject(File("assets/island/farmables.json").readText())
private fun prices() = JSONObject(File("assets/island/npc-prices.json").readText())
private fun rows(result: JSONObject) = result.getJSONArray("candidates").let { a -> (0 until a.length()).map { a.getJSONObject(it) } }
private fun selected(row: JSONObject) = row.getString("product_id")

fun main() {
 var calls = 0
 var lastQuery = JSONObject()
 var missingId: String? = null
 var rateLimited = false
 val market: (JSONObject, () -> Boolean) -> JSONObject = { q, _ ->
  calls++; lastQuery = JSONObject(q.toString())
  if (rateLimited) JSONObject().put("status", "error").put("error", JSONObject().put("code", "RATE_LIMITED"))
  else {
   val ids = q.getJSONArray("item_ids"); val data = JSONArray()
   for (i in 0 until ids.length()) {
    val id = ids.getString(i)
    if (id != missingId) data.put(JSONObject().put("item_id", id).put("status", "ok").put("average", 400 + i)
      .put("usable_days", 88).put("missing_days", 2).put("last_observed", "2026-11-16T00:00:00Z")
      .put("observations", JSONArray().put(JSONArray().put(0).put(400 + i).put(10))
       .put(JSONArray().put(1).put(420 + i).put(10)).put(JSONArray().put(3).put(430 + i).put(10))))
   }
   JSONObject().put("status", "ok").put("server", "americas").put("source", "https://west.albion-online-data.com/api/v2/stats")
    .put("city", q.getString("city")).put("quality", 1).put("requested_days", q.getInt("days")).put("results", data)
  }
 }
 val tool = IslandTools.all(::source, ::prices, { _, _ -> error("legacy history must not be used") }, "americas", { false }, market)
  .first { JSONObject(it.getToolDescriptionJsonString()).getString("name") == "compare_island_crops" }
 fun run(p: JSONObject) = JSONObject(tool.execute(p.toString()))
 fun countQuery() = lastQuery.getJSONArray("item_ids").length()

 val all = run(request())
 check(all.getString("status") == "ok" && calls == 1 && countQuery() == 15)
 check(lastQuery.getInt("days") == 90 && lastQuery.getString("city") == "Fort Sterling")
 check(all.getInt("plot_count") == 9 && all.getInt("total_planting_positions") == 81)
 check(all.getString("ranking_scope") == "all_requested_crops" && rows(all).size == 15)
 check(rows(all).count { it.getString("building") == "farm" } == 8)
 check(rows(all).count { it.getString("building") == "herbgarden" } == 7)
 val turnip = rows(all).single { selected(it) == "T4_TURNIP" }
 check(turnip.getInt("city_bonus_percent") == 10 && abs(turnip.getDouble("expected_harvest_per_cycle") - 801.9) < 0.0001)
 check(turnip.getInt("history_usable_days") == 88 && turnip.getInt("history_missing_days") == 2)
 check(turnip.getDouble("initial_seed_cost_if_all_purchased") == 81.0 * 7500)
 val turnipPrice = turnip.getDouble("history_average")
 val expected = 801.9 * turnipPrice * .935 - 81 * (1 - .7333) * 7500
 check(abs(turnip.getDouble("estimated_profit_per_cycle") - expected) < .001)

 val subset = request().put("crop_ids", JSONArray().put("T4_TURNIP").put("T8_FARM_YARROW_SEED").put("T2_AGARIC"))
 val selectedResult = run(subset)
 check(calls == 2 && countQuery() == 3 && selectedResult.getString("selection") == "explicit_crops_only")
 check(rows(selectedResult).map(::selected).toSet() == setOf("T4_TURNIP", "T8_YARROW", "T2_AGARIC"))
 val only = run(request().put("crop_ids", JSONArray().put("T3_WHEAT")))
 check(calls == 3 && countQuery() == 1 && rows(only).single().getString("product_id") == "T3_WHEAT")
 val herb = run(request().put("category", "herbgarden"))
 check(calls == 4 && countQuery() == 7 && rows(herb).all { it.getString("building") == "herbgarden" })
 val bad = run(request().put("crop_ids", JSONArray().put("T4_FAKE")))
 check(bad.getJSONObject("error").getString("code") == "UNKNOWN_CROP" && calls == 4)
 val conflict = run(request().put("category", "farm").put("crop_ids", JSONArray().put("T2_AGARIC")))
 check(conflict.getJSONObject("error").getString("code") == "SELECTION_CONFLICT" && calls == 4)
 val duplicate = run(request().put("crop_ids", JSONArray().put("T3_WHEAT").put("T3_FARM_WHEAT_SEED")))
 check(duplicate.getJSONObject("error").getString("code") == "DUPLICATE_CROP" && calls == 4)
 val needCity = run(request().put("island_city", JSONObject.NULL))
 check(needCity.getString("status") == "needs_input" && calls == 4)
 check(runCatching { IslandTools.validateToolRequest("compare_island_crops", request().put("server", "europe"), "americas") }.isFailure)
 check(runCatching { IslandTools.validateToolRequest("compare_island_crops", request().put("price", 1), "americas") }.isFailure)

 missingId = "T2_AGARIC"
 val partial = run(subset)
 check(partial.getString("status") == "partial" && partial.getInt("missing_count") == 1)
 check(rows(partial).single { selected(it) == "T2_AGARIC" }.isNull("estimated_profit_per_cycle"))
 check(partial.getString("ranking_scope") == "available_crops_only")
 missingId = null; rateLimited = true
 val throttled = run(subset)
 check(throttled.getString("status") == "partial" && throttled.getInt("ranked_available_count") == 0)
 check(throttled.getJSONObject("history").getJSONObject("error").getString("code") == "RATE_LIMITED")
 check(rows(throttled).all { it.isNull("history_average") && it.isNull("estimated_profit_per_cycle") })

 rateLimited = false
 val focus = run(request().put("crop_ids", JSONArray().put("T1_CARROT")).put("focus_budget", 81_000))
 check(countQuery() == 2 && rows(focus).single().getInt("watered_positions") == 81)
 check(rows(focus).single().getDouble("mean_surplus_seeds") == 81.0)
 val graph = run(subset.put("show_chart", true))
 check(graph.getBoolean("chart_requested") && rows(graph).size == 3)
 val graphTurnip = rows(graph).single { selected(it) == "T4_TURNIP" }
 val graphPoints = graphTurnip.getJSONArray("profit_history")
 check(graphPoints.length() == 3 && graphPoints.getJSONArray(0).getInt(0) == 0 && graphPoints.getJSONArray(2).getInt(0) == 3)
 check(abs(graphPoints.getJSONArray(0).getDouble(1) - (801.9 * 400 * .935 - 81 * (1 - .7333) * 7500)) < .01)
 missingId = "T1_FARM_CARROT_SEED"
 val missingSeedGraph = run(request().put("crop_ids", JSONArray().put("T1_CARROT")).put("focus_budget", 81_000).put("show_chart", true))
 check(rows(missingSeedGraph).single().getJSONArray("profit_history").length() == 0)
 missingId = null
 val focusGraph = run(request().put("crop_ids", JSONArray().put("T1_CARROT")).put("focus_budget", 81_000).put("show_chart", true))
 check(rows(focusGraph).single().getJSONArray("profit_history").length() == 3)
 val fixture = System.getenv("ISLAND_HISTORY_FIXTURE")
 if (!fixture.isNullOrBlank()) {
  val raw = File(fixture).readText(); var liveCalls = 0
  val replayNow = System.getenv("ISLAND_HISTORY_NOW")?.let { Instant.parse(it).toEpochMilli() } ?: System.currentTimeMillis()
  val batch = IslandHistoryBatch("americas", { liveCalls++; raw }, { LocalDateTime.parse(it).toInstant(ZoneOffset.UTC).toEpochMilli() }, { replayNow })
  val liveTool = IslandTools.all(::source, ::prices, { _, _ -> error("unexpected legacy history") }, "americas", { false }, { q, stop -> batch.get(q, stop) })
   .first { JSONObject(it.getToolDescriptionJsonString()).getString("name") == "compare_island_crops" }
  val liveText = liveTool.execute(request().put("show_chart", true).toString()); val liveResult = JSONObject(liveText)
  check(liveCalls == 1 && liveResult.getString("status") == "ok" && liveResult.getInt("ranked_available_count") == 15)
  check(liveResult.getJSONObject("history").getInt("requested_days") == 90 && liveText.length < 120_000)
  check(rows(liveResult).all { it.getInt("history_usable_days") in 1..90 })
  check(rows(liveResult).all { it.getJSONArray("profit_history").length() in 1..90 })
  println("LIVE COMPARISON REPLAY: 15 real Fort Sterling histories compared in one request, ${liveText.length} characters")
 }
 println("ISLAND COMPARISON JVM: all 15, 90 days, one and multiple explicit crops, fees, missing data and focus passed")
}
