package com.albion.market.litert

import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.CancellationException

/** One bounded AODP request for all selected crop products, not one request per crop. */
class IslandHistoryBatch(
    private val server: String,
    private val fetch: (String) -> String,
    private val parseTimestamp: (String) -> Long,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    companion object {
        private val sources = mapOf(
            "americas" to "https://west.albion-online-data.com/api/v2/stats",
            "europe" to "https://europe.albion-online-data.com/api/v2/stats",
            "asia" to "https://east.albion-online-data.com/api/v2/stats",
        )
        private val cities = setOf("Caerleon", "Bridgewatch", "Fort Sterling", "Lymhurst", "Thetford", "Martlock", "Brecilien")
        private fun encode(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
        private fun stamp(ms: Long) = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date(ms))
        private fun date(ms: Long) = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date(ms))
        private fun error(code: String, message: String) = JSONObject().put("status", "error")
            .put("error", JSONObject().put("code", code).put("message", message))
    }

    init { require(server in sources) { "Unsupported server" } }

    fun get(request: JSONObject, cancelled: () -> Boolean = { false }): JSONObject {
        fun active() { if (cancelled() || Thread.currentThread().isInterrupted) throw CancellationException() }
        try {
            active()
            require(request.keys().asSequence().toSet() == setOf("item_ids", "city", "days"))
            val rawIds = request.getJSONArray("item_ids")
            require(rawIds.length() in 1..30)
            val ids = LinkedHashSet<String>()
            for (i in 0 until rawIds.length()) {
                val value = rawIds.get(i)
                require(value is String && value.matches(Regex("[A-Z0-9_@.\\-]{1,100}")) && ids.add(value))
            }
            val city = request.getString("city"); require(city in cities)
            val rawDays = MarketNumeric.exactLong(request.get("days"))
            require(rawDays in setOf(7L, 30L, 60L, 90L))
            val days = rawDays.toInt()
            val started = clock(); require(started > 0)
            val window = HistoryWindow(started, days)
            val base = sources.getValue(server)
            val url = "$base/history/${ids.joinToString(",") { encode(it) }}.json" +
                "?locations=${encode(city)}&date=${date(window.start)}&end_date=${date(window.end)}&time-scale=24&qualities=1"
            val rows = try { JSONArray(fetch(url)) } catch (e: Exception) {
                active()
                return if (e.message?.contains("429") == true) error("RATE_LIMITED", "The market history provider is rate limiting requests. Try again later.")
                else error("SOURCE_UNAVAILABLE", "The market history provider did not return usable data.")
            }
            active(); require(rows.length() <= 100)
            val seen = HashSet<String>(); val invalid = HashSet<String>(); val parsed = HashMap<String, JSONObject>()
            for (i in 0 until rows.length()) {
                active()
                val row = rows.optJSONObject(i) ?: continue
                val id = row.optString("item_id")
                if (id !in ids) continue
                if (!seen.add(id)) { invalid.add(id); parsed.remove(id); continue }
                try {
                    require(row.getString("location") == city && MarketNumeric.exactLong(row.get("quality")) == 1L)
                    val data = row.getJSONArray("data"); require(data.length() <= 1000)
                    val aggregate = HistoryAggregate(window); val observations = JSONArray()
                    for (j in 0 until data.length()) {
                        active()
                        val point = data.getJSONObject(j)
                        val timestamp = parseTimestamp(point.getString("timestamp"))
                        val price = MarketNumeric.exactLong(point.get("avg_price"))
                        val quantity = MarketNumeric.exactLong(point.get("item_count"))
                        aggregate.add(timestamp, price, quantity)
                        if (timestamp >= window.start && timestamp < window.end && price > 0 && quantity > 0) {
                            observations.put(JSONArray().put(Math.floorDiv(timestamp - window.start, HistoryWindow.DAY)).put(price).put(quantity))
                        }
                    }
                    val avg = aggregate.averageFloor()
                    parsed[id] = JSONObject().put("item_id", id).put("status", if (avg == null) "MISSING" else "ok")
                        .put("average", avg ?: JSONObject.NULL).put("usable_days", aggregate.observedUsableDays())
                        .put("missing_days", aggregate.missingOrUnusableDays()).put("usable_buckets", aggregate.usable)
                        .put("weighted_sum", aggregate.weightedSum.toString()).put("weight_total", aggregate.totalVol.toString())
                        .put("minimum", if (aggregate.usable > 0) aggregate.min else JSONObject.NULL)
                        .put("maximum", if (aggregate.usable > 0) aggregate.max else JSONObject.NULL)
                        .put("first_observed", if (aggregate.usable > 0) stamp(aggregate.first) else JSONObject.NULL)
                        .put("last_observed", if (aggregate.usable > 0) stamp(aggregate.last) else JSONObject.NULL)
                        .put("observations", observations)
                } catch (e: CancellationException) { throw e }
                catch (_: Exception) { invalid.add(id); parsed.remove(id) }
            }
            val results = JSONArray()
            for (id in ids) results.put(if (id in invalid) JSONObject().put("item_id", id).put("status", "INVALID_DATA")
                else parsed[id] ?: JSONObject().put("item_id", id).put("status", "MISSING"))
            return JSONObject().put("status", "ok").put("server", server).put("source", base).put("city", city)
                .put("quality", 1).put("requested_days", days).put("window_start", stamp(window.start))
                .put("window_end_exclusive", stamp(window.end)).put("fetched_at_ms", clock()).put("results", results)
                .put("observation_format", "[day_index_from_window_start, daily_average_silver, reported_item_quantity]")
                .put("average_basis", "quantity-weighted reported daily sell-order averages; rounded down")
                .put("warning", "Community observations may omit days and trades; averages are historical, not guaranteed current prices.")
        } catch (_: CancellationException) { return error("CANCELLED", "Island history was cancelled.") }
        catch (_: Exception) { return error("INVALID_DATA", "The market history request or response was invalid.") }
    }
}
