package com.albion.market.litert

import android.content.Context
import android.util.Log
import com.google.ai.edge.litertlm.OpenApiTool
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.*

class AlbionTools(private val serverBaseUrl: String, private val context: Context) {

    companion object {
        private const val TAG = "AlbionTools"
        private const val CONNECT_TIMEOUT = 10_000
        private const val READ_TIMEOUT = 15_000
        private const val MAX_RESPONSE_BYTES = 2 * 1024 * 1024
    }

    @Volatile private var cancelled = false
    @Volatile private var activeConnection: HttpURLConnection? = null
    fun cancel() {
        cancelled = true
        val connection = activeConnection
        com.albion.market.siwc.NetworkCleanup.execute { connection?.disconnect() }
    }

    private val allowedServerBases = setOf(
        "https://west.albion-online-data.com/api/v2/stats",
        "https://europe.albion-online-data.com/api/v2/stats",
        "https://east.albion-online-data.com/api/v2/stats",
    )

    init { require(serverBaseUrl in allowedServerBases) { "Unsupported Albion server" } }

    private val itemsDb: List<JSONObject> by lazy { loadItemsDb() }

    private fun exactLong(value: JSONObject, key: String, default: Long? = null): Long {
        if (!value.has(key) && default != null) return default
        val number = value.get(key)
        return MarketNumeric.exactLong(number)
    }

    private fun requireKnownItemId(raw: String): String {
        val itemId = raw.trim()
        require(itemsDb.any { it.optString("id") == itemId }) { "Unknown item_id" }
        return itemId
    }

    private fun parseAodpTimestamp(raw: String): Long {
        require(raw.length in 19..35) { "Invalid AODP timestamp" }
        val patterns = if (raw.endsWith("Z") || raw.matches(Regex(".*[+-]\\d{2}:\\d{2}$"))) {
            listOf("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "yyyy-MM-dd'T'HH:mm:ssXXX")
        } else {
            listOf("yyyy-MM-dd'T'HH:mm:ss.SSS", "yyyy-MM-dd'T'HH:mm:ss")
        }
        for (pattern in patterns) {
            val parser = SimpleDateFormat(pattern, Locale.US).apply {
                isLenient = false
                timeZone = TimeZone.getTimeZone("UTC")
            }
            val position = ParsePosition(0)
            val parsed = parser.parse(raw, position)
            if (parsed != null && position.index == raw.length) {
                require(parsed.time <= System.currentTimeMillis() + 5 * 60_000L) { "Future AODP timestamp" }
                return parsed.time
            }
        }
        throw IllegalArgumentException("Invalid AODP timestamp")
    }

    private fun loadItemsDb(): List<JSONObject> {
        return try {
            val json = context.assets.open("items-db.json").bufferedReader().readText()
            val arr = JSONArray(json)
            (0 until arr.length()).map { arr.getJSONObject(it) }
        } catch (e: Exception) { Log.e(TAG, "Failed to load items-db.json", e); emptyList() }
    }

    val searchItemTool = object : OpenApiTool {
        override fun getToolDescriptionJsonString(): String = """
        {"name":"search_item","description":"Search for an Albion Online item by name. Returns matching item IDs for use with get_prices/get_history. Always use this first.","parameters":{"type":"object","properties":{"query":{"type":"string","description":"Item name to search for"}},"required":["query"]}}
        """.trimIndent()
        override fun execute(paramsJsonString: String): String {
            return try {
                val query = JSONObject(paramsJsonString).getString("query").lowercase()
                val results = JSONArray()
                var count = 0
                for (item in itemsDb) {
                    if (count >= 10) break
                    val name = item.optString("n", "").lowercase()
                    val id = item.optString("id", "").lowercase()
                    if (name.contains(query) || id.contains(query)) {
                        results.put(JSONObject().apply {
                            put("id", item.getString("id")); put("name", item.getString("n"))
                            put("tier", item.optString("t", "?")); put("category", item.optString("c", "?"))
                        }); count++
                    }
                }
                JSONObject().apply { put("results", results); put("hint", "Use the 'id' with get_prices") }.toString()
            } catch (e: Exception) { JSONObject().put("error", e.message ?: "tool error").toString() }
        }
    }

    val getPricesTool = object : OpenApiTool {
        override fun getToolDescriptionJsonString(): String = """
        {"name":"get_prices","description":"Get current market prices for an Albion item across all cities.","parameters":{"type":"object","properties":{"item_id":{"type":"string","description":"Item ID e.g. T4_ROCK"},"quality":{"type":"integer","description":"Quality 1 to 5"}},"required":["item_id","quality"]}}
        """.trimIndent()
        override fun execute(paramsJsonString: String): String {
            return try {
                val itemId = requireKnownItemId(JSONObject(paramsJsonString).getString("item_id"))
                val quality = JSONObject(paramsJsonString).getInt("quality").coerceIn(1, 5)
                val cities = "Caerleon,Bridgewatch,Fort Sterling,Lymhurst,Thetford,Martlock,Brecilien"
                val response = httpGet("$serverBaseUrl/prices/${encodePath(itemId)}.json?locations=${encodeQuery(cities)}&qualities=$quality")
                val prices = JSONArray(response)
                require(prices.length() <= 100) { "Too many price rows" }
                val result = JSONObject(); val cityPrices = JSONArray(); val seen = mutableSetOf<String>()
                for (i in 0 until prices.length()) {
                    val p = prices.getJSONObject(i)
                    require(p.getString("item_id") == itemId) { "Mismatched item" }
                    require(exactLong(p,"quality") == quality.toLong()) { "Mismatched quality" }
                    val city = p.optString("city")
                    require(city in cities.split(",") && seen.add(city)) { "Invalid or duplicate city" }
                    val sellMin = exactLong(p,"sell_price_min",0); val buyMax = exactLong(p,"buy_price_max",0)
                    require(sellMin in 0L..Int.MAX_VALUE.toLong() && buyMax in 0L..Int.MAX_VALUE.toLong()) { "Invalid price" }
                    if (sellMin == 0L && buyMax == 0L) continue
                    val sellDate = if (sellMin > 0) p.getString("sell_price_min_date").also { parseAodpTimestamp(it) } else ""
                    val buyDate = if (buyMax > 0) p.getString("buy_price_max_date").also { parseAodpTimestamp(it) } else ""
                    cityPrices.put(JSONObject().apply {
                        put("city", city); put("quality", quality)
                        if (sellMin > 0) { put("sell", sellMin); put("sell_date", sellDate) }
                        if (buyMax > 0) { put("buy", buyMax); put("buy_date", buyDate) }
                    })
                }
                result.put("item", itemId); result.put("prices", cityPrices); result.put("fetched_at_ms", System.currentTimeMillis()); result.put("source", serverBaseUrl); result.toString()
            } catch (e: Exception) { JSONObject().put("error", "Unable to retrieve or validate market prices. Check the request and try again.").toString() }
        }
    }

    val getHistoryTool = object : OpenApiTool {
        override fun getToolDescriptionJsonString(): String = """
        {"name":"get_history","description":"Get observed daily price history over the last complete UTC days from AODP, a third-party community project, not an official Albion Online service. Its client uploads market observations captured as participating players browse markets; per-observation contributor attribution is not provided here. Report missing days and actual coverage; data may be incomplete and never represents all transactions. item_count is the aggregated quantity of items represented in reported observations, not a count of trades or orders and not a silver value. A weighted aggregate of reported bucket averages is not an exact transaction-level mean. 60 days is not necessarily two calendar months.","parameters":{"type":"object","properties":{"item_id":{"type":"string","description":"Item ID"},"quality":{"type":"integer","description":"Quality 1 to 5"},"days":{"type":"integer","description":"Complete UTC days of history (7,30,60,90)"},"city":{"type":"string","enum":["all","Caerleon","Bridgewatch","Fort Sterling","Lymhurst","Thetford","Martlock","Brecilien"],"description":"Use the specified city; all only for an all-city comparison"}},"required":["item_id","quality","days","city"]}}
        """.trimIndent()
        override fun execute(paramsJsonString: String): String {
            return try {
                val params = JSONObject(paramsJsonString)
                val itemId = requireKnownItemId(params.getString("item_id")); val quality = exactLong(params,"quality").also { require(it in 1L..5L) }.toInt(); val days = exactLong(params,"days").also { require(it in setOf(7L,30L,60L,90L)) }.toInt()
                val allowedCities = setOf("Caerleon","Bridgewatch","Fort Sterling","Lymhurst","Thetford","Martlock","Brecilien")
                val requestedCity=params.optString("city","all"); require(requestedCity=="all" || requestedCity in allowedCities)
                val cities=if(requestedCity=="all") allowedCities.joinToString(",") else requestedCity
                val window=HistoryWindow(System.currentTimeMillis(),days)
                val cal=Calendar.getInstance(TimeZone.getTimeZone("UTC"))
                cal.timeInMillis=window.end;val endDate=formatApiDate(cal)
                cal.timeInMillis=window.start;val startDate=formatApiDate(cal)
                val response = httpGet("$serverBaseUrl/history/${encodePath(itemId)}.json?locations=${encodeQuery(cities)}&date=${encodeQuery(startDate)}&end_date=${encodeQuery(endDate)}&time-scale=24&qualities=$quality")
                val history = JSONArray(response); require(history.length() <= 100) { "Too many history rows" }; val citySummaries = JSONArray(); val seenCities = mutableSetOf<String>()
                for (i in 0 until history.length()) {
                    val h = history.getJSONObject(i); require(exactLong(h,"quality") == quality.toLong() && h.getString("location") in cities.split(",") && seenCities.add(h.getString("location"))) { "Mismatched history identity" }; val data = h.getJSONArray("data")
                    require(h.getString("item_id") == itemId && data.length() <= 1000) { "Invalid history rows" }
                    val aggregate=HistoryAggregate(window); val observations=JSONArray()
                    for (j in 0 until data.length()) {
                        val d=data.getJSONObject(j)
                        val timestamp=parseAodpTimestamp(d.getString("timestamp")); val price=exactLong(d,"avg_price"); val volume=exactLong(d,"item_count")
                        aggregate.add(timestamp,price,volume)
                        if(window.includes(timestamp) && price>0 && volume>0) observations.put(JSONObject().put("timestamp_ms",timestamp).put("avg_price",price).put("volume",volume))
                    }
                    val weightedAverage=aggregate.averageFloor()
                    fun stamp(ms:Long)=SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'",Locale.US).apply{timeZone=TimeZone.getTimeZone("UTC")}.format(Date(ms))
                    citySummaries.put(JSONObject().apply {
                        put("city", h.optString("location")); put("quality", quality); put("observations", observations); put("avg", weightedAverage ?: JSONObject.NULL)
                        put("min", if(aggregate.usable>0)aggregate.min else JSONObject.NULL); put("max", if(aggregate.usable>0)aggregate.max else JSONObject.NULL); put("last", if(aggregate.usable>0)aggregate.lastPrice else JSONObject.NULL); put("volume", aggregate.totalVol)
                        put("first_observed_bucket",if(aggregate.usable>0)stamp(aggregate.first) else JSONObject.NULL)
                        put("last_timestamp",if(aggregate.usable>0)stamp(aggregate.last) else JSONObject.NULL)
                        put("requested_start_inclusive",stamp(window.start));put("requested_end_exclusive",stamp(window.end))
                        put("requested_days",days);put("observed_buckets",aggregate.observed);put("usable_buckets",aggregate.usable)
                        put("observed_usable_days",aggregate.observedUsableDays());put("missing_or_unusable_days",aggregate.missingOrUnusableDays());put("excluded_boundary_buckets",aggregate.excluded)
                        put("coverage",if(aggregate.observedUsableDays()==days)"observations_on_all_days_not_all_trades_verified" else "partial_or_missing")
                        put("weighted_sum",aggregate.weightedSum.toString());put("weight_total",aggregate.totalVol.toString())
                        put("average_basis","quantity_weighted_reported_daily_averages; underlying trade precision unknown")
                        put("average_rounding", "integer_floor"); put("fetched_at_ms", System.currentTimeMillis())
                    })
                }
                JSONObject().apply { put("item", itemId); put("period", "${days} complete UTC days"); put("source",serverBaseUrl); put("bucket_hours",24); put("requested_city",requestedCity); put("cities", citySummaries);put("coverage_warning","Missing days are not zero-price days. No guarantee of complete market transactions. Cities absent from results have no returned observations.") }.toString()
            } catch (e: Exception) { JSONObject().put("error", "Unable to retrieve or validate market history. Check the request and try again.").toString() }
        }
    }

    val getTimeTool = object : OpenApiTool {
        override fun getToolDescriptionJsonString(): String = """
        {"name":"get_time","description":"Get current date and time.","parameters":{"type":"object","properties":{}}}
        """.trimIndent()
        override fun execute(paramsJsonString: String): String {
            val now = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
            val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
            val day = SimpleDateFormat("EEEE", Locale.ENGLISH).format(now.time)
            return """{"datetime":"${sdf.format(now.time)}","day":"$day"}"""
        }
    }

    private val worldMapTools by lazy { WorldMapTools(context) }
    val getRouteTool: OpenApiTool get() = worldMapTools.route

    private val compareFlipTool by lazy { FlipComparisonTool(getPricesTool,worldMapTools,::parseAodpTimestamp) }

    fun allTools(includeFlipComparison:Boolean=false): List<OpenApiTool> = listOf(searchItemTool, getPricesTool, getHistoryTool, getTimeTool, getRouteTool, worldMapTools.search, worldMapTools.show) + if(includeFlipComparison) listOf(compareFlipTool) else emptyList()

    private fun httpGet(urlStr: String): String {
        check(!cancelled) { "Tool cancelled" }
        val deadline = android.os.SystemClock.elapsedRealtime() + 30_000
        val conn = URL(urlStr).openConnection() as HttpURLConnection
        activeConnection = conn
        if (cancelled) { conn.disconnect(); throw IllegalStateException("Tool cancelled") }
        conn.connectTimeout = CONNECT_TIMEOUT; conn.readTimeout = READ_TIMEOUT; conn.instanceFollowRedirects = false
        conn.setRequestProperty("User-Agent", "AlbionMarket/1.0")
        return try {
            val status = conn.responseCode
            if (status !in 200..299) throw IllegalStateException("AODP HTTP $status")
            conn.inputStream.use { input ->
                val out = ByteArrayOutputStream(); val buffer = ByteArray(4096)
                while(true) { check(!cancelled && android.os.SystemClock.elapsedRealtime() <= deadline) { "Tool cancelled or timed out" }; val count = input.read(buffer); if(count < 0) break
                    require(out.size() + count <= MAX_RESPONSE_BYTES) { "AODP response too large" };out.write(buffer,0,count) }
                out.toString("UTF-8")
            }
        } finally { conn.disconnect(); activeConnection = null }
    }

    private fun encodeQuery(value: String): String = URLEncoder.encode(value, "UTF-8")
    private fun encodePath(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
    private fun formatApiDate(cal: Calendar) = "${cal.get(Calendar.MONTH)+1}-${cal.get(Calendar.DAY_OF_MONTH)}-${cal.get(Calendar.YEAR)}"

    data class R(val from: String, val to: String, val zones: Int, val red: Int, val note: String)
    private val ROUTES = listOf(
        R("Fort Sterling","Thetford",6,0,"Safe, mostly blue"), R("Fort Sterling","Lymhurst",6,0,"Safe yellow route"),
        R("Fort Sterling","Caerleon",5,3,"3 red zones, gank hotspot"), R("Fort Sterling","Martlock",9,5,"5 red, cross center"),
        R("Fort Sterling","Bridgewatch",11,8,"8 red, very dangerous"), R("Martlock","Bridgewatch",6,0,"Safe blue/yellow"),
        R("Martlock","Thetford",6,0,"Safe yellow"), R("Martlock","Caerleon",5,3,"3 red zones"),
        R("Martlock","Lymhurst",10,6,"6 red zones"), R("Bridgewatch","Lymhurst",6,0,"Safe yellow"),
        R("Bridgewatch","Caerleon",6,3,"3 red zones"), R("Bridgewatch","Thetford",11,6,"6 red zones"),
        R("Thetford","Caerleon",6,4,"4 red, most dangerous"), R("Thetford","Lymhurst",10,7,"7 red, extremely dangerous"),
        R("Lymhurst","Caerleon",5,3,"3 red zones"),
    )
}
