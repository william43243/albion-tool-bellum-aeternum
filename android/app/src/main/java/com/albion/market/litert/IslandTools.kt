package com.albion.market.litert

import com.google.ai.edge.litertlm.OpenApiTool
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CancellationException

/** Model-facing adapters. Prices, rates, yields and market snapshots are never model inputs. */
object IslandTools {
 val toolActions = setOf("get_island_economy_data", "optimize_island_profitability", "compare_island_crops")
 private val cities=setOf("Caerleon","Bridgewatch","Fort Sterling","Lymhurst","Thetford","Martlock","Brecilien")
 private val servers=setOf("americas","europe","asia")
 private fun keys(o:JSONObject)=o.keys().asSequence().toSet()
 private fun fields(o:JSONObject, expected:Set<String>) { require(keys(o)==expected) { "INVALID_ARGUMENT" } }
 private fun string(o:JSONObject,k:String,max:Int,nullable:Boolean=false):String? {
  val v=o.get(k); if(nullable && v===JSONObject.NULL)return null
  require(v is String && v.isNotBlank() && v==v.trim() && v.length<=max) { "INVALID_ARGUMENT" }; return v
 }
 private fun int(o:JSONObject,k:String,max:Int,nullable:Boolean=true):Int? {
  val v=o.get(k); if(nullable && v===JSONObject.NULL)return null
  require(v is Number && v.toDouble().isFinite() && v.toDouble()%1.0==0.0 && v.toDouble()>=0 && v.toDouble()<=max) { "INVALID_ARGUMENT" };return v.toInt()
 }
 private fun number(o:JSONObject,k:String,max:Double) {
  val v=o.get(k);if(v===JSONObject.NULL)return
  require(v is Number && v.toDouble().isFinite() && v.toDouble() in 0.0..max) { "INVALID_ARGUMENT" }
 }
 private fun bool(o:JSONObject,k:String) { val v=o.get(k);require(v===JSONObject.NULL || v is Boolean) { "INVALID_ARGUMENT" } }
 private fun arr(o:JSONObject,k:String,nullable:Boolean=true):JSONArray? { val v=o.get(k);if(nullable && v===JSONObject.NULL)return null;require(v is JSONArray) { "INVALID_ARGUMENT" };return v }
 private fun item(o:JSONObject,k:String,max:Int=128,nullable:Boolean=false):String? {
  val v=string(o,k,max,nullable);require(v==null || v.matches(Regex("[A-Za-z0-9_@.-]+"))) { "INVALID_ARGUMENT" };return v
 }
 private fun city(o:JSONObject,k:String):String? { val v=string(o,k,40,true);require(v==null || v in cities) { "INVALID_ARGUMENT" };return v }
 private fun scalarSchema(type:String,description:String,nullable:Boolean=true)=JSONObject().put("type",if(nullable) JSONArray().put(type).put("null") else type).put("description",description)
 private fun purchaseSourceSchema()=scalarSchema("string","npc or market; null uses NPC. Choose market only if the user explicitly requests market purchase.").put("enum",JSONArray().put("npc").put("market").put(JSONObject.NULL))
 private fun objectSchema(properties:JSONObject)=JSONObject().put("type","object").put("properties",properties).put("required",JSONArray(properties.keys().asSequence().toList())).put("additionalProperties",false)
 private fun arraySchema(items:JSONObject,nullable:Boolean=true)=JSONObject().put("type",if(nullable) JSONArray().put("array").put("null") else "array").put("items",items)
 private fun spec():JSONObject = objectSchema(JSONObject().put("item_id",scalarSchema("string","Exact item ID.",false)).put("level",scalarSchema("integer","Player level from 0 to 100.",false)))
 private fun crop():JSONObject = objectSchema(JSONObject().put("crop_id",scalarSchema("string","Exact farm seed ID from the catalogue.",false))
  .put("plot_count",scalarSchema("integer","Whole farm plots devoted to this crop, or null when specifying slots."))
  .put("slot_count",scalarSchema("integer","Planting slots devoted to this crop, or null when specifying plots."))
  .put("watered_slots",scalarSchema("integer","Number of these slots watered with focus; null if unknown."))
  .put("owned_seeds",scalarSchema("integer","Seeds already owned for this allocation; null means unknown, never assume zero."))
  .put("purchase_source",purchaseSourceSchema())
  .put("purchase_city",scalarSchema("string","Explicit purchase city for market prices; null if unknown, never inferred from island or sale city.")))
 private fun animal():JSONObject = objectSchema(JSONObject().put("animal_id",scalarSchema("string","Exact requested animal ID.",false))
  .put("plot_count",scalarSchema("integer","Animal facility count if explicitly supplied, otherwise null; its capacity is not assumed."))
  .put("slot_count",scalarSchema("integer","Animal positions if explicitly supplied, otherwise null."))
  .put("purchase_source",purchaseSourceSchema())
  .put("purchase_city",scalarSchema("string","Explicit purchase city for market prices; null if unknown, never inferred from island or sale city.")))
 private fun island():JSONObject=objectSchema(JSONObject().put("id",scalarSchema("string","User-provided unique island identifier.",false))
  .put("island_city",scalarSchema("string","Island city, null if unknown."))
  .put("plot_count",scalarSchema("integer","Total agricultural FARM plots, not positions; one FARM plot is nine positions."))
  .put("occupied_plots",scalarSchema("integer","Occupied whole farm plots, null if unknown; do not assume zero."))
  .put("occupied_slots",scalarSchema("integer","Additional occupied positions within the other farm plots, null if unknown."))
  .put("available_slots",scalarSchema("integer","Available farm planting positions if explicitly given; eight slots are not eight plots."))
  .put("crop_allocations",arraySchema(crop())).put("animal_allocations",arraySchema(animal())))
 private fun definition(action:String):JSONObject {
  val props=if(action=="get_island_economy_data") JSONObject()
   .put("item_ids",arraySchema(scalarSchema("string","Exact local farmable ID.",false)))
   .put("category",scalarSchema("string","farm, herbgarden, pasture or kennel; null for all."))
   .put("city",scalarSchema("string","Market city; null if unknown."))
   .put("days",scalarSchema("integer","Complete UTC history days: 7, 30, 60 or 90; null if unknown."))
   .put("quality",scalarSchema("integer","Market quality 1 to 5; null if unknown."))
  else if(action=="compare_island_crops") JSONObject()
   .put("server",scalarSchema("string","Active server americas, europe or asia; null uses the app server."))
   .put("island_city",scalarSchema("string","City where the island is located; null if unknown."))
   .put("market_city",scalarSchema("string","City where the player will sell the crops; null if unknown."))
   .put("plot_count",scalarSchema("integer","Number of available building plots, not individual planting positions; null compares one plot."))
   .put("premium",scalarSchema("boolean","Whether the character has Albion Premium; null if unknown."))
   .put("focus_budget",scalarSchema("integer","Focus available per harvest, zero when none; null compares without focus and discloses that default."))
   .put("focus_per_plant",scalarSchema("integer","Actual focus cost per watered plant only if explicitly known; null uses the no-specialization base cost."))
   .put("history_days",scalarSchema("integer","Requested history window: 7, 30, 60 or 90 complete UTC days; null defaults to 7."))
   .put("category",scalarSchema("string","farm, herbgarden, or null to compare both."))
   .put("crop_ids",arraySchema(scalarSchema("string","Exact seed ID or harvested product ID. Include every explicitly requested crop; null compares all relevant crops.",false)))
  else JSONObject().put("server",scalarSchema("string","Active server americas, europe or asia; null uses the app server."))
   .put("islands",arraySchema(island(),false)).put("premium",scalarSchema("boolean","Whether the user has Premium; null if unknown."))
   .put("focus_available",scalarSchema("integer","Available focus; null if unknown."))
   .put("specializations",arraySchema(spec())).put("budget_silver",scalarSchema("number","Available budget in silver; null if unknown."))
   .put("sale_cities",arraySchema(scalarSchema("string","Explicit sale city.",false)))
   .put("simulation_days",scalarSchema("integer","Requested days, null if unknown."))
   .put("price_days",scalarSchema("integer","Historical price window 7, 30, 60 or 90 complete UTC days; null uses an explicitly disclosed 7-day window."))
   .put("objective",scalarSchema("string","profit, focus, liquidity or compare; null if unknown."))
  val desc=if(action=="get_island_economy_data") "List catalogue identifiers and bounded historical market observations. Catalogue entries are candidates; never treat unverified raw game data as yields or prices. Historical averages are not executable prices. Ask for a market city and period when needed."
   else if(action=="compare_island_crops") "Compare farm crops and herb-garden crops over the requested historical window, fetching every selected product together. With no crop named use null crop_ids to compare all, or filter the explicitly requested category; if one or several crops are named, pass only those exact IDs. Compare the same available empty building plots for each option. This returns per-crop observed 90/60/30/7-day coverage, assumptions, reference seed costs and estimated profit; never describe history as a current guaranteed price. Ask for island city, sale city or Premium if unknown."
   else "Analyze only explicit island capacities and crop choices using the deterministic engine. A farm plot has nine planting slots; eight plots differ from eight slots. Ask for missing island city, capacity, occupation, focus and crop choice; never invent them. Do not replace a user's crop with another. Use NPC purchases by default; select market only when explicitly requested, never substitute market for unknown NPC prices. Animals, prices and yields remain unknown unless returned by this tool. Never claim a profit or ranking when unavailable."
  return JSONObject().put("name",action).put("description",desc).put("parameters",objectSchema(props))
 }
 fun validateToolRequest(action:String,p:JSONObject,expectedServer:String?=null) {
  require(action in toolActions && (expectedServer==null || expectedServer in servers)) { "INVALID_ARGUMENT" }
  if(action=="get_island_economy_data") {
   fields(p,setOf("item_ids","category","city","days","quality"))
   val ids=arr(p,"item_ids");if(ids!=null){require(ids.length() in 1..16) { "INVALID_ARGUMENT" };val seen=HashSet<String>();for(i in 0 until ids.length()){val id=ids.get(i);require(id is String && id.matches(Regex("[A-Za-z0-9_@.-]{1,128}")) && seen.add(id)) { "INVALID_ARGUMENT" }}}
   val category=string(p,"category",20,true);require(category==null || category in setOf("farm","herbgarden","pasture","kennel")) { "INVALID_ARGUMENT" }
   city(p,"city"); val days=int(p,"days",90);require(days==null || days in setOf(7,30,60,90)) { "INVALID_ARGUMENT" }
   val q=int(p,"quality",5);require(q==null || q>=1) { "INVALID_ARGUMENT" };return
  }
  if(action=="compare_island_crops") {
   fields(p,setOf("server","island_city","market_city","plot_count","premium","focus_budget","focus_per_plant","history_days","category","crop_ids"))
   val server=string(p,"server",20,true);require(server==null || server in servers && (expectedServer==null || server==expectedServer)) { "SERVER_MISMATCH" }
   city(p,"island_city");city(p,"market_city");bool(p,"premium")
   val plots=int(p,"plot_count",1000);require(plots==null || plots>0) { "INVALID_ARGUMENT" }
   int(p,"focus_budget",10_000_000);val focusCost=int(p,"focus_per_plant",10_000);require(focusCost==null || focusCost>0) { "INVALID_ARGUMENT" }
   val days=int(p,"history_days",90);require(days==null || days in setOf(7,30,60,90)) { "INVALID_ARGUMENT" }
   val category=string(p,"category",20,true);require(category==null || category in setOf("farm","herbgarden")) { "INVALID_ARGUMENT" }
   val ids=arr(p,"crop_ids");if(ids!=null){require(ids.length() in 1..15) { "INVALID_ARGUMENT" };val seen=HashSet<String>();for(i in 0 until ids.length()){val id=ids.get(i);require(id is String && id.matches(Regex("[A-Z0-9_@.\\-]{1,100}")) && seen.add(id)) { "INVALID_ARGUMENT" }}}
   return
  }
  fields(p,setOf("server","islands","premium","focus_available","specializations","budget_silver","sale_cities","simulation_days","price_days","objective"))
  val server=string(p,"server",20,true);require(server==null || server in servers && (expectedServer==null || server==expectedServer)) { "SERVER_MISMATCH" }
  bool(p,"premium");int(p,"focus_available",10_000_000);number(p,"budget_silver",9e15)
  val objective=string(p,"objective",20,true);require(objective==null || objective in setOf("profit","focus","liquidity","compare")) { "INVALID_ARGUMENT" }
  val days=int(p,"simulation_days",365);require(days==null || days>0) { "INVALID_ARGUMENT" }
  val priceDays=int(p,"price_days",90);require(priceDays==null || priceDays in setOf(7,30,60,90)) { "INVALID_ARGUMENT" }
  val specs=arr(p,"specializations");if(specs!=null){require(specs.length()<=32) { "INVALID_ARGUMENT" };val seen=HashSet<String>();for(i in 0 until specs.length()){val row=specs.getJSONObject(i);fields(row,setOf("item_id","level"));require(seen.add(item(row,"item_id")!!)) { "INVALID_ARGUMENT" };int(row,"level",100,false)}}
  val sales=arr(p,"sale_cities");if(sales!=null){require(sales.length()<=7) { "INVALID_ARGUMENT" };val seen=HashSet<String>();for(i in 0 until sales.length()){val v=sales.get(i);require(v is String && v in cities && seen.add(v)) { "INVALID_ARGUMENT" }}}
  val islands=arr(p,"islands",false)!!;require(islands.length() in 1..32) { "INVALID_ARGUMENT" };var total=0;val islandIds=HashSet<String>()
  for(i in 0 until islands.length()){
   val x=islands.getJSONObject(i);fields(x,setOf("id","island_city","plot_count","occupied_plots","occupied_slots","available_slots","crop_allocations","animal_allocations"));require(islandIds.add(string(x,"id",80)!!)) { "INVALID_ARGUMENT" };city(x,"island_city")
   int(x,"plot_count",1000);int(x,"occupied_plots",1000);int(x,"occupied_slots",9000);int(x,"available_slots",9000)
   val crops=arr(x,"crop_allocations");if(crops!=null){require(crops.length()<=64) { "INVALID_ARGUMENT" };total+=crops.length();for(j in 0 until crops.length()){val c=crops.getJSONObject(j);fields(c,setOf("crop_id","plot_count","slot_count","watered_slots","owned_seeds","purchase_source","purchase_city"));item(c,"crop_id");val cp=int(c,"plot_count",1000);val cs=int(c,"slot_count",9000);require((cp==null)!=(cs==null) && (cp?:cs!!)>0) { "INVALID_ARGUMENT" };int(c,"watered_slots",9000);int(c,"owned_seeds",9000);val source=string(c,"purchase_source",10,true);require(source==null || source in setOf("npc","market")) { "INVALID_ARGUMENT" };city(c,"purchase_city")}}
   val animals=arr(x,"animal_allocations");if(animals!=null){require(animals.length()<=64) { "INVALID_ARGUMENT" };total+=animals.length();for(j in 0 until animals.length()){val a=animals.getJSONObject(j);fields(a,setOf("animal_id","plot_count","slot_count","purchase_source","purchase_city"));item(a,"animal_id");int(a,"plot_count",1000);int(a,"slot_count",9000);val source=string(a,"purchase_source",10,true);require(source==null || source in setOf("npc","market")) { "INVALID_ARGUMENT" };city(a,"purchase_city")}}
  }
  require(total<=128) { "INVALID_ARGUMENT" }
 }
 private fun failure(code:String,message:String)=JSONObject().put("status","error").put("error",JSONObject().put("code",code).put("message",message))
 fun all(loadCatalog:()->JSONObject, loadNpcPrices:()->JSONObject?, market:(JSONObject,()->Boolean)->JSONObject, server:String, cancelled:()->Boolean, historyBatch:((JSONObject,()->Boolean)->JSONObject)?=null):List<OpenApiTool> = toolActions.sorted().map { action -> object:OpenApiTool {
  override fun getToolDescriptionJsonString()=definition(action).toString()
  override fun execute(paramsJsonString:String):String {
   try {
    if(cancelled() || Thread.currentThread().isInterrupted) throw CancellationException()
    require(paramsJsonString.toByteArray(Charsets.UTF_8).size<=65536) { "INVALID_ARGUMENT" }
    val p=JSONObject(paramsJsonString);validateToolRequest(action,p,server)
    val catalog=try { loadCatalog() } catch(_:Exception) { return failure("CATALOG_UNAVAILABLE","Island catalogue is unavailable.").toString() };if(cancelled()) throw CancellationException()
    val npc=loadNpcPrices();if(npc!=null)catalog.put("npc_prices",npc)
    if(action=="compare_island_crops") {
     val result=IslandCropComparison.execute(p,catalog,npc,server,historyBatch,cancelled)
     val encoded=result.toString();return if(encoded.length<=120_000) encoded else failure("RESULT_LIMIT","Island history is too large; request fewer crops.").toString()
    }
    if(action=="optimize_island_profitability") {
     // Only explicitly selected market purchases with an explicit purchase city are queried.
     val validIds=HashSet<String>();val farmables=catalog.getJSONArray("farmables")
     for(i in 0 until farmables.length())validIds.add(farmables.getJSONObject(i).getString("sourceId"))
     val grouped=linkedMapOf<String,LinkedHashSet<String>>();val islands=p.getJSONArray("islands")
     for(i in 0 until islands.length()) { val island=islands.getJSONObject(i)
      for((key,idKey) in listOf("crop_allocations" to "crop_id","animal_allocations" to "animal_id")) {
       val allocations=island.optJSONArray(key) ?: continue
       for(j in 0 until allocations.length()) { if(cancelled())throw CancellationException();val allocation=allocations.getJSONObject(j)
        if(allocation.optString("purchase_source")=="market" && !allocation.isNull("purchase_city")) {
         val id=allocation.getString(idKey);if(id in validIds)grouped.getOrPut(allocation.getString("purchase_city")){linkedSetOf()}.add(id)
        }
       }
      }
     }
     // Sale IDs are consulted only when a unique, explicitly verified fact matches
     // the requested crop, island/sale cities, Premium and specialization.
     val facts=catalog.optJSONObject("economics_facts")?.optJSONArray("entries")
     val saleCities=p.optJSONArray("sale_cities");val specs=p.optJSONArray("specializations");val premium=p.opt("premium") as? Boolean
     if(facts!=null && saleCities!=null && saleCities.length()==1 && specs!=null && premium!=null) {
      val saleCity=saleCities.getString(0)
      for(i in 0 until islands.length()) { val island=islands.getJSONObject(i);if(island.isNull("island_city"))continue
       val islandCity=island.getString("island_city");val allocations=island.optJSONArray("crop_allocations") ?: continue
       for(j in 0 until allocations.length()) { if(cancelled())throw CancellationException();val allocation=allocations.getJSONObject(j);val cropId=allocation.getString("crop_id")
        val levels=(0 until specs.length()).map{specs.getJSONObject(it)}.filter{it.optString("item_id")==cropId}.map{it.getInt("level")};if(levels.size!=1)continue
        val matching=(0 until facts.length()).mapNotNull{facts.optJSONObject(it)}.filter{fact->
         val prov=fact.optJSONObject("provenance")
         fact.optString("status")=="verified" && fact.optString("crop_id")==cropId && fact.optString("island_city")==islandCity && fact.optString("sale_city")==saleCity && fact.opt("premium")==premium && fact.opt("specialization_level") is Number && fact.optDouble("specialization_level")==levels[0].toDouble() && prov!=null && prov.optString("source").isNotBlank() && prov.optString("revision").isNotBlank()
        }
        val outputId=matching.singleOrNull()?.optString("output_item_id")?.takeIf{it.matches(Regex("[A-Za-z0-9_@.-]{1,128}"))} ?: continue
        grouped.getOrPut(saleCity){linkedSetOf()}.add(outputId)
        if(!allocation.isNull("owned_seeds") && allocation.getInt("owned_seeds")>0)grouped.getOrPut(saleCity){linkedSetOf()}.add(cropId)
       }
      }
     }
     if(grouped.values.sumOf{it.size}>16)return failure("LIMIT_EXCEEDED","At most 16 distinct item-city market histories can be queried in one island request.").toString()
     val snapshots=JSONArray();val days=if(p.isNull("price_days")) 7 else p.getInt("price_days")
     for((city,ids) in grouped) {if(cancelled())throw CancellationException()
      val q=JSONObject().put("item_ids",JSONArray(ids.toList())).put("city",city).put("quality",1).put("days",days)
       .put("max_cache_age_ms",1_800_000).put("max_observation_age_ms",86_400_000).put("min_usable_days",1)
      val result=market(q,cancelled);if(cancelled() || result.optJSONObject("error")?.optString("code")=="CANCELLED")throw CancellationException();snapshots.put(result)
     }
     val snapshot=if(snapshots.length()>0)JSONObject().put("snapshots",snapshots) else null
     val engineRequest=JSONObject(p.toString()).put("server",server)
     val result=IslandEngine.execute(engineRequest,catalog,snapshot,cancelled)
     result.put("market_price_policy",JSONObject().put("history_days",days).put("defaulted_days",p.isNull("price_days")).put("quality",1)
      .put("max_cache_age_ms",1_800_000).put("max_observation_age_ms",86_400_000).put("minimum_usable_days",1)
      .put("warning","Historical averages are incomplete observations, not guaranteed executable prices. Market purchases require an explicit purchase city; sale and opportunity histories require explicit sale city and verified matching facts."))
     val encoded=result.toString();return if(encoded.length<=48000) encoded else failure("RESULT_LIMIT","Island result is too large; request fewer islands or allocations.").toString()
    }
    val source=catalog.getJSONArray("farmables");val ids=arr(p,"item_ids");val wanted=if(ids==null)null else (0 until ids.length()).map{ids.getString(it)}.toSet();val category=string(p,"category",20,true)
    val rows=JSONArray();val matched=HashSet<String>()
    for(i in 0 until source.length()) { if(cancelled())throw CancellationException();val x=source.getJSONObject(i);val id=x.getString("sourceId");if((wanted==null || id in wanted) && (category==null || x.optString("plotType")==category)){matched.add(id);rows.put(JSONObject().put("item_id",id).put("tier",x.opt("tier")?:JSONObject.NULL).put("kind",x.opt("kind")?:JSONObject.NULL).put("plot_type",x.opt("plotType")?:JSONObject.NULL).put("stage",x.opt("stage")?:JSONObject.NULL))} }
    val missing=JSONArray();wanted?.filter{it !in matched}?.forEach{missing.put(it)}
    val output=JSONObject().put("status","ok").put("server",server).put("items",rows).put("missing_item_ids",missing).put("catalog_provenance",catalog.optJSONObject("provenance")?:JSONObject.NULL)
     .put("warning","Catalogue identifiers are candidates from a locally embedded source, not verified yields, focus costs or market prices. Nine slots apply only to farm plots. Historical prices are observations, not guaranteed fills.")
    if(npc!=null)output.put("npc_price_reference",npc).put("npc_price_warning","Historical reference for purchases from the farming merchant; not a verified current price for this server. Unknown entries are not market-substituted.")
    if(ids!=null && !p.isNull("city") && !p.isNull("quality") && !p.isNull("days") && matched.isNotEmpty()){
     val selected=JSONArray();for(i in 0 until ids.length()){val id=ids.getString(i);if(id in matched)selected.put(id)}
     val query=JSONObject().put("item_ids",selected).put("city",p.getString("city")).put("quality",p.getInt("quality")).put("days",p.getInt("days"))
      .put("max_cache_age_ms",1_800_000).put("max_observation_age_ms",86_400_000).put("min_usable_days",1)
     output.put("market_averages",market(query,cancelled))
    } else output.put("market_averages",JSONObject.NULL)
    val encoded=output.toString();return if(encoded.length<=48000) encoded else failure("RESULT_LIMIT","Too many results; narrow the catalogue request.").toString()
   } catch(_:CancellationException){return failure("CANCELLED","Island analysis was cancelled.").toString()}
   catch(e:Exception){return failure(if(e.message=="SERVER_MISMATCH") "SERVER_MISMATCH" else "INVALID_ARGUMENT","Invalid island request or unavailable catalogue.").toString()}
  }
 } }
}
