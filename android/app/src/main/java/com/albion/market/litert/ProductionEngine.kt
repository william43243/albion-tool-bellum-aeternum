package com.albion.market.litert

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.ceil

/** Deterministic estimates from explicit, caller-supplied assumptions only. */
class ProductionEngine @JvmOverloads constructor(private val cancelled: () -> Boolean = { false }) {
    private class InputError(val code: String, message: String) : RuntimeException(message)
    private val single = setOf("calculate_crafting_profit", "analyze_market_liquidity", "calculate_focus_efficiency")
    private val ranked = setOf("find_profitable_crafts", "optimize_refining", "optimize_production_plan", "compare_crafting_routes")
    private val maximum = 9_000_000_000_000_000.0
    private val scenarioKeys = setOf("label", "quantity", "outputPerCraft", "materials", "outputUnitPrice", "returnRate", "stationFeePerCraft", "focusPerCraft", "salesTaxRate", "sellOrderFeeRate", "budget", "availableFocus", "volumeObserved", "volumeDays", "priceEvidence", "volumeEvidence", "metadata")

    private fun checkCancelled() {
        if (cancelled() || Thread.currentThread().isInterrupted) throw InputError("CANCELLED", "Analysis was cancelled.")
    }

    private fun field(o: JSONObject, key: String): Any {
        if (!o.has(key)) throw InputError("MISSING_FIELD", "Missing field: $key")
        return o.get(key)
    }

    private fun allowed(o: JSONObject, keys: Set<String>) {
        val it = o.keys()
        while (it.hasNext()) if (it.next() !in keys) throw InputError("INVALID_FIELD", "Unexpected field in production request.")
    }

    private fun number(o: JSONObject, key: String, max: Double = maximum, positive: Boolean = false): Double {
        val raw = field(o, key)
        if (raw !is Number) throw InputError("INVALID_FIELD", "$key must be a number.")
        val value = raw.toDouble()
        if (!value.isFinite() || value < 0 || value > max || (positive && value == 0.0))
            throw InputError("INVALID_FIELD", "$key is outside its allowed range.")
        return value
    }

    private fun optionalNumber(o: JSONObject, key: String, positive: Boolean = false): Double? {
        val raw = field(o, key)
        if (raw === JSONObject.NULL) return null
        return number(o, key, positive = positive)
    }

    private fun integer(o: JSONObject, key: String, max: Double): Int {
        val v = number(o, key, max, true)
        if (v % 1.0 != 0.0) throw InputError("INVALID_FIELD", "$key must be an integer.")
        return v.toInt()
    }

    private fun text(o: JSONObject, key: String, limit: Int): String {
        val raw = field(o, key)
        if (raw !is String || raw.trim().isEmpty() || raw.length > limit)
            throw InputError("INVALID_FIELD", "$key must be a non-empty string of at most $limit characters.")
        return raw.trim()
    }

    private fun obj(o: JSONObject, key: String): JSONObject = field(o, key) as? JSONObject
        ?: throw InputError("INVALID_FIELD", "$key must be an object.")

    private fun array(o: JSONObject, key: String): JSONArray = field(o, key) as? JSONArray
        ?: throw InputError("INVALID_FIELD", "$key must be an array.")

    private fun safe(v: Double): Double {
        if (!v.isFinite() || v < 0 || v > maximum) throw InputError("LIMIT_EXCEEDED", "Scenario amounts exceed the supported calculation range.")
        return v
    }

    private fun signedSafe(v: Double): Double {
        if (!v.isFinite() || kotlin.math.abs(v) > maximum) throw InputError("LIMIT_EXCEEDED", "Calculated ratio exceeds the supported range.")
        return v
    }

    private fun nullable(value: Double?): Any = value ?: JSONObject.NULL

    /** Validate declared catalogue constraints, not the authenticity of their provenance. */
    fun validateRecipeMetadata(s: JSONObject) {
        if (!s.has("metadata")) return
        val metadata = obj(s, "metadata")
        if (!metadata.has("recipe")) return
        val recipe = obj(metadata, "recipe")
        val fields = setOf("id", "revision", "silverCost", "swapTransaction", "cappedReturn", "nonReturnableItemIds")
        if (recipe.keys().asSequence().toSet() != fields)
            throw InputError("INVALID_FIELD", "Recipe provenance is incomplete or contains unknown fields.")
        text(recipe, "id", 200)
        text(recipe, "revision", 128)
        val silver = optionalNumber(recipe, "silverCost")
        val swap = field(recipe, "swapTransaction")
        if (swap !== JSONObject.NULL && swap !is Boolean)
            throw InputError("INVALID_FIELD", "Recipe swapTransaction must be a boolean or null.")
        val capped = field(recipe, "cappedReturn")
        if (capped !is Boolean) throw InputError("INVALID_FIELD", "Recipe cappedReturn must be a boolean.")
        if (swap == true || capped)
            throw InputError("UNSUPPORTED_RECIPE", "Swaps and capped returns are not supported.")
        if (silver != null && number(s, "stationFeePerCraft") < silver)
            throw InputError("RECIPE_FIXED_COST", "The declared fixed recipe cost must be included in the per-craft fee.")
        val nonReturnable = array(recipe, "nonReturnableItemIds")
        if (nonReturnable.length() > 64) throw InputError("INVALID_FIELD", "Too many non-returnable recipe materials.")
        val materials = array(s, "materials")
        val seen = HashSet<String>()
        for (i in 0 until nonReturnable.length()) {
            checkCancelled()
            val id = nonReturnable.opt(i) as? String
                ?: throw InputError("INVALID_FIELD", "Non-returnable material IDs must be strings.")
            if (id.isBlank() || id.length > 128 || id != id.trim() || !seen.add(id))
                throw InputError("INVALID_FIELD", "Non-returnable material IDs must be distinct and valid.")
            var matches = 0
            for (j in 0 until materials.length()) {
                checkCancelled()
                val material = materials.opt(j) as? JSONObject ?: throw InputError("INVALID_FIELD", "Invalid material.")
                if (material.opt("itemId") == id) {
                    matches++
                    if (material.opt("returnable") != false)
                        throw InputError("RECIPE_NON_RETURNABLE", "A declared non-returnable material cannot be returned.")
                }
            }
            if (matches != 1) throw InputError("INVALID_FIELD", "A declared non-returnable material must be present exactly once.")
        }
    }

    private fun calculate(s: JSONObject): JSONObject {
        checkCancelled()
        allowed(s, scenarioKeys)
        if (s.has("metadata") && s.opt("metadata") !is JSONObject) throw InputError("INVALID_FIELD", "metadata must be an object.")
        validateRecipeMetadata(s)
        val label = text(s, "label", 120)
        val quantity = integer(s, "quantity", 1_000_000.0)
        val outputPerCraft = integer(s, "outputPerCraft", 1_000_000.0)
        val outputUnits = safe(quantity.toDouble() * outputPerCraft)
        val items = array(s, "materials")
        if (items.length() !in 1..64) throw InputError("LIMIT_EXCEEDED", "Provide between 1 and 64 materials.")
        val returnRate = number(s, "returnRate", 1.0)
        if (returnRate >= 1.0) throw InputError("INVALID_FIELD", "returnRate must be less than 1.")
        val unitPrice = number(s, "outputUnitPrice", positive = true)
        val stationFee = number(s, "stationFeePerCraft")
        val focusPerCraft = number(s, "focusPerCraft")
        val salesTaxRate = number(s, "salesTaxRate", 1.0)
        val sellOrderFeeRate = number(s, "sellOrderFeeRate", 1.0)
        val budget = optionalNumber(s, "budget")
        val availableFocus = optionalNumber(s, "availableFocus")
        val volume = optionalNumber(s, "volumeObserved")
        val days = optionalNumber(s, "volumeDays", true)
        if ((volume == null) != (days == null)) throw InputError("INVALID_FIELD", "volumeObserved and volumeDays must both be supplied or both be null.")

        var grossMaterials = 0.0
        var returnedValue = 0.0
        val details = JSONArray()
        val ids = HashSet<String>()
        for (i in 0 until items.length()) {
            checkCancelled()
            val item = items.opt(i) as? JSONObject ?: throw InputError("INVALID_FIELD", "Each material must be an object.")
            allowed(item, setOf("itemId", "amountPerCraft", "unitPrice", "returnable"))
            val id = text(item, "itemId", 128)
            if (!ids.add(id)) throw InputError("INVALID_FIELD", "Duplicate material itemId: $id")
            val amount = number(item, "amountPerCraft", positive = true)
            val cost = number(item, "unitPrice", positive = true)
            val returnable = field(item, "returnable") as? Boolean ?: throw InputError("INVALID_FIELD", "returnable must be a boolean.")
            val grossUnits = safe(amount * quantity)
            val returnedUnits = if (returnable) safe(grossUnits * returnRate) else 0.0
            val gross = safe(grossUnits * cost)
            val returned = safe(returnedUnits * cost)
            grossMaterials = safe(grossMaterials + gross)
            returnedValue = safe(returnedValue + returned)
            details.put(JSONObject().put("itemId", id).put("grossUnits", grossUnits).put("expectedReturnedUnits", returnedUnits)
                .put("expectedConsumedUnits", grossUnits - returnedUnits).put("unitPrice", cost).put("upfrontCost", gross)
                .put("expectedReturnedValue", returned).put("expectedNetCost", gross - returned).put("returnable", returnable))
        }
        val stationTotal = safe(stationFee * quantity)
        val expectedMaterialCost = safe(grossMaterials - returnedValue)
        val expectedTotalCost = safe(expectedMaterialCost + stationTotal)
        val grossRevenue = safe(outputUnits * unitPrice)
        val salesTax = safe(ceil(grossRevenue * salesTaxRate))
        val listingFee = safe(ceil(grossRevenue * sellOrderFeeRate))
        // Listing fees are paid when an order is created, before any sale proceeds.
        val upfront = safe(grossMaterials + stationTotal + listingFee)
        val profit = grossRevenue - salesTax - listingFee - expectedTotalCost
        if (!profit.isFinite() || kotlin.math.abs(profit) > maximum) throw InputError("LIMIT_EXCEEDED", "Profit exceeds the supported calculation range.")
        val focus = safe(focusPerCraft * quantity)
        val roi = if (upfront > 0) signedSafe(100.0 * (profit / upfront)) else null
        val silverPerFocus = if (focus > 0) signedSafe(profit / focus) else null
        val violations = JSONArray()
        if (budget != null && upfront > budget) violations.put("insufficient_budget")
        if (availableFocus != null && focus > availableFocus) violations.put("insufficient_focus")
        val perDay = if (volume != null && days != null) volume / days else null
        val saleDays = if (perDay != null && perDay > 0.0) outputUnits / perDay else null
        if (perDay != null && (!perDay.isFinite() || perDay > maximum)) throw InputError("LIMIT_EXCEEDED", "Observed daily volume exceeds the supported range.")
        if (saleDays != null && (!saleDays.isFinite() || saleDays > maximum)) throw InputError("LIMIT_EXCEEDED", "Sale estimate exceeds the supported range.")

        return JSONObject().put("label", label).put("provenance", "manual")
            .put("quantity", quantity).put("outputUnits", outputUnits).put("materials", details)
            .put("grossMaterialCost", grossMaterials).put("expectedReturnedValue", returnedValue)
            .put("expectedMaterialCost", expectedMaterialCost).put("stationFees", stationTotal)
            .put("initialCapitalRequired", upfront).put("expectedTotalCost", expectedTotalCost)
            .put("grossRevenue", grossRevenue).put("salesTax", salesTax).put("sellOrderFee", listingFee)
            .put("netProfit", profit).put("profitable", profit > 0).put("profitPerUnit", profit / outputUnits)
            .put("roiPercent", nullable(roi))
            .put("roiBasis", "initial_capital_required")
            .put("focusRequired", focus).put("silverPerFocus", nullable(silverPerFocus))
            .put("silverPerFocusBasis", "total_net_profit_divided_by_focus_not_incremental")
            .put("budget", nullable(budget)).put("availableFocus", nullable(availableFocus))
            .put("feasible", violations.length() == 0).put("violations", violations)
            .put("volumeObserved", nullable(volume)).put("volumeDays", nullable(days))
            .put("observedUnitsPerDay", nullable(perDay)).put("estimatedSaleDays", nullable(saleDays))
            .put("liquidityCaveat", "Historical observed units are incomplete; this ratio is not a forecast or guaranteed sale.")
            .put("assumptions", JSONArray().put("User-supplied inputs; no market freshness is verified.")
                .put("Upfront capital includes gross materials, station fees and sell-order listing fees, without recycling returned resources.")
                .put("Returns are expected values, not guaranteed integer quantities.")
                .put("Sale proceeds and observed-volume ratios are not guaranteed."))
    }

    /**
     * Bounded chain with explicitly supplied inputs. Returns are estimated assets,
     * never a source of certain units for a later step. No intermediate sales.
     */
    private fun calculateChain(request: JSONObject): JSONObject {
        val steps = array(request, "steps")
        if (steps.length() !in 2..12) throw InputError("LIMIT_EXCEEDED", "Provide between 2 and 12 steps.")
        val budget = optionalNumber(request, "budget")
        val availableFocus = optionalNumber(request, "availableFocus")
        val outputStepById = HashMap<String, Int>()
        val descriptions = ArrayList<Pair<String, JSONObject>>()
        for (i in 0 until steps.length()) {
            checkCancelled()
            val step = steps.opt(i) as? JSONObject ?: throw InputError("INVALID_FIELD", "Each step must be an object.")
            allowed(step, setOf("outputItemId", "scenario"))
            val outputId = text(step, "outputItemId", 128)
            if (outputStepById.put(outputId, i) != null) throw InputError("INVALID_FIELD", "Each step must have a distinct outputItemId.")
            descriptions.add(outputId to obj(step, "scenario"))
        }
        val producedStock = HashMap<String, Double>()
        val details = JSONArray()
        var externalPurchases = 0.0
        var returnedAssets = 0.0
        var stationFees = 0.0
        var focus = 0.0
        var finalResult: JSONObject? = null
        for (i in descriptions.indices) {
            checkCancelled()
            val (outputId, scenario) = descriptions[i]
            if (field(scenario, "budget") !== JSONObject.NULL || field(scenario, "availableFocus") !== JSONObject.NULL)
                throw InputError("INVALID_FIELD", "Step budgets and focus limits must be null; supply chain limits at the root.")
            val calculated = calculate(scenario)
            val materialRows = calculated.getJSONArray("materials")
            val inputs = JSONArray()
            var linkedUnits = 0.0
            for (j in 0 until materialRows.length()) {
                checkCancelled()
                val item = materialRows.getJSONObject(j)
                val id = item.getString("itemId")
                val grossUnits = item.getDouble("grossUnits")
                if (grossUnits % 1.0 != 0.0) throw InputError("INVALID_FIELD", "Chain input quantities must be whole units.")
                val sourceIndex = outputStepById[id]
                if (sourceIndex != null && sourceIndex >= i) throw InputError("FORWARD_DEPENDENCY", "An input refers to a current or later output.")
                val prior = producedStock[id] ?: 0.0
                val internal = minOf(prior, grossUnits)
                val external = grossUnits - internal
                if (internal > 0.0) producedStock[id] = prior - internal
                linkedUnits = safe(linkedUnits + internal)
                val externalCost = safe(external * item.getDouble("unitPrice"))
                externalPurchases = safe(externalPurchases + externalCost)
                returnedAssets = safe(returnedAssets + item.getDouble("expectedReturnedValue"))
                inputs.put(JSONObject().put("itemId", id).put("grossUnits", grossUnits).put("internalUnits", internal)
                    .put("externalUnits", external).put("externalPurchaseCost", externalCost)
                    .put("expectedReturnedUnits", item.getDouble("expectedReturnedUnits"))
                    .put("expectedReturnedValueAtInputPrice", item.getDouble("expectedReturnedValue")))
            }
            if (i > 0 && linkedUnits == 0.0) throw InputError("UNLINKED_STEP", "Each later step must consume a previous step's output.")
            val outputUnits = calculated.getDouble("outputUnits")
            producedStock[outputId] = outputUnits
            stationFees = safe(stationFees + calculated.getDouble("stationFees"))
            focus = safe(focus + calculated.getDouble("focusRequired"))
            details.put(JSONObject().put("index", i).put("label", calculated.getString("label"))
                .put("outputItemId", outputId).put("outputUnits", outputUnits).put("inputs", inputs)
                .put("stationFees", calculated.getDouble("stationFees")).put("focusRequired", calculated.getDouble("focusRequired")))
            finalResult = calculated
        }
        val finalId = descriptions.last().first
        for ((id, units) in producedStock) {
            if (id != finalId && units != 0.0) throw InputError("UNSOLD_INTERMEDIATE", "An intermediate output remains unused; adjust step quantities.")
        }
        val final = finalResult ?: throw InputError("INVALID_FIELD", "Missing final step.")
        val revenue = final.getDouble("grossRevenue")
        val tax = final.getDouble("salesTax")
        val listingFee = final.getDouble("sellOrderFee")
        val capital = safe(externalPurchases + stationFees + listingFee)
        // Hypothetical cash result only if the complete final order sells at the supplied price.
        val cashProfit = signedSafe(revenue - tax - listingFee - externalPurchases - stationFees)
        val estimatedProfit = signedSafe(cashProfit + returnedAssets)
        val violations = JSONArray()
        if (budget != null && capital > budget) violations.put("insufficient_budget")
        if (availableFocus != null && focus > availableFocus) violations.put("insufficient_focus")
        return JSONObject().put("steps", details).put("provenance", "manual").put("finalOutputItemId", finalId)
            .put("finalOutputUnits", final.getDouble("outputUnits")).put("externalPurchaseCost", externalPurchases)
            .put("stationFees", stationFees).put("sellOrderFee", listingFee).put("salesTax", tax)
            .put("initialCapitalRequired", capital).put("focusRequired", focus).put("grossRevenueIfSold", revenue)
            .put("cashFlowBeforeFinalSale", -capital).put("cashProfitIfFinalSale", cashProfit)
            .put("expectedReturnAssetValueAtInputPrices", returnedAssets).put("estimatedProfitIncludingReturns", estimatedProfit).put("estimatedProfitable", estimatedProfit > 0)
            .put("realizedProfit", JSONObject.NULL).put("roiPercent", nullable(if (capital > 0) signedSafe(100.0 * (estimatedProfit / capital)) else null))
            .put("feasible", violations.length() == 0).put("violations", violations)
            .put("liquidityCaveat", "Full final sale at the supplied price is hypothetical and is not guaranteed.")
            .put("assumptions", JSONArray().put("All external inputs are purchased at the manually supplied opportunity prices; owned stock is not modelled.")
                .put("Gross intermediate outputs are certain modeled units; estimated returned units are never reused as certain stock.")
                .put("Every intermediate output must be consumed. Only final output is sold; its order fee is paid upfront.")
                .put("Returns are expected assets valued at the supplied input prices, not realized sale revenue.")
                .put("Prices, rates, formulas and freshness are manual and not verified against live game data."))
    }

    private fun optimizeQuantity(request: JSONObject): JSONObject {
        allowed(request, setOf("scenario", "optimizeQuantity"))
        if (request.has("steps") || request.has("scenarios") || request.has("ranking"))
            throw InputError("INVALID_FIELD", "Quantity, chain and ranking forms cannot be combined.")
        if (field(request, "optimizeQuantity") != true) throw InputError("INVALID_FIELD", "optimizeQuantity must be true.")
        val scenario = obj(request, "scenario")
        val requested = integer(scenario, "quantity", 1_000_000.0)
        // Validate the requested scenario fully before search, including all optional constraints.
        val original = calculate(scenario)
        fun at(quantity: Int): JSONObject {
            checkCancelled()
            return calculate(JSONObject(scenario.toString()).put("quantity", quantity))
        }
        var low = 0
        var high = requested
        if (original.getBoolean("feasible")) low = requested
        else while (low < high) {
            checkCancelled()
            val mid = low + (high - low + 1) / 2
            if (at(mid).getBoolean("feasible")) low = mid else high = mid - 1
        }
        val chosen = if (low == 0) null else if (low == requested) original else at(low)
        val limiting = if (low < requested) at(low + 1).getJSONArray("violations") else JSONArray()
        return JSONObject().put("requestedQuantity", requested).put("selectedQuantity", low)
            .put("limitingFactors", limiting).put("scenarioResult", chosen ?: JSONObject.NULL)
            .put("assumption", "Whole crafts; upfront gross inputs, station fees and listing fees are paid without recycling returns or sale proceeds.")
    }

    fun execute(action: String, request: JSONObject): JSONObject {
        try {
            checkCancelled()
            if (action !in single && action !in ranked) throw InputError("UNKNOWN_ACTION", "Unknown production action.")
            if (action == "optimize_production_plan" && request.has("steps")) {
                allowed(request, setOf("steps", "budget", "availableFocus"))
                if (request.has("scenario") || request.has("optimizeQuantity") || request.has("scenarios") || request.has("ranking")) throw InputError("INVALID_FIELD", "Chain and ranking forms cannot be combined.")
                return JSONObject().put("status", "ok").put("action", action).put("scope", "explicit_linear_chain")
                    .put("result", calculateChain(request))
            }
            if (action == "optimize_production_plan" && request.has("optimizeQuantity")) {
                return JSONObject().put("status", "ok").put("action", action).put("scope", "single_scenario_quantity")
                    .put("result", optimizeQuantity(request))
            }
            if (action in single) {
                allowed(request, setOf("scenario"))
                return JSONObject().put("status", "ok").put("action", action).put("result", calculate(obj(request, "scenario")))
            }
            allowed(request, setOf("scenarios", "ranking"))
            val scenarios = array(request, "scenarios")
            if (scenarios.length() !in 1..2000) throw InputError("LIMIT_EXCEEDED", "Provide between 1 and 2000 scenarios.")
            var materialCount = 0
            for (i in 0 until scenarios.length()) {
                checkCancelled()
                materialCount += (scenarios.opt(i) as? JSONObject)?.optJSONArray("materials")?.length() ?: 0
                if (materialCount > 8192) throw InputError("LIMIT_EXCEEDED", "At most 8192 material rows may be analyzed at once.")
            }
            val ranking = text(request, "ranking", 20)
            if (ranking !in setOf("profit", "roi", "focus", "liquidity")) throw InputError("INVALID_FIELD", "Unknown ranking.")
            val results = ArrayList<Pair<Int, JSONObject>>()
            val rejected = JSONArray()
            for (i in 0 until scenarios.length()) {
                checkCancelled()
                try {
                    val s = scenarios.opt(i) as? JSONObject ?: throw InputError("INVALID_FIELD", "Scenario must be an object.")
                    val result = calculate(s)
                    if (!result.getBoolean("feasible")) rejected.put(JSONObject().put("index", i).put("code", "CONSTRAINT_VIOLATION").put("violations", result.getJSONArray("violations")))
                    else if (action == "find_profitable_crafts" && !result.getBoolean("profitable")) rejected.put(JSONObject().put("index", i).put("code", "NON_PROFITABLE"))
                    else results.add(i to result)
                } catch (e: InputError) {
                    if (e.code == "CANCELLED") throw e
                    rejected.put(JSONObject().put("index", i).put("code", e.code).put("message", e.message))
                }
            }
            val metric = when (ranking) { "profit" -> "netProfit"; "roi" -> "roiPercent"; "focus" -> "silverPerFocus"; else -> "observedUnitsPerDay" }
            results.sortWith(Comparator { a, b ->
                val av = if (a.second.isNull(metric)) null else a.second.getDouble(metric)
                val bv = if (b.second.isNull(metric)) null else b.second.getDouble(metric)
                when { av == null && bv == null -> a.first.compareTo(b.first); av == null -> 1; bv == null -> -1; else -> bv.compareTo(av).takeIf { it != 0 } ?: a.first.compareTo(b.first) }
            })
            val output = JSONArray()
            for ((index, result) in results) { checkCancelled(); result.put("inputIndex", index); output.put(result) }
            return JSONObject().put("status", "ok").put("action", action).put("ranking", ranking)
                .put("scope", "single_scenario_alternatives").put("results", output).put("rejected", rejected)
                .put("warning", "Ranks supplied independent scenarios only; does not combine recipes, fetch prices, or guarantee execution.")
        } catch (e: InputError) {
            return JSONObject().put("status", "error").put("action", action).put("error", JSONObject().put("code", e.code).put("message", e.message))
        } catch (_: Exception) {
            return JSONObject().put("status", "error").put("action", action).put("error", JSONObject().put("code", "INVALID_REQUEST").put("message", "Invalid production request."))
        }
    }
}
