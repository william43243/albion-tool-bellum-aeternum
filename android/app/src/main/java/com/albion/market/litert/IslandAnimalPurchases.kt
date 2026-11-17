package com.albion.market.litert

import org.json.JSONArray
import org.json.JSONObject

/** Purchase estimates only. Inputs are internal catalogue/snapshot data, never model-provided prices. */
object IslandAnimalPurchases {
 private const val DAY=86_400_000L
 private val cities=setOf("Martlock","Thetford","Lymhurst","Fort Sterling","Bridgewatch","Caerleon","Brecilien")
 private val sources=mapOf("americas" to "https://west.albion-online-data.com/api/v2/stats","europe" to "https://europe.albion-online-data.com/api/v2/stats","asia" to "https://east.albion-online-data.com/api/v2/stats")
 private fun exact(v:Any?,min:Long,max:Long):Long? {
  if(v !is Number || v is Float || v is Double)return null
  val n=v.toString().toLongOrNull()?:return null
  return n.takeIf { it in min..max }
 }
 private fun error(code:String)=JSONObject().put("status","error").put("error",JSONObject().put("code",code).put("message","Invalid animal purchase request."))
 private fun nullable(value:Any?):Any=value?:JSONObject.NULL

 /** `marketSnapshot` is an internal `{snapshots:[IslandMarketAverages result]}`.
  * Age limits must be the exact policy used to produce that snapshot.
  * Market prices are historic observations, not executable offers. */
 @JvmStatic fun calculate(allocation:JSONObject,npcCatalog:JSONObject?,marketSnapshot:JSONObject?,activeServer:String,nowMs:Long,marketMaxCacheAgeMs:Long,marketMaxObservationAgeMs:Long):JSONObject {
  if(activeServer !in sources || nowMs<=0 || marketMaxCacheAgeMs !in 1..1_800_000L || marketMaxObservationAgeMs !in 1..(365*DAY))return error("INVALID_ARGUMENT")
  val id=allocation.opt("animal_id") as? String ?: return error("INVALID_ARGUMENT")
  if(!Regex("^[A-Z0-9_@.\\-]{1,128}$").matches(id))return error("INVALID_ARGUMENT")
  val rawSource=allocation.opt("purchase_source")
  val source=if(rawSource==null || rawSource===JSONObject.NULL)"npc" else rawSource as? String ?:return error("INVALID_ARGUMENT")
  if(source !in setOf("npc","market"))return error("INVALID_ARGUMENT")
  val rawCity=allocation.opt("purchase_city")
  val city=if(rawCity==null || rawCity===JSONObject.NULL)null else rawCity as? String ?:return error("INVALID_ARGUMENT")
  if(city!=null && city !in cities)return error("INVALID_ARGUMENT")
  val rawSlots=allocation.opt("slot_count")
  val slots=if(rawSlots==null || rawSlots===JSONObject.NULL)null else exact(rawSlots,0,9000)?:return error("INVALID_ARGUMENT")
  val missing=linkedSetOf<String>()
  if(slots==null)missing.add("slot_count")
  var price:Long?=null;var evidence:JSONObject?=null;var priceKind:String?=null
  if(source=="npc") {
   val entries=npcCatalog?.optJSONArray("entries")
   if(entries!=null && entries.length()<=1000) {
    val matches=mutableListOf<JSONObject>()
    for(i in 0 until entries.length()) {
     val entry=entries.optJSONObject(i)?:continue
     val value=exact(entry.opt("value"),1,1_000_000_000_000L)
     if(entry.optString("itemId")==id && entry.optString("category") in setOf("domestic_young_animal","mount_young_animal") && entry.optString("status") in setOf("reference","verified") && entry.optString("currency")=="silver" && entry.optString("transaction")=="player_buys_from_farming_merchant" && value!=null)matches.add(entry)
    }
    if(matches.size==1){evidence=JSONObject(matches.single().toString());price=exact(evidence.opt("value"),1,1_000_000_000_000L);priceKind="npc_reference"}
   }
   if(price==null)missing.add("npc_price_reference")
  } else {
   if(city==null)missing.add("purchase_city")
   else {
    val snapshots=marketSnapshot?.optJSONArray("snapshots");val matches=mutableListOf<JSONObject>()
    if(snapshots!=null && snapshots.length()<=16)for(i in 0 until snapshots.length()) {
     val snapshot=snapshots.optJSONObject(i)?:continue
     if(snapshot.optString("status")!="ok" || snapshot.optString("server")!=activeServer || snapshot.optString("average_basis")!="quantity_weighted_reported_daily_averages_integer_floor")continue
     val results=snapshot.optJSONArray("results")?:continue
     if(results.length()>50)continue
     for(j in 0 until results.length()) {
      val row=results.optJSONObject(j)?:continue
      if(row.optString("status")!="ok" || row.optString("item_id")!=id || row.optString("server")!=activeServer || row.optString("source")!=sources[activeServer] || row.optString("city")!=city || exact(row.opt("quality"),1,5)!=1L)continue
      val average=exact(row.opt("average"),1,1_000_000_000_000L)?:continue
      val fetched=exact(row.opt("fetched_at_ms"),1,nowMs)?:continue
      val last=exact(row.opt("last_observed_ms"),1,nowMs)?:continue
      val start=exact(row.opt("requested_start_ms"),1,nowMs)?:continue
      val end=exact(row.opt("requested_end_ms"),1,nowMs)?:continue
      val days=exact(row.opt("requested_days"),1,90)?:continue
      val used=exact(row.opt("usable_days"),1,days)?:continue
      val missingDays=exact(row.opt("missing_days"),0,days)?:continue
      val buckets=exact(row.opt("usable_buckets"),used,1000)?:continue
      val sum=row.optString("weighted_sum").toLongOrNull()?:continue
      val weight=row.optString("weight_total").toLongOrNull()?:continue
      if(days !in setOf(7L,30L,60L,90L) || end!=Math.floorDiv(nowMs,DAY)*DAY || start!=end-days*DAY || last !in start until end || nowMs-fetched>marketMaxCacheAgeMs || nowMs-last>marketMaxObservationAgeMs || missingDays!=days-used || buckets<used || sum<=0 || weight<=0 || sum/weight!=average)continue
      matches.add(row)
     }
    }
    if(matches.size==1){evidence=JSONObject(matches.single().toString());price=exact(evidence.opt("average"),1,1_000_000_000_000L);priceKind="market_historical_average"}
    if(price==null)missing.add("fresh_market_average")
   }
  }
  val amount=if(price!=null && slots!=null)Math.multiplyExact(price,slots) else null
  return JSONObject().put("status",if(missing.isEmpty())"ok" else "partial").put("animal_id",id).put("purchase_source",source).put("purchase_city",nullable(city))
   .put("slot_count",nullable(slots)).put("unit_price",nullable(price)).put("unit_price_kind",nullable(priceKind)).put("price_provenance",nullable(evidence))
   .put("cost_if_all_animals_purchased",nullable(amount)).put("actual_purchase_cost",JSONObject.NULL).put("missing_fields",JSONArray(missing.toList()))
   .put("assumptions",JSONArray().put("Quantity equals explicitly supplied animal positions; enclosure capacity is not inferred.")
    .put("Existing owned stock is unknown; actual purchase cost is unavailable.")
    .put("NPC values are historical references; market averages are observations, not guaranteed executable prices.")
    .put("Animal feed, mortality, outputs, recurring revenue and profit are not calculated."))
 }
}
