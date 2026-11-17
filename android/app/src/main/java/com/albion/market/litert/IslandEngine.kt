package com.albion.market.litert

import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CancellationException

/** Island capacity and expected economics; input facts are supplied by trusted catalog adapters. */
object IslandEngine {
    private const val FARM_SLOTS = 9
    private val cities = setOf("Martlock", "Thetford", "Lymhurst", "Fort Sterling", "Bridgewatch", "Caerleon", "Brecilien")
    private class Invalid(val code:String, message:String): Exception(message)
    private fun nullable(value:Any?):Any = value ?: JSONObject.NULL
    private fun check(cancelled:()->Boolean) { if(cancelled() || Thread.currentThread().isInterrupted) throw CancellationException() }
    private fun required(o:JSONObject,key:String):Any { if(!o.has(key)) throw Invalid("MISSING_FIELD", "Missing $key"); return o.get(key) }
    private fun optionalInt(o:JSONObject,key:String,max:Int):Int? {
        val v=required(o,key); if(v===JSONObject.NULL) return null
        if(v !is Number || !v.toDouble().isFinite() || v.toDouble()%1.0!=0.0 || v.toDouble()<0 || v.toDouble()>max) throw Invalid("INVALID_ARGUMENT","Invalid $key")
        return v.toInt()
    }
    private fun optionalArray(o:JSONObject,key:String):JSONArray? {
        val v=required(o,key); if(v===JSONObject.NULL) return null
        return v as? JSONArray ?: throw Invalid("INVALID_ARGUMENT","Invalid $key")
    }
    private fun text(o:JSONObject,key:String,max:Int):String {
        val v=required(o,key); if(v !is String || v.isBlank() || v.length>max) throw Invalid("INVALID_ARGUMENT","Invalid $key")
        return v.trim()
    }
    private fun jsonError(code:String,msg:String)=JSONObject().put("status","error").put("error",JSONObject().put("code",code).put("message",msg))

    /**
     * marketSnapshot is internal only: the tool adapter, not the model, owns its provenance.
     * Null economic fields are intentionally not replaced by speculative defaults.
     */
    @JvmStatic fun execute(request:JSONObject,catalog:JSONObject,marketSnapshot:JSONObject?,cancelled:()->Boolean):JSONObject {
        try {
            check(cancelled)
            val islands=required(request,"islands") as? JSONArray ?: throw Invalid("MISSING_CAPACITY","Provide islands and their known capacity.")
            if(islands.length() !in 1..32) throw Invalid("LIMIT_EXCEEDED","Provide 1 to 32 islands.")
            val farmables=catalog.optJSONArray("farmables") ?: throw Invalid("CATALOG_UNAVAILABLE","Island catalogue unavailable.")
            val farmSeeds=HashSet<String>()
            val animalIds=HashSet<String>()
            for(i in 0 until farmables.length()) { val f=farmables.optJSONObject(i) ?: continue; if(f.optString("plotType")=="farm" && f.optString("stage")=="seeds") farmSeeds.add(f.optString("sourceId")); if(f.optString("kind")=="animal") animalIds.add(f.optString("sourceId")) }
            val npcPrices=HashMap<String,Pair<Double,JSONObject>>()
            val npcCatalog=catalog.optJSONObject("npc_prices")
            val npcEntries=npcCatalog?.optJSONArray("entries")
            if(npcEntries!=null) for(i in 0 until npcEntries.length()) {
                val entry=npcEntries.optJSONObject(i) ?: continue
                val value=entry.opt("value")
                if(entry.optString("status") in setOf("reference","verified") && entry.optString("currency")=="silver" && entry.optString("transaction")=="player_buys_from_farming_merchant" && value is Number && value.toDouble().isFinite() && value.toDouble()>0 && value.toDouble()<=1e12)
                    npcPrices[entry.optString("itemId")]=Pair(value.toDouble(),entry)
            }
            val activeServer=request.optString("server","")
            val marketRows=marketSnapshot?.optJSONArray("snapshots")
            fun marketPrice(item:String,city:String?):JSONObject? {
                if(city==null || marketRows==null) return null
                for(k in 0 until marketRows.length()) {
                    val snapshot=marketRows.optJSONObject(k) ?: continue
                    if(snapshot.optString("status")!="ok" || snapshot.optString("server")!=activeServer) continue
                    val data=snapshot.optJSONArray("results") ?: continue
                    for(n in 0 until data.length()) { val row=data.optJSONObject(n) ?: continue; val price=row.opt("average")
                        if(row.optString("status")=="ok" && row.optString("item_id")==item && row.optString("server")==activeServer && row.optString("city")==city && row.optInt("quality")==1 && price is Number && price.toDouble().isFinite() && price.toDouble()>0 && price.toDouble()<=1e12) return row
                    }
                }
                return null
            }
            val missing=linkedSetOf<String>(); val result=JSONArray(); val ids=HashSet<String>()
            val facts=catalog.optJSONObject("economics_facts")?.optJSONArray("entries")
            var allocatedTotal=0; var availableTotal=0; var allCapacityKnown=true; var allAllocationsKnown=true; var cropCount=0
            var knownInitialSeedCost=0.0;var allInitialSeedCostsKnown=true
            for(i in 0 until islands.length()) {
                check(cancelled)
                val island=islands.optJSONObject(i) ?: throw Invalid("INVALID_ARGUMENT","Each island must be an object.")
                val id=text(island,"id",80); if(!ids.add(id)) throw Invalid("INVALID_ARGUMENT","Island IDs must be unique.")
                val cityRaw=required(island,"island_city")
                val city=if(cityRaw===JSONObject.NULL) null else if(cityRaw is String && cityRaw in cities) cityRaw else throw Invalid("INVALID_ARGUMENT","Invalid island_city")
                if(city==null) missing.add("islands[$i].island_city")
                val plots=optionalInt(island,"plot_count",1000); val occupied=optionalInt(island,"occupied_plots",1000)
                val occupiedSlots=optionalInt(island,"occupied_slots",9000); val suppliedAvailable=optionalInt(island,"available_slots",9000)
                if(plots==null && occupied!=null) throw Invalid("INVALID_ARGUMENT","occupied_plots requires plot_count.")
                if(plots!=null && occupied!=null && occupied>plots) throw Invalid("INVALID_ARGUMENT","Occupied plots exceed total plots.")
                if(plots==null && occupiedSlots!=null && occupiedSlots!=0) throw Invalid("INVALID_ARGUMENT","occupied_slots requires plot_count.")
                val totalSlots=plots?.times(FARM_SLOTS)
                val knownAvailable=if(plots!=null && occupied!=null) {
                    val available=(plots-occupied)*FARM_SLOTS-(occupiedSlots?:0)
                    if(available<0) throw Invalid("INVALID_ARGUMENT","Occupied slots exceed remaining plot capacity.")
                    if(suppliedAvailable!=null && suppliedAvailable!=available) throw Invalid("INVALID_ARGUMENT","available_slots conflicts with plot and occupation counts.")
                    available
                } else suppliedAvailable
                if(totalSlots!=null && suppliedAvailable!=null && suppliedAvailable>totalSlots) throw Invalid("INVALID_ARGUMENT","available_slots exceeds total capacity.")
                if(knownAvailable==null) { allCapacityKnown=false; missing.add("islands[$i].available_slots_or_occupation") } else availableTotal+=knownAvailable
                val specifiedCrops=optionalArray(island,"crop_allocations")
                if(specifiedCrops==null) { allAllocationsKnown=false; missing.add("islands[$i].crop_allocations_or_optimization_data") }
                val crops=specifiedCrops ?: JSONArray()
                if(crops.length()>64) throw Invalid("LIMIT_EXCEEDED","Too many crop allocations.")
                val rows=JSONArray(); var used=0
                for(j in 0 until crops.length()) {
                    check(cancelled); if(++cropCount>128) throw Invalid("LIMIT_EXCEEDED","Too many crop allocations.")
                    val crop=crops.optJSONObject(j) ?: throw Invalid("INVALID_ARGUMENT","Invalid crop allocation.")
                    val cropId=text(crop,"crop_id",128)
                    if(cropId !in farmSeeds) throw Invalid("UNKNOWN_CROP","Crop is absent from the local farm-seed catalogue.")
                    val cropPlots=optionalInt(crop,"plot_count",1000); val cropSlots=optionalInt(crop,"slot_count",9000)
                    if((cropPlots==null)==(cropSlots==null)) throw Invalid("INVALID_ARGUMENT","Supply exactly one of crop plot_count or slot_count.")
                    val plants=cropSlots ?: cropPlots!! * FARM_SLOTS
                    if(plants<=0) throw Invalid("INVALID_ARGUMENT","Crop allocation must be positive.")
                    val watered=optionalInt(crop,"watered_slots",9000)
                    if(watered!=null && watered>plants) throw Invalid("INVALID_ARGUMENT","Watered slots exceed planted slots.")
                    val sourceRaw=if(crop.has("purchase_source")) crop.get("purchase_source") else JSONObject.NULL
                    val purchaseSource=if(sourceRaw===JSONObject.NULL) "npc" else if(sourceRaw is String && sourceRaw in setOf("npc","market")) sourceRaw else throw Invalid("INVALID_ARGUMENT","Invalid purchase_source")
                    val cityValue=if(crop.has("purchase_city")) crop.get("purchase_city") else JSONObject.NULL
                    val purchaseCity=if(cityValue===JSONObject.NULL) null else if(cityValue is String && cityValue in cities) cityValue else throw Invalid("INVALID_ARGUMENT","Invalid purchase_city")
                    val owned=if(crop.has("owned_seeds")) optionalInt(crop,"owned_seeds",1_000_000) else null
                    val ref=if(purchaseSource=="npc") npcPrices[cropId] else null
                    val market=if(purchaseSource=="market") marketPrice(cropId,purchaseCity) else null
                    val price=if(purchaseSource=="npc") ref?.first else (market?.opt("average") as? Number)?.toDouble()
                    if(price==null) missing.add(if(purchaseSource=="npc") "islands[$i].crop_allocations[$j].npc_price_reference" else if(purchaseCity==null) "islands[$i].crop_allocations[$j].purchase_city" else "islands[$i].crop_allocations[$j].fresh_market_average")
                    if(owned==null) missing.add("islands[$i].crop_allocations[$j].owned_seeds_for_actual_outlay")
                    val initial=if(price!=null && owned!=null) price*maxOf(0,plants-owned) else null
                    if(initial==null) allInitialSeedCostsKnown=false else knownInitialSeedCost+=initial
                    if(!knownInitialSeedCost.isFinite() || knownInitialSeedCost>9e15) throw Invalid("LIMIT_EXCEEDED","Initial seed costs exceed supported range.")
                    // The following branch accepts only separately verified, internal catalogue facts.
                    // Raw dump attributes and all numeric model request fields are deliberately ignored.
                    var economics:JSONObject?=null
                    val premium=request.opt("premium") as? Boolean
                    val specs=request.optJSONArray("specializations")
                    val levels=ArrayList<Int>()
                    if(specs!=null) for(k in 0 until specs.length()) {
                        val spec=specs.optJSONObject(k) ?: continue;val n=spec.opt("level")
                        if(spec.optString("item_id")==cropId && n is Number && n.toDouble().isFinite() && n.toDouble()%1.0==0.0 && n.toDouble() in 0.0..100.0) levels.add(n.toInt())
                    }
                    val saleCities=request.optJSONArray("sale_cities")
                    val saleCity=if(saleCities!=null && saleCities.length()==1) saleCities.optString(0).takeIf { it in cities } else null
                    val matching=ArrayList<JSONObject>()
                    if(facts!=null && city!=null && premium!=null && levels.size==1 && saleCity!=null) for(k in 0 until facts.length()) {
                        val entry=facts.optJSONObject(k) ?: continue;val provenance=entry.optJSONObject("provenance")
                        if(entry.optString("status")=="verified" && entry.optString("crop_id")==cropId && entry.optString("island_city")==city && entry.optString("sale_city")==saleCity && entry.opt("premium")==premium && entry.opt("specialization_level") is Number && entry.optDouble("specialization_level")==levels[0].toDouble() && provenance!=null && provenance.optString("source").isNotBlank() && provenance.optString("revision").isNotBlank()) matching.add(entry)
                    }
                    val fact=matching.singleOrNull()
                    val sourceItem=fact?.optString("output_item_id")?.takeIf { it.matches(Regex("[A-Za-z0-9_@.-]{1,128}")) }
                    val salePrice=sourceItem?.let { marketPrice(it,saleCity) }
                    val ownedEvidence=if(owned!=null && owned>0) marketPrice(cropId,saleCity) else null
                    val ownedValue=if(owned==0) 0.0 else (ownedEvidence?.opt("average") as? Number)?.toDouble()
                    val trustedPurchase=if(purchaseSource=="npc") ref?.second?.let { it.optString("status")=="verified" && it.optString("server")==activeServer && it.optString("verifiedAt").isNotBlank() && it.optString("source").isNotBlank() } == true else market!=null
                    if(fact!=null && price!=null && trustedPurchase && cropPlots!=null && owned!=null && ownedValue!=null && watered!=null && salePrice!=null) {
                        try {
                            val days=if(request.has("simulation_days") && !request.isNull("simulation_days")) request.getInt("simulation_days") else null
                            val cadence=fact.opt("cycleDays");val cycleDays=if(cadence is Number && cadence.toDouble().isFinite() && cadence.toDouble()>0) cadence.toDouble() else null
                            val cycles=if(days==null) 1 else if(cycleDays!=null) kotlin.math.floor(days/cycleDays).toInt() else 0
                            if(cycles in 1..3650) {
                                val input=JSONObject().put("plots",cropPlots).put("slotsPerPlot",FARM_SLOTS).put("slotsUsed",plants)
                                    .put("wateredSlots",watered).put("ownedSeeds",minOf(owned,plants)).put("replacementSeedPrice",price)
                                    .put("ownedSeedOpportunityPrice",ownedValue).put("harvestPerSlot",fact.get("harvestPerSlot"))
                                    .put("cityYieldMultiplier",fact.get("cityYieldMultiplier")).put("outputSalePrice",salePrice.get("average"))
                                    .put("saleTaxRate",fact.get("saleTaxRate")).put("saleFeePerCycle",fact.get("saleFeePerCycle"))
                                    .put("seedReturnWithoutFocus",fact.get("seedReturnWithoutFocus")).put("seedReturnWithFocus",fact.get("seedReturnWithFocus"))
                                    .put("focusPerWateredSlot",fact.get("focusPerWateredSlot")).put("cycleCount",cycles).put("cycleDays",nullable(cycleDays))
                                val calc=IslandEconomics.calculate(input,cancelled)
                                if(calc.optString("status")=="error" && calc.optJSONObject("error")?.optString("code")=="CANCELLED") throw CancellationException()
                                if(calc.optString("status")=="ok") economics=calc.put("facts_provenance",fact.getJSONObject("provenance")).put("sale_price_evidence",salePrice).put("owned_seed_opportunity_evidence",ownedEvidence ?: JSONObject.NULL)
                            }
                        } catch(e:CancellationException) {throw e} catch(_:Exception) { /* Incomplete or invalid facts remain unknown. */ }
                    }
                    if(economics==null) missing.add("islands[$i].crop_allocations[$j].verified_economics_or_market_data")
                    used+=plants; if(used>9000) throw Invalid("LIMIT_EXCEEDED","Island allocation is too large.")
                    rows.put(JSONObject().put("crop_id",cropId).put("plot_count",nullable(cropPlots)).put("plantations",plants)
                        .put("seeds_first_cycle",plants).put("watered_slots",nullable(watered))
                        .put("purchase_source",purchaseSource).put("purchase_city",nullable(purchaseCity)).put("owned_seeds",nullable(owned))
                        .put("seed_unit_price",nullable(price)).put("seed_price_status",if(price==null) "unknown" else if(purchaseSource=="npc") "npc_reference" else "historical_market_average")
                        .put("seed_price_evidence",if(purchaseSource=="npc") ref?.second ?: JSONObject.NULL else market ?: JSONObject.NULL)
                        .put("cost_if_all_seeds_purchased",nullable(price?.times(plants)))
                        .put("initial_seed_cost",nullable(initial)).put("expected_harvest",JSONObject.NULL)
                        .put("expected_returned_seeds",JSONObject.NULL).put("economic_profit",JSONObject.NULL)
                        .put("economics_mean_flow",economics ?: JSONObject.NULL))
                    if(watered==null) missing.add("islands[$i].crop_allocations[$j].watering_or_focus")
                }
                if(knownAvailable!=null && used>knownAvailable) throw Invalid("INSUFFICIENT_CAPACITY","Crop allocations exceed available slots.")
                val animals=optionalArray(island,"animal_allocations")
                if(animals!=null && animals.length()>64) throw Invalid("LIMIT_EXCEEDED","Too many animal allocations.")
                val animalPurchases=JSONArray()
                if(animals!=null && animals.length()>0) {
                    missing.add("animal_economics_and_capacity_not_verified")
                    for(j in 0 until animals.length()) {
                        check(cancelled)
                        val animal=animals.optJSONObject(j) ?: throw Invalid("INVALID_ARGUMENT","Invalid animal allocation.")
                        if(text(animal,"animal_id",128) !in animalIds) throw Invalid("UNKNOWN_ANIMAL","Animal is absent from the local catalogue.")
                        val purchase=IslandAnimalPurchases.calculate(animal,npcCatalog,marketSnapshot,activeServer,System.currentTimeMillis(),1_800_000L,86_400_000L)
                        if(purchase.optString("status")=="error") throw Invalid("INVALID_ARGUMENT","Invalid animal purchase.")
                        if(purchase.optString("status")=="partial") missing.add("islands[$i].animal_allocations[$j].purchase_data")
                        animalPurchases.put(purchase)
                    }
                }
                allocatedTotal+=used
                result.put(JSONObject().put("id",id).put("island_city",nullable(city)).put("plot_count",nullable(plots))
                    .put("slots_per_farm_plot",FARM_SLOTS).put("total_farm_slots",nullable(totalSlots)).put("occupied_plots",nullable(occupied))
                    .put("occupied_slots",nullable(occupiedSlots)).put("available_farm_slots",nullable(knownAvailable))
                    .put("allocated_farm_slots",used).put("remaining_farm_slots",nullable(knownAvailable?.minus(used))).put("crop_allocations",rows)
                    .put("animal_allocations_received",animals?.length()?:0).put("animal_purchases",animalPurchases))
            }
            if(cropCount>0) missing.add("aggregate_economic_profit_and_ranking_unavailable")
            val budgetRaw=request.opt("budget_silver");val budget=if(budgetRaw is Number && budgetRaw.toDouble().isFinite() && budgetRaw.toDouble()>=0) budgetRaw.toDouble() else null
            val budgetStatus=when { budget==null -> "unknown_budget";knownInitialSeedCost>budget -> "estimated_seed_cost_exceeds_budget";!allInitialSeedCostsKnown || !allAllocationsKnown -> "incomplete_seed_cost";else -> "estimated_seed_cost_within_budget_only" }
            return JSONObject().put("status",if(missing.isEmpty()) "ok" else "partial").put("islands",result)
                .put("total_available_farm_slots",if(allCapacityKnown) availableTotal else JSONObject.NULL)
                .put("total_plantations",if(allAllocationsKnown) allocatedTotal else JSONObject.NULL).put("seeds_first_cycle",if(allAllocationsKnown) allocatedTotal else JSONObject.NULL)
                .put("missing_fields",JSONArray(missing.toList())).put("economic_profit",JSONObject.NULL).put("realized_cash_profit",JSONObject.NULL)
                .put("initial_seed_cost_known_subtotal",knownInitialSeedCost).put("initial_seed_cost_total",if(allInitialSeedCostsKnown && allAllocationsKnown) knownInitialSeedCost else JSONObject.NULL)
                .put("budget_silver",nullable(budget)).put("budget_check",budgetStatus).put("budget_check_basis","Seed prices may be historical references or averages, not guaranteed current executable prices; other costs are excluded.")
                .put("units",JSONObject().put("plots","farm plots").put("slots","planting positions").put("seeds_first_cycle","seeds"))
                .put("assumptions",JSONArray().put("A farm plot has 9 positions, as specified by the user; no capacity is inferred for herb gardens or animal facilities.")
                    .put("Occupied slots default to zero only when whole occupied plots are explicitly supplied.")
                    .put("Expected returns are not guaranteed sales or cash."))
                .put("catalog_source",catalog.optJSONObject("provenance") ?: JSONObject.NULL)
                .put("market_snapshot_available",marketSnapshot!=null).put("ranking_available",false)
        } catch(e:Invalid){return jsonError(e.code,e.message?:"Invalid island request.")}
          catch(_:CancellationException){return jsonError("CANCELLED","Island analysis was cancelled.")}
          catch(_:Exception){return jsonError("INVALID_ARGUMENT","Invalid island request.")}
    }
}
