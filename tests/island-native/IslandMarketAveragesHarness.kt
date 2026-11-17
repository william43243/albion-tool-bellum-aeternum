import com.albion.market.litert.IslandMarketAverages
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

private const val DAY=86_400_000L
private val west="https://west.albion-online-data.com/api/v2/stats"
private val europe="https://europe.albion-online-data.com/api/v2/stats"
private fun request(ids:List<String> = listOf("T4_ORE"),minDays:Int=1,obsAge:Long=3*DAY,cacheAge:Long=60_000)=JSONObject()
 .put("item_ids",JSONArray(ids)).put("city","Fort Sterling").put("quality",1).put("days",7)
 .put("max_cache_age_ms",cacheAge).put("max_observation_age_ms",obsAge).put("min_usable_days",minDays).toString()
private fun response(args:String,now:Long,source:String=west,empty:Boolean=false,wrongAverage:Boolean=false):String {
 val p=JSONObject(args);val end=Math.floorDiv(now,DAY)*DAY;val start=end-p.getInt("days")*DAY;val last=end-DAY
 val row=JSONObject().put("city",p.getString("city")).put("quality",p.getInt("quality")).put("requested_days",p.getInt("days"))
  .put("requested_start_inclusive",Instant.ofEpochMilli(start).toString()).put("requested_end_exclusive",Instant.ofEpochMilli(end).toString())
  .put("fetched_at_ms",now).put("usable_buckets",1).put("observed_usable_days",1).put("missing_or_unusable_days",p.getInt("days")-1)
  .put("observations",JSONArray().put(JSONObject().put("timestamp_ms",last).put("avg_price",4).put("volume",10)))
  .put("weighted_sum","40").put("weight_total","10").put("avg",if(wrongAverage)5 else 4)
  .put("first_observed_bucket",Instant.ofEpochMilli(last).toString()).put("last_timestamp",Instant.ofEpochMilli(last).toString())
 return JSONObject().put("item",p.getString("item_id")).put("source",source).put("requested_city",p.getString("city")).put("bucket_hours",24)
  .put("cities",if(empty)JSONArray() else JSONArray().put(row)).toString()
}
private fun row(result:String)=JSONObject(result).getJSONArray("results").getJSONObject(0)
fun main(){
 var now=Instant.parse("2026-11-17T12:00:00Z").toEpochMilli();var calls=0;var fail=false
 val service=IslandMarketAverages("americas",{ args->calls++;if(fail)throw IllegalStateException("network");response(args,now)},{now})
 val first=JSONObject(service.getAverages(request(listOf("T4_ORE","T4_ORE"))))
 check(first.getJSONArray("results").length()==1 && row(first.toString()).getInt("average")==4 && calls==1)
 check(row(service.getAverages(request())).getBoolean("cache_hit") && calls==1)
 check(row(service.getAverages(request(minDays=7))).getString("status")=="INSUFFICIENT_COVERAGE")
 val staleObs=row(service.getAverages(request(obsAge=1)));check(staleObs.getString("status")=="STALE_OBSERVATION"&&staleObs.isNull("average"))
 now+=61_000;fail=true;val stale=row(service.getAverages(request()));check(stale.getString("status")=="STALE"&&stale.isNull("average"))
 val missing=IslandMarketAverages("americas",{a->response(a,now,empty=true)},{now});check(row(missing.getAverages(request())).getString("status")=="MISSING")
 val bad=IslandMarketAverages("americas",{a->response(a,now,wrongAverage=true)},{now});check(row(bad.getAverages(request())).getString("status")=="SOURCE_UNAVAILABLE")
 val other=IslandMarketAverages("europe",{a->response(a,now,europe)},{now});check(row(other.getAverages(request())).getString("server")=="europe")
 val misrouted=IslandMarketAverages("europe",{a->response(a,now,west)},{now});check(row(misrouted.getAverages(request())).getString("status")=="SOURCE_UNAVAILABLE")
 var hits=0;val bounded=IslandMarketAverages("americas",{a->hits++;response(a,now)},{now})
 check(JSONObject(bounded.getAverages(request((0..50).map { "T4_ITEM_$it" }))).getJSONObject("error").getString("code")=="INVALID_ARGUMENT" && hits==0)
 val giant=request().replace("\"max_cache_age_ms\":60000","\"max_cache_age_ms\":18446744073709551617")
 check(JSONObject(bounded.getAverages(giant)).getJSONObject("error").getString("code")=="INVALID_ARGUMENT" && hits==0)
 for (group in 0..2) { val count=if(group==2)30 else 50;bounded.getAverages(request((0 until count).map { "T4_ITEM_${group}_$it" })) }
 check(hits==130);bounded.getAverages(request(listOf("T4_ITEM_0_0")));check(hits==131) // 128-entry LRU
 check(JSONObject(bounded.getAverages(request()){true}).getJSONObject("error").getString("code")=="CANCELLED")
 var stopped=false;val cancelled=IslandMarketAverages("americas",{a->stopped=true;response(a,now)},{now})
 check(JSONObject(cancelled.getAverages(request()){stopped}).getJSONObject("error").getString("code")=="CANCELLED")
 println("Island market history: cache, stale, coverage, identity, bounds and cancellation passed")
}
