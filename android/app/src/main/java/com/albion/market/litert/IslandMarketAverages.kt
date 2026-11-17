package com.albion.market.litert

import org.json.JSONArray
import org.json.JSONObject
import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.LinkedHashMap
import java.util.Locale
import java.util.TimeZone

/** Per-server, bounded, process-memory cache over the existing get_history tool.
 * The callback must execute the get_history contract; it is called sequentially.
 * No persistent cache is provided. Cancellation of an in-flight network call
 * must additionally be delegated to the callback owner's transport. */
class IslandMarketAverages(
    private val server: String,
    private val getHistory: (String) -> String,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    companion object {
        private const val DAY = 86_400_000L
        private const val MAX_CACHE_MS = 30 * 60_000L
        private const val MAX_OBSERVATION_MS = 365 * DAY
        private const val MAX_ITEMS = 50
        private const val MAX_CACHE_ENTRIES = 128
        private val cities = setOf("Caerleon", "Bridgewatch", "Fort Sterling", "Lymhurst", "Thetford", "Martlock", "Brecilien")
        private val sources = mapOf(
            "americas" to "https://west.albion-online-data.com/api/v2/stats",
            "europe" to "https://europe.albion-online-data.com/api/v2/stats",
            "asia" to "https://east.albion-online-data.com/api/v2/stats",
        )
    }
    init { require(server in sources) { "Unsupported server" } }
    private data class Key(val item:String,val city:String,val quality:Int,val days:Int,val start:Long,val end:Long)
    private data class Entry(val fetchedAt:Long,val average:Long?,val sum:Long,val weight:Long,val usableDays:Int,val usableBuckets:Int,val first:Long?,val last:Long?)
    private val cache = object : LinkedHashMap<Key,Entry>(16,.75f,true) {
        override fun removeEldestEntry(eldest:MutableMap.MutableEntry<Key,Entry>?) = size > MAX_CACHE_ENTRIES
    }
    private val lock=Any()
    private fun stamp(raw:String):Long {
        val formatter=SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'",Locale.US).apply { isLenient=false;timeZone=TimeZone.getTimeZone("UTC") }
        val pos=ParsePosition(0);val value=formatter.parse(raw,pos)
        require(value!=null && pos.index==raw.length) { "Invalid timestamp" }
        return value.time
    }
    private fun integer(value:Any?, min:Long, max:Long):Long {
        require(value is Number && value !is Float && value !is Double) { "Expected integer" }
        val n=value.toString().toLongOrNull() ?: throw IllegalArgumentException("Integer outside limits")
        require(n in min..max) { "Integer outside limits" };return n
    }
    private fun fail(code:String,message:String)=JSONObject().put("status","error").put("error",JSONObject().put("code",code).put("message",message)).toString()
    private fun validate(response:String,key:Key,receivedAt:Long):Entry {
        require(response.length<=2*1024*1024) { "Response too large" }
        val top=JSONObject(response)
        require(!top.has("error") && top.getString("item")==key.item && top.getString("source")==sources[server] && top.getString("requested_city")==key.city && integer(top.get("bucket_hours"),24,24)==24L) { "Identity mismatch" }
        val rows=top.getJSONArray("cities");require(rows.length()<=1) { "Ambiguous history" }
        if(rows.length()==0)return Entry(receivedAt,null,0,0,0,0,null,null)
        val row=rows.getJSONObject(0)
        require(row.getString("city")==key.city && integer(row.get("quality"),1,5)==key.quality.toLong()) { "City/quality mismatch" }
        require(integer(row.get("requested_days"),key.days.toLong(),key.days.toLong())==key.days.toLong() && stamp(row.getString("requested_start_inclusive"))==key.start && stamp(row.getString("requested_end_exclusive"))==key.end) { "History window mismatch" }
        val fetched=integer(row.get("fetched_at_ms"),1,receivedAt+300_000L)
        val points=row.getJSONArray("observations");require(points.length()<=1000) { "Too many observations" }
        var sum=0L;var weight=0L;var first:Long?=null;var last:Long?=null
        val timestamps=HashSet<Long>();val observedDays=HashSet<Long>()
        for(i in 0 until points.length()) {
            val p=points.getJSONObject(i);val timestamp=integer(p.get("timestamp_ms"),key.start,key.end-1)
            val price=integer(p.get("avg_price"),1,Int.MAX_VALUE.toLong());val volume=integer(p.get("volume"),1,Int.MAX_VALUE.toLong())
            require(timestamps.add(timestamp)) { "Duplicate timestamp" }
            sum=Math.addExact(sum,Math.multiplyExact(price,volume));weight=Math.addExact(weight,volume)
            observedDays.add(Math.floorDiv(timestamp,DAY));first=if(first==null)timestamp else minOf(first,timestamp);last=if(last==null)timestamp else maxOf(last,timestamp)
        }
        val usable=integer(row.get("usable_buckets"),0,1000).toInt()
        val days=integer(row.get("observed_usable_days"),0,key.days.toLong()).toInt()
        require(usable==points.length() && days==observedDays.size && integer(row.get("missing_or_unusable_days"),0,key.days.toLong())==(key.days-days).toLong()) { "Coverage mismatch" }
        require(row.getString("weighted_sum")==sum.toString() && row.getString("weight_total")==weight.toString()) { "Aggregate mismatch" }
        val average=if(weight==0L)null else sum/weight
        require(if(average==null)row.isNull("avg") else !row.isNull("avg") && integer(row.get("avg"),0,Int.MAX_VALUE.toLong())==average) { "Average mismatch" }
        require(if(first==null)row.isNull("first_observed_bucket") && row.isNull("last_timestamp") else stamp(row.getString("first_observed_bucket"))==Math.floorDiv(first,1000)*1000 && stamp(row.getString("last_timestamp"))==Math.floorDiv(last!!,1000)*1000) { "Observation dates mismatch" }
        return Entry(fetched,average,sum,weight,days,usable,first,last)
    }

    /** All parameters are explicit; cache and observation ages are independent.
     * Accepted JSON keys: item_ids, city, quality, days, max_cache_age_ms,
     * max_observation_age_ms, min_usable_days. Each item response has its own status.
     * `ok` requires a fresh cache entry, an observation within max age, and coverage. */
    fun getAverages(requestJson:String,cancelled:()->Boolean={false}):String = synchronized(lock) {
        if(cancelled())return@synchronized fail("CANCELLED","Analysis cancelled.")
        val request:JSONObject;val city:String;val quality:Int;val days:Int;val cacheAge:Long;val observationAge:Long;val minimumDays:Int;val items:List<String>
        try {
            require(requestJson.length<=16_384)
            request=JSONObject(requestJson)
            require(request.keys().asSequence().toSet()==setOf("item_ids","city","quality","days","max_cache_age_ms","max_observation_age_ms","min_usable_days"))
            city=request.getString("city");require(city in cities)
            quality=integer(request.get("quality"),1,5).toInt();days=integer(request.get("days"),1,90).toInt();require(days in setOf(7,30,60,90))
            cacheAge=integer(request.get("max_cache_age_ms"),1,MAX_CACHE_MS);observationAge=integer(request.get("max_observation_age_ms"),1,MAX_OBSERVATION_MS)
            minimumDays=integer(request.get("min_usable_days"),1,days.toLong()).toInt()
            val raw=request.getJSONArray("item_ids");require(raw.length() in 1..MAX_ITEMS)
            val ids=LinkedHashSet<String>()
            for(i in 0 until raw.length()){val id=raw.get(i);require(id is String && Regex("^[A-Z0-9_@.\\-]{1,100}$").matches(id));ids.add(id)}
            items=ids.toList()
        } catch (_:Exception) {return@synchronized fail("INVALID_ARGUMENT","Invalid or oversized history request.")}
        val now=clock();if(now<=0)return@synchronized fail("INVALID_CLOCK","Clock unavailable.")
        val end=Math.floorDiv(now,DAY)*DAY;val start=end-days*DAY
        val results=JSONArray()
        for(item in items) {
            if(cancelled())return@synchronized fail("CANCELLED","Analysis cancelled.")
            val key=Key(item,city,quality,days,start,end);val previous=cache[key]
            var entry=previous;var fromCache=entry!=null && now>=entry.fetchedAt && now-entry.fetchedAt<=cacheAge
            if(!fromCache) {
                try {
                    val args=JSONObject().put("item_id",item).put("quality",quality).put("days",days).put("city",city)
                    val data=getHistory(args.toString())
                    if(cancelled())return@synchronized fail("CANCELLED","Analysis cancelled.")
                    entry=validate(data,key,clock());cache[key]=entry;fromCache=false
                } catch (_:Exception) {
                    if(cancelled())return@synchronized fail("CANCELLED","Analysis cancelled.")
                    val state=if(previous!=null)"STALE" else "SOURCE_UNAVAILABLE"
                    results.put(JSONObject().put("item_id",item).put("status",state).put("average",JSONObject.NULL).put("source",sources[server]).put("server",server).put("city",city).put("quality",quality).put("requested_start_ms",start).put("requested_end_ms",end).put("fetched_at_ms",previous?.fetchedAt?:JSONObject.NULL))
                    continue
                }
            }
            val current=entry!!;val nowAfter=clock()
            val status=when {
                nowAfter<current.fetchedAt || nowAfter-current.fetchedAt>cacheAge -> "STALE"
                current.average==null || current.last==null -> "MISSING"
                current.usableDays<minimumDays -> "INSUFFICIENT_COVERAGE"
                nowAfter<current.last || nowAfter-current.last>observationAge -> "STALE_OBSERVATION"
                else -> "ok"
            }
            results.put(JSONObject().put("item_id",item).put("status",status).put("average",if(status=="ok")current.average else JSONObject.NULL)
                .put("server",server).put("source",sources[server]).put("city",city).put("quality",quality).put("requested_start_ms",start).put("requested_end_ms",end).put("requested_days",days)
                .put("fetched_at_ms",current.fetchedAt).put("first_observed_ms",current.first?:JSONObject.NULL).put("last_observed_ms",current.last?:JSONObject.NULL)
                .put("usable_days",current.usableDays).put("missing_days",days-current.usableDays).put("usable_buckets",current.usableBuckets)
                .put("weighted_sum",current.sum.toString()).put("weight_total",current.weight.toString()).put("cache_hit",fromCache))
        }
        JSONObject().put("status","ok").put("server",server).put("cache","process_memory_only").put("average_basis","quantity_weighted_reported_daily_averages_integer_floor").put("results",results).toString()
    }
}
