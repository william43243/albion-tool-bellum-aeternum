package com.albion.market.litert

import android.content.Context
import android.util.Log
import com.google.ai.edge.litertlm.OpenApiTool
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.*

class AlbionTools(private val serverBaseUrl: String, private val context: Context) {

    companion object {
        private const val TAG = "AlbionTools"
        private const val CONNECT_TIMEOUT = 10_000
        private const val READ_TIMEOUT = 15_000
    }

    private val itemsDb: List<JSONObject> by lazy { loadItemsDb() }

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
            } catch (e: Exception) { """{"error":"${e.message}"}""" }
        }
    }

    val getPricesTool = object : OpenApiTool {
        override fun getToolDescriptionJsonString(): String = """
        {"name":"get_prices","description":"Get current market prices for an Albion item across all cities.","parameters":{"type":"object","properties":{"item_id":{"type":"string","description":"Item ID e.g. T4_ROCK"}},"required":["item_id"]}}
        """.trimIndent()
        override fun execute(paramsJsonString: String): String {
            return try {
                val itemId = JSONObject(paramsJsonString).getString("item_id")
                val cities = "Caerleon,Bridgewatch,Fort Sterling,Lymhurst,Thetford,Martlock,Brecilien"
                val response = httpGet("$serverBaseUrl/prices/$itemId.json?locations=$cities")
                val prices = JSONArray(response)
                val result = JSONObject(); val cityPrices = JSONArray()
                for (i in 0 until prices.length()) {
                    val p = prices.getJSONObject(i)
                    val sellMin = p.optInt("sell_price_min", 0); val buyMax = p.optInt("buy_price_max", 0)
                    if (sellMin == 0 && buyMax == 0) continue
                    cityPrices.put(JSONObject().apply {
                        put("city", p.getString("city"))
                        if (sellMin > 0) { put("sell", sellMin); put("sell_date", p.optString("sell_price_min_date", "")) }
                        if (buyMax > 0) { put("buy", buyMax); put("buy_date", p.optString("buy_price_max_date", "")) }
                    })
                }
                result.put("item", itemId); result.put("prices", cityPrices); result.toString()
            } catch (e: Exception) { """{"error":"${e.message}"}""" }
        }
    }

    val getHistoryTool = object : OpenApiTool {
        override fun getToolDescriptionJsonString(): String = """
        {"name":"get_history","description":"Get price history for an Albion item.","parameters":{"type":"object","properties":{"item_id":{"type":"string","description":"Item ID"},"days":{"type":"integer","description":"Days of history (7,30,90)"}},"required":["item_id","days"]}}
        """.trimIndent()
        override fun execute(paramsJsonString: String): String {
            return try {
                val params = JSONObject(paramsJsonString)
                val itemId = params.getString("item_id"); val days = params.optInt("days", 7)
                val cities = "Caerleon,Bridgewatch,Fort Sterling,Lymhurst,Thetford,Martlock,Brecilien"
                val cal = Calendar.getInstance(); val endDate = formatApiDate(cal)
                cal.add(Calendar.DAY_OF_YEAR, -days); val startDate = formatApiDate(cal)
                val response = httpGet("$serverBaseUrl/history/$itemId.json?locations=$cities&date=$startDate&end_date=$endDate&time-scale=24")
                val history = JSONArray(response); val citySummaries = JSONArray()
                for (i in 0 until history.length()) {
                    val h = history.getJSONObject(i); val data = h.getJSONArray("data")
                    if (data.length() == 0) continue
                    var sum = 0L; var count = 0; var totalVol = 0L; var min = Long.MAX_VALUE; var max = 0L
                    for (j in 0 until data.length()) {
                        val d = data.getJSONObject(j); val avg = d.getLong("avg_price")
                        if (avg <= 0) continue; sum += avg; count++; totalVol += d.getLong("item_count")
                        if (avg < min) min = avg; if (avg > max) max = avg
                    }
                    if (count == 0) continue
                    val lastPrice = data.getJSONObject(data.length() - 1).getLong("avg_price")
                    citySummaries.put(JSONObject().apply {
                        put("city", h.getString("location")); put("avg", sum / count)
                        put("min", min); put("max", max); put("last", lastPrice); put("volume", totalVol)
                    })
                }
                JSONObject().apply { put("item", itemId); put("period", "${days}d"); put("cities", citySummaries) }.toString()
            } catch (e: Exception) { """{"error":"${e.message}"}""" }
        }
    }

    val getTimeTool = object : OpenApiTool {
        override fun getToolDescriptionJsonString(): String = """
        {"name":"get_time","description":"Get current date and time.","parameters":{"type":"object","properties":{}}}
        """.trimIndent()
        override fun execute(paramsJsonString: String): String {
            val now = Calendar.getInstance()
            val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
            val day = SimpleDateFormat("EEEE", Locale.ENGLISH).format(now.time)
            return """{"datetime":"${sdf.format(now.time)}","day":"$day"}"""
        }
    }

    val getRouteTool = object : OpenApiTool {
        override fun getToolDescriptionJsonString(): String = """
        {"name":"get_route","description":"Get travel route info between two Albion cities (zones, danger, red zones).","parameters":{"type":"object","properties":{"city_from":{"type":"string","description":"From city"},"city_to":{"type":"string","description":"To city"}},"required":["city_from","city_to"]}}
        """.trimIndent()
        override fun execute(paramsJsonString: String): String {
            val params = JSONObject(paramsJsonString)
            val from = params.getString("city_from"); val to = params.getString("city_to")
            if (from.contains("Brecilien") || to.contains("Brecilien"))
                return """{"from":"$from","to":"$to","info":"Avalon Roads only, no safe overland route"}"""
            val route = ROUTES.find { (it.from == from && it.to == to) || (it.from == to && it.to == from) }
                ?: return """{"from":"$from","to":"$to","error":"Route not found"}"""
            return JSONObject().apply {
                put("from", from); put("to", to); put("zones", route.zones)
                put("red_zones", route.red); put("safe", route.red == 0); put("note", route.note)
            }.toString()
        }
    }

    fun allTools(): List<OpenApiTool> = listOf(searchItemTool, getPricesTool, getHistoryTool, getTimeTool, getRouteTool)

    private fun httpGet(urlStr: String): String {
        val conn = URL(urlStr).openConnection() as HttpURLConnection
        conn.connectTimeout = CONNECT_TIMEOUT; conn.readTimeout = READ_TIMEOUT
        conn.setRequestProperty("User-Agent", "AlbionMarket/1.0")
        return try { conn.inputStream.bufferedReader().readText() } finally { conn.disconnect() }
    }

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
