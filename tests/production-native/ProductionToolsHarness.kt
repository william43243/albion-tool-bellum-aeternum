import com.albion.market.litert.ProductionTools
import com.albion.market.litert.ProductionScenarioRegistry
import com.albion.market.litert.ProductionScenarioException
import com.albion.market.litert.ProductionEngine
import org.json.JSONArray
import org.json.JSONObject

private fun sample(): JSONObject = JSONObject("""
 {"label":"Test only","quantity":10,"outputPerCraft":1,
  "materials":[{"itemId":"T4_TEST","amountPerCraft":2,"unitPrice":100,"returnable":true}],
  "outputUnitPrice":300,"returnRate":0.25,"stationFeePerCraft":10,"focusPerCraft":2,
  "salesTaxRate":0.04,"sellOrderFeeRate":0.025,"budget":5000,"availableFocus":100,
  "volumeObserved":null,"volumeDays":null}
""".trimIndent())

fun main() {
 val tools = ProductionTools.all().associateBy { JSONObject(it.getToolDescriptionJsonString()).getString("name") }
 check(tools.keys == ProductionTools.toolActions && tools.size == 8)
 val list=tools.getValue("list_production_scenarios")
 check(JSONObject(list.execute("{}")).getJSONArray("scenarios").length()==0)
 val input=sample()
 val approved=ProductionScenarioRegistry.approve(input)
 check(approved.getString("status")=="ok")
 val id=approved.getString("scenarioId")
 input.put("outputUnitPrice",1)
 input.getJSONArray("materials").getJSONObject(0).put("unitPrice",1)
 check(ProductionScenarioRegistry.resolve(id).getDouble("outputUnitPrice")==300.0)
 check(ProductionScenarioRegistry.resolve(id).getJSONArray("materials").getJSONObject(0).getDouble("unitPrice")==100.0)
 val listed=JSONObject(list.execute("{}")).getJSONArray("scenarios")
 check(listed.length()==1 && listed.getJSONObject(0).getString("scenarioId")==id)
 check(!listed.getJSONObject(0).has("materials"))
 for ((action, tool) in tools) {
  if(action=="list_production_scenarios") continue
  val def=JSONObject(tool.getToolDescriptionJsonString())
  val params=def.getJSONObject("parameters")
  check(!params.getBoolean("additionalProperties"))
  val single=action in ProductionTools.singleActions
  val request=if(single) JSONObject().put("scenarioId",id) else JSONObject().put("scenarioIds",JSONArray().put(id)).put("ranking","profit")
  val result=JSONObject(tool.execute(request.toString()))
  check(result.getString("status")=="ok" && result.getString("action")==action)
  check(result.getString("dataSource")=="user_approved_assumptions" && result.isNull("observedAtMs"))
  val scenario=if(single) result.getJSONObject("result") else result.getJSONArray("results").getJSONObject(0)
  check(scenario.getDouble("initialCapitalRequired")==2175.0)
  check(scenario.getDouble("netProfit")==1205.0)
  if(!single) check(result.getString("scope")=="single_scenario_alternatives")
  val unknown="00000000-0000-0000-0000-000000000000"
  val invalid=if(single) JSONObject().put("scenarioId",unknown) else JSONObject().put("scenarioIds",JSONArray().put(unknown)).put("ranking","profit")
  check(JSONObject(tool.execute(invalid.toString())).getJSONObject("error").getString("code")=="SCENARIO_UNAVAILABLE")
  val extra=JSONObject(request.toString()).put("unexpected",true)
  check(JSONObject(tool.execute(extra.toString())).getJSONObject("error").getString("code")=="INVALID_ARGUMENT")
 }
 val cancel=ProductionTools.all({ true }).first { JSONObject(it.getToolDescriptionJsonString()).getString("name")=="calculate_crafting_profit" }
 val cancelled=JSONObject(cancel.execute(JSONObject().put("scenarioId",id).toString()))
 check(cancelled.getJSONObject("error").getString("code")=="CANCELLED")
 check(ProductionScenarioRegistry.approve(sample().put("outputUnitPrice",0)).getString("status")=="error")
 val now=System.currentTimeMillis()
 fun evidence(date:String, price:Double=100.0)=JSONObject().put("key","material:T4_TEST").put("itemId","T4_TEST").put("source","AODP").put("server","americas").put("city","Thetford").put("quality",1).put("side","purchaseImmediate").put("value",price).put("observedAt",date).put("fetchedAt",now)
 val stale=sample().put("priceEvidence",JSONArray().put(evidence("2020-01-01T00:00:00")))
 val staleCode=try { ProductionScenarioRegistry.approve(stale); "no_error" } catch(e:ProductionScenarioException) { e.code }
 check(staleCode=="STALE_PRICE")
 val mismatch=sample().put("priceEvidence",JSONArray().put(evidence("2020-01-01T00:00:00", 101.0)))
 val mismatchCode=try { ProductionScenarioRegistry.approve(mismatch); "no_error" } catch(e:ProductionScenarioException) { e.code }
 check(mismatchCode=="INVALID_PRICE_EVIDENCE")
 val nowString=java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss",java.util.Locale.US).apply{timeZone=java.util.TimeZone.getTimeZone("UTC")}.format(java.util.Date(now))
 val fresh=sample().put("priceEvidence",JSONArray().put(evidence(nowString)))
 val approvedFresh=ProductionScenarioRegistry.approve(fresh,"americas")
 check(approvedFresh.getString("status")=="ok")
 val freshId=approvedFresh.getString("scenarioId")
 val serverCode=try { ProductionScenarioRegistry.resolve(freshId,"europe"); "no_error" } catch(e:ProductionScenarioException) { e.code }
 check(serverCode=="SCENARIO_SERVER_MISMATCH")
 check(ProductionScenarioRegistry.list("europe").length()==1)
 val bridgeServerCode=try { ProductionTools.execute("calculate_crafting_profit",JSONObject().put("scenario",fresh),{ false },"europe"); "no_error" } catch(e:ProductionScenarioException) { e.code }
 check(bridgeServerCode=="SCENARIO_SERVER_MISMATCH")
 val expiredCode=try { ProductionScenarioRegistry.validateEvidence(fresh,now+3_600_001); "no_error" } catch(e:ProductionScenarioException) { e.code }
 check(expiredCode=="STALE_PRICE")
 val end=(now/86_400_000L)*86_400_000L
 val testNow=end+12*3_600_000L
 val history=JSONObject().put("source","AODP").put("server","americas").put("itemId","T4_TEST_OUTPUT").put("city","Thetford").put("quality",1)
  .put("observedAt",end-86_400_000L).put("fetchedAt",testNow).put("startMs",end-7*86_400_000L).put("endMs",end)
  .put("observedBuckets",7).put("requestedDays",7).put("observedUnits",40)
 val withHistory=sample().put("volumeObserved",40).put("volumeDays",7).put("volumeEvidence",history)
 check(ProductionScenarioRegistry.validateEvidence(withHistory,testNow)>testNow)
 val expiredHistoryCode=try { ProductionScenarioRegistry.validateEvidence(withHistory,testNow+3_600_001); "no_error" } catch(e:ProductionScenarioException) { e.code }
 check(expiredHistoryCode=="STALE_VOLUME")
 val partial=JSONObject(withHistory.toString()); partial.getJSONObject("volumeEvidence").put("observedBuckets",6)
 val partialCode=try { ProductionScenarioRegistry.validateEvidence(partial,testNow); "no_error" } catch(e:ProductionScenarioException) { e.code }
 check(partialCode=="INVALID_VOLUME_EVIDENCE")
 val metadata=JSONObject().put("outputItemId","T4_TEST_OUTPUT").put("tier",4).put("quality",1).put("sellCity","Thetford").put("productionCity","Martlock").put("saleSide","saleImmediate")
 val metadataScenario=sample().put("metadata",metadata).put("sellOrderFeeRate",0)
 val metadataResult=ProductionTools.execute("calculate_crafting_profit",JSONObject().put("scenario",metadataScenario),{false},"americas")
 check(metadataResult.getJSONObject("result").getJSONObject("metadata").getString("outputItemId")=="T4_TEST_OUTPUT")
 check(metadataResult.getJSONObject("result").getJSONObject("metadata").getString("productionCity")=="Martlock")
 check(runCatching { ProductionTools.validateScenario(metadataScenario.put("sellOrderFeeRate",0.025)) }.isFailure)
 // Declared constraints survive copies, AI approval and execution. They are not authenticated source data.
 val recipe=JSONObject().put("id","TEST#root:0").put("revision","test-revision").put("silverCost",10)
  .put("swapTransaction",JSONObject.NULL).put("cappedReturn",false).put("nonReturnableItemIds",JSONArray())
 val linked=sample().put("metadata",JSONObject().put("recipe",recipe))
 ProductionTools.validateScenario(linked)
 val linkedApproval=ProductionScenarioRegistry.approve(linked)
 val linkedId=linkedApproval.getString("scenarioId")
 recipe.put("silverCost",1)
 val restored=ProductionScenarioRegistry.resolve(linkedId)
 check(restored.getJSONObject("metadata").getJSONObject("recipe").getInt("silverCost")==10)
 restored.put("stationFeePerCraft",9)
 check(runCatching { ProductionTools.validateScenario(restored) }.isFailure)
 val direct=ProductionEngine().execute("calculate_crafting_profit",JSONObject().put("scenario",restored))
 check(direct.getJSONObject("error").getString("code")=="RECIPE_FIXED_COST")
 for (key in listOf("swapTransaction", "cappedReturn")) {
  val unsupported=sample().put("metadata",JSONObject().put("recipe",JSONObject(recipe.toString()).put(key,true)))
  check(runCatching { ProductionTools.validateScenario(unsupported) }.isFailure)
  check(ProductionEngine().execute("calculate_crafting_profit",JSONObject().put("scenario",unsupported)).getJSONObject("error").getString("code")=="UNSUPPORTED_RECIPE")
 }
 val missingRevision=JSONObject(recipe.toString()).apply { remove("revision") }
 val malformed=sample().put("metadata",JSONObject().put("recipe",missingRevision))
 check(runCatching { ProductionTools.validateScenario(malformed) }.isFailure)
 val declared=JSONObject(recipe.toString()).put("nonReturnableItemIds",JSONArray().put("T4_TEST"))
 val nonReturn=sample().put("metadata",JSONObject().put("recipe",declared))
 check(ProductionEngine().execute("calculate_crafting_profit",JSONObject().put("scenario",nonReturn)).getJSONObject("error").getString("code")=="RECIPE_NON_RETURNABLE")
 check(runCatching { ProductionTools.validateScenario(nonReturn) }.isFailure)
 nonReturn.getJSONArray("materials").getJSONObject(0).put("returnable",false)
 ProductionTools.validateScenario(nonReturn)
 val nonReturnId=ProductionScenarioRegistry.approve(nonReturn).getString("scenarioId")
 val transferred=ProductionScenarioRegistry.resolve(nonReturnId)
 check(transferred.getJSONObject("metadata").getJSONObject("recipe").getJSONArray("nonReturnableItemIds").getString(0)=="T4_TEST")
 transferred.getJSONArray("materials").getJSONObject(0).put("returnable",true)
 check(runCatching { ProductionTools.validateScenario(transferred) }.isFailure)
 val missingList=sample().put("metadata",JSONObject().put("recipe",JSONObject(recipe.toString()).apply { remove("nonReturnableItemIds") }))
 check(runCatching { ProductionTools.validateScenario(missingList) }.isFailure)
 val invalidAction=runCatching { ProductionTools.validateRequest("bogus",JSONObject()) }.isFailure
 check(invalidAction)
 moduleHarness()
 println("PRODUCTION TOOLS JVM: eight schemas, approved IDs, stale prices and cancellation passed")
}
