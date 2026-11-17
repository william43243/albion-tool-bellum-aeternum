import com.albion.market.litert.IslandAnimalPurchases
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

private const val DAY=86_400_000L
private val now=Instant.parse("2026-11-17T01:00:00Z").toEpochMilli()
private val end=Math.floorDiv(now,DAY)*DAY
private val source="https://west.albion-online-data.com/api/v2/stats"
private fun allocation(id:String="T3_FARM_CHICKEN_BABY",slots:Any=3,source:Any=JSONObject.NULL,city:Any=JSONObject.NULL)=JSONObject().put("animal_id",id).put("slot_count",slots).put("plot_count",2).put("purchase_source",source).put("purchase_city",city)
private fun npcEntry()=JSONObject().put("itemId","T3_FARM_CHICKEN_BABY").put("category","domestic_young_animal").put("value",3000).put("currency","silver").put("status","reference").put("transaction","player_buys_from_farming_merchant").put("verifiedAt","2026-11-17")
private fun npc()=JSONObject().put("entries",JSONArray().put(npcEntry()))
private fun marketRow()=JSONObject().put("status","ok").put("item_id","T3_FARM_CHICKEN_BABY").put("server","americas").put("source",source).put("city","Fort Sterling").put("quality",1).put("average",50).put("fetched_at_ms",now-10_000)
 .put("last_observed_ms",end-DAY).put("requested_start_ms",end-7*DAY).put("requested_end_ms",end).put("requested_days",7).put("usable_days",1).put("missing_days",6).put("usable_buckets",1).put("weighted_sum","500").put("weight_total","10")
private fun snapshot(row:JSONObject=marketRow())=JSONObject().put("snapshots",JSONArray().put(JSONObject().put("status","ok").put("server","americas").put("average_basis","quantity_weighted_reported_daily_averages_integer_floor").put("results",JSONArray().put(row))))
private fun calculate(a:JSONObject,n:JSONObject?=npc(),m:JSONObject?=snapshot(),server:String="americas")=IslandAnimalPurchases.calculate(a,n,m,server,now,1_800_000,2*DAY)
fun main(){
 val default=calculate(allocation());check(default.getString("status")=="ok" && default.getLong("cost_if_all_animals_purchased")==9000L && default.getString("unit_price_kind")=="npc_reference" && default.isNull("actual_purchase_cost"))
 val noSlots=calculate(allocation(slots=JSONObject.NULL));check(noSlots.getString("status")=="partial" && noSlots.isNull("cost_if_all_animals_purchased") && noSlots.getJSONArray("missing_fields").toString().contains("slot_count"))
 val noCity=calculate(allocation(source="market"));check(noCity.isNull("unit_price") && noCity.getJSONArray("missing_fields").toString().contains("purchase_city"))
 val market=calculate(allocation(source="market",city="Fort Sterling"));check(market.getLong("cost_if_all_animals_purchased")==150L && market.getString("unit_price_kind")=="market_historical_average")
 val wrongCity=calculate(allocation(source="market",city="Thetford"));check(wrongCity.isNull("unit_price"))
 val wrongServer=calculate(allocation(source="market",city="Fort Sterling"),server="europe");check(wrongServer.isNull("unit_price"))
 val stale=calculate(allocation(source="market",city="Fort Sterling"),m=snapshot(marketRow().put("fetched_at_ms",now-1_800_001)));check(stale.isNull("unit_price"))
 val staleObservation=calculate(allocation(source="market",city="Fort Sterling"),m=snapshot(marketRow().put("last_observed_ms",end-3*DAY)));check(staleObservation.isNull("unit_price"))
 val mismatched=calculate(allocation(source="market",city="Fort Sterling"),m=snapshot(marketRow().put("average",51)));check(mismatched.isNull("unit_price"))
 val none=calculate(allocation(id="T4_NO_REFERENCE"));check(none.getString("status")=="partial" && none.isNull("unit_price") && none.isNull("cost_if_all_animals_purchased"))
 val duplicate=npc().put("entries",JSONArray().put(npcEntry()).put(npcEntry()));check(calculate(allocation(),n=duplicate).isNull("unit_price"))
 check(calculate(allocation(slots=9001)).getString("status")=="error")
 check(calculate(allocation(source="market",city="Fort Sterling"),n=npc(),m=null).isNull("unit_price"))
 println("Animal purchase source, quantities, provenance, stale market and no fallback passed")
}
