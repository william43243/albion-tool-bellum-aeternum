import com.albion.market.litert.IslandTools
import org.json.JSONArray
import org.json.JSONObject

private fun dataRequest()=JSONObject("""{"item_ids":null,"category":null,"city":null,"days":null,"quality":null}""")
private fun scenario()=JSONObject("""{
 "server":"americas","islands":[{"id":"island-1","island_city":"Thetford",
 "plot_count":8,"occupied_plots":0,"occupied_slots":0,"available_slots":null,
 "crop_allocations":[{"crop_id":"T3_FARM_WHEAT_SEED","plot_count":8,"slot_count":null,"watered_slots":null,"owned_seeds":null,"purchase_source":null,"purchase_city":null}],"animal_allocations":null}],
 "premium":null,"focus_available":null,"specializations":null,"budget_silver":null,"sale_cities":null,"simulation_days":null,"price_days":null,"objective":null}
""".trimIndent())
private fun catalog()=JSONObject("""{"provenance":{"sourceCommit":"test"},"farmables":[{"sourceId":"T3_FARM_WHEAT_SEED","tier":3,"kind":"plant","plotType":"farm","stage":"seeds","raw":{"secret_should_not_escape":123}}]}""")

private fun strict(schema:JSONObject) {
 if(schema.optString("type")=="object") {
  check(!schema.getBoolean("additionalProperties"));val props=schema.getJSONObject("properties");val req=schema.getJSONArray("required")
  check((0 until req.length()).map{req.getString(it)}.toSet()==props.keys().asSequence().toSet())
  for(k in props.keys())strict(props.getJSONObject(k))
 }
 schema.optJSONObject("items")?.let(::strict)
}
fun main() {
 var queries=0
 val tools=IslandTools.all(::catalog,{null},{ q,_->queries++;JSONObject().put("status","ok").put("server","americas").put("results",JSONArray().put(JSONObject().put("status","ok").put("server","americas").put("item_id","T3_FARM_WHEAT_SEED").put("city",q.getString("city")).put("quality",1).put("average",42))) },"americas",{false})
  .associateBy { JSONObject(it.getToolDescriptionJsonString()).getString("name") }
 check(tools.keys==IslandTools.toolActions && tools.size==3)
 for(tool in tools.values)strict(JSONObject(tool.getToolDescriptionJsonString()).getJSONObject("parameters"))
 val list=JSONObject(tools.getValue("get_island_economy_data").execute(dataRequest().toString()))
 check(list.getString("status")=="ok" && list.getJSONArray("items").length()==1 && list.isNull("market_averages"))
 check(!list.toString().contains("secret_should_not_escape") && queries==0)
 val query=dataRequest().put("item_ids",JSONArray().put("T3_FARM_WHEAT_SEED")).put("city","Thetford").put("days",7).put("quality",1)
 check(JSONObject(tools.getValue("get_island_economy_data").execute(query.toString())).getString("status")=="ok" && queries==1)
 check(runCatching{IslandTools.validateToolRequest("get_island_economy_data",JSONObject(query.toString()).put("item_ids",JSONArray((1..17).map{"T${it}_TEST"})))}.isFailure)
 val p=scenario();IslandTools.validateToolRequest("optimize_island_profitability",p,"americas")
 check(runCatching { IslandTools.validateToolRequest("optimize_island_profitability",JSONObject(p.toString()).put("server","europe"),"americas") }.isFailure)
 check(runCatching { IslandTools.validateToolRequest("optimize_island_profitability",JSONObject(p.toString()).put("yield",100),"americas") }.isFailure)
 val bad=JSONObject(p.toString());bad.getJSONArray("islands").getJSONObject(0).getJSONArray("crop_allocations").getJSONObject(0).put("price",1)
 check(runCatching { IslandTools.validateToolRequest("optimize_island_profitability",bad,"americas") }.isFailure)
 val outcome=JSONObject(tools.getValue("optimize_island_profitability").execute(p.toString()))
 check(outcome.optString("status") in setOf("ok","partial"))
 check(outcome.getJSONArray("islands").getJSONObject(0).getInt("total_farm_slots")==72)
 check(outcome.getJSONArray("islands").getJSONObject(0).getJSONArray("crop_allocations").getJSONObject(0).getInt("plantations")==72)
 val slots=JSONObject(p.toString());val island=slots.getJSONArray("islands").getJSONObject(0);island.put("plot_count",JSONObject.NULL).put("occupied_plots",JSONObject.NULL).put("occupied_slots",JSONObject.NULL).put("available_slots",8)
 island.getJSONArray("crop_allocations").getJSONObject(0).put("plot_count",JSONObject.NULL).put("slot_count",8)
 val slotsResult=JSONObject(tools.getValue("optimize_island_profitability").execute(slots.toString()))
 check(slotsResult.getJSONArray("islands").getJSONObject(0).getJSONArray("crop_allocations").getJSONObject(0).getInt("plantations")==8)
 val explicitMarket=JSONObject(p.toString());val allocation=explicitMarket.getJSONArray("islands").getJSONObject(0).getJSONArray("crop_allocations").getJSONObject(0)
 allocation.put("purchase_source","market").put("purchase_city",JSONObject.NULL)
 tools.getValue("optimize_island_profitability").execute(explicitMarket.toString());check(queries==1)
 allocation.put("purchase_city","Thetford").put("owned_seeds",0)
 explicitMarket.put("server",JSONObject.NULL)
 val marketResult=JSONObject(tools.getValue("optimize_island_profitability").execute(explicitMarket.toString()))
 check(queries==2 && marketResult.getJSONObject("market_price_policy").getInt("history_days")==7 && marketResult.getJSONObject("market_price_policy").getBoolean("defaulted_days"))
 check(marketResult.getJSONArray("islands").getJSONObject(0).getJSONArray("crop_allocations").getJSONObject(0).getDouble("seed_unit_price")==42.0)
 check(explicitMarket.isNull("server"))
 val npc=JSONObject(p.toString());npc.getJSONArray("islands").getJSONObject(0).getJSONArray("crop_allocations").getJSONObject(0).put("purchase_city","Thetford")
 tools.getValue("optimize_island_profitability").execute(npc.toString());check(queries==2)
 val invalidSource=JSONObject(explicitMarket.toString());invalidSource.getJSONArray("islands").getJSONObject(0).getJSONArray("crop_allocations").getJSONObject(0).put("purchase_source","fabricated")
 check(runCatching{IslandTools.validateToolRequest("optimize_island_profitability",invalidSource,"americas")}.isFailure)
 val verified=JSONObject().put("status","verified").put("crop_id","T3_FARM_WHEAT_SEED").put("island_city","Thetford").put("sale_city","Martlock").put("premium",true).put("specialization_level",10).put("output_item_id","T3_WHEAT").put("provenance",JSONObject().put("source","test").put("revision","test"))
 val testCatalog=catalog().put("economics_facts",JSONObject().put("entries",JSONArray().put(verified)))
 val requested=mutableListOf<String>()
 val saleTool=IslandTools.all({testCatalog},{null},{q,_-> for(i in 0 until q.getJSONArray("item_ids").length())requested.add(q.getJSONArray("item_ids").getString(i));JSONObject().put("status","ok").put("server","americas").put("results",JSONArray()) },"americas",{false}).first{JSONObject(it.getToolDescriptionJsonString()).getString("name")=="optimize_island_profitability"}
 val saleScenario=JSONObject(p.toString()).put("premium",true).put("sale_cities",JSONArray().put("Martlock")).put("specializations",JSONArray().put(JSONObject().put("item_id","T3_FARM_WHEAT_SEED").put("level",10)))
 saleTool.execute(saleScenario.toString());check(requested==listOf("T3_WHEAT"))
 requested.clear();verified.put("status","unverified");saleTool.execute(saleScenario.toString());check(requested.isEmpty())
 val cancelled=IslandTools.all(::catalog,{null},{_,_->JSONObject()},"americas",{true}).first()
 check(JSONObject(cancelled.execute("{}")).getJSONObject("error").getString("code")=="CANCELLED")
 println("ISLAND TOOLS JVM: strict schemas, server, missing data, 8 plots vs slots and cancellation passed")
}
