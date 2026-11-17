package com.albion.market.litert

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs

/** Internal arithmetic only. The caller must source and validate every assumption. */
object IslandEconomics {
    private class Failure(val code: String, message: String) : RuntimeException(message)
    private const val MAX = 9_000_000_000_000_000.0
    private val fields = setOf("plots", "slotsPerPlot", "slotsUsed", "wateredSlots", "ownedSeeds", "replacementSeedPrice", "ownedSeedOpportunityPrice", "harvestPerSlot", "cityYieldMultiplier", "outputSalePrice", "saleTaxRate", "saleFeePerCycle", "seedReturnWithoutFocus", "seedReturnWithFocus", "focusPerWateredSlot", "cycleCount", "cycleDays")
    private fun check(cancelled: () -> Boolean) {
        if (cancelled() || Thread.currentThread().isInterrupted) throw Failure("CANCELLED", "Calculation cancelled.")
    }
    private fun value(o: JSONObject, name: String, nullable: Boolean = false): Double? {
        if (!o.has(name)) throw Failure("MISSING_FIELD", "Missing $name.")
        val raw = o.get(name)
        if (raw === JSONObject.NULL && nullable) return null
        if (raw !is Number) throw Failure("INVALID_FIELD", "$name must be a number${if (nullable) " or null" else ""}.")
        val n = raw.toDouble()
        if (!n.isFinite() || n < 0 || n > MAX) throw Failure("INVALID_FIELD", "$name is outside its range.")
        return n
    }
    private fun integer(o: JSONObject, name: String, min: Int, max: Int): Int {
        val n = value(o, name)!!
        if (n < min || n > max || n % 1.0 != 0.0) throw Failure("INVALID_FIELD", "$name must be a whole number in range.")
        return n.toInt()
    }
    private fun positive(o: JSONObject, name: String): Double {
        val n = value(o, name)!!
        if (n <= 0.0) throw Failure("INVALID_FIELD", "$name must be positive.")
        return n
    }
    private fun safe(n: Double): Double {
        if (!n.isFinite() || abs(n) > MAX) throw Failure("LIMIT_EXCEEDED", "Calculation exceeds supported range.")
        return n
    }
    private fun nullable(n: Double?): Any = n ?: JSONObject.NULL

    /** No loading, network, market access, or LLM-supplied assumptions occur here. */
    @JvmStatic
    @JvmOverloads
    fun calculate(input: JSONObject, cancelled: () -> Boolean = { false }): JSONObject {
        try {
            check(cancelled)
            val keys = input.keys().asSequence().toSet()
            if (keys.any { it !in fields }) throw Failure("INVALID_FIELD", "Unexpected scenario field.")
            val plots = integer(input, "plots", 1, 1000)
            val capacity = integer(input, "slotsPerPlot", 1, 1000)
            val slots = integer(input, "slotsUsed", 1, 100000)
            val watered = integer(input, "wateredSlots", 0, slots)
            val owned = integer(input, "ownedSeeds", 0, slots)
            val cycles = integer(input, "cycleCount", 1, 3650)
            if (slots > plots * capacity) throw Failure("INVALID_FIELD", "Used slots exceed declared plot capacity.")
            val seedPrice = positive(input, "replacementSeedPrice")
            val ownedPrice = value(input, "ownedSeedOpportunityPrice")!!
            if (owned > 0 && ownedPrice <= 0.0) throw Failure("INVALID_FIELD", "Owned seeds require a positive opportunity price.")
            val yield = positive(input, "harvestPerSlot")
            val cityMultiplier = positive(input, "cityYieldMultiplier")
            val salePrice = positive(input, "outputSalePrice")
            val taxRate = value(input, "saleTaxRate")!!
            if (taxRate > 1.0) throw Failure("INVALID_FIELD", "saleTaxRate must be between 0 and 1.")
            val saleFee = value(input, "saleFeePerCycle")!!
            val baseReturn = value(input, "seedReturnWithoutFocus")!!
            val wetReturn = value(input, "seedReturnWithFocus", true)
            val focusUnit = value(input, "focusPerWateredSlot", true)
            val cadence = value(input, "cycleDays", true)
            if (cadence != null && cadence <= 0) throw Failure("INVALID_FIELD", "cycleDays must be positive or null.")
            if (watered > 0 && (wetReturn == null || focusUnit == null)) throw Failure("MISSING_FIELD", "Watered seed return and focus cost are required.")
            val outputUnits = safe(safe(slots.toDouble() * yield) * cityMultiplier)
            val grossRevenue = safe(outputUnits * salePrice)
            // Caller declares these assumptions. No unverified per-order rounding is inferred.
            val tax = safe(grossRevenue * taxRate)
            val netRevenue = safe(grossRevenue - tax - saleFee)
            val initialPurchase = safe((slots - owned).toDouble() * seedPrice)
            val initialOwnedOpportunity = safe(owned.toDouble() * ownedPrice)
            val focus = safe(watered.toDouble() * (focusUnit ?: 0.0))
            fun calculateMode(wateredSlots: Int, rate: Double): JSONObject {
                check(cancelled)
                val returned = safe((slots - wateredSlots).toDouble() * baseReturn + wateredSlots.toDouble() * rate)
                // Flow-of-means approximation, not E[max(0, slots - random returns)].
                val replacement = safe(maxOf(0.0, slots - returned))
                val surplus = safe(maxOf(0.0, returned - slots))
                val replacementCost = safe(replacement * seedPrice)
                val profit = safe(netRevenue - replacementCost)
                return JSONObject().put("meanReturnedSeeds", returned).put("meanFlowReplacementSeeds", replacement)
                    .put("meanFlowSurplusSeeds", surplus).put("meanFlowReplacementCost", replacementCost)
                    .put("meanFlowProfitPerCycle", profit).put("meanFlowProfitPerPlot", safe(profit / plots))
            }
            val baseline = calculateMode(0, baseReturn)
            val selected = calculateMode(watered, wetReturn ?: baseReturn)
            val marginal = safe(selected.getDouble("meanFlowProfitPerCycle") - baseline.getDouble("meanFlowProfitPerCycle"))
            val projected = safe(selected.getDouble("meanFlowProfitPerCycle") * cycles)
            val daily = cadence?.let { safe(selected.getDouble("meanFlowProfitPerCycle") / it) }
            check(cancelled)
            return JSONObject().put("status", "ok").put("model", "mean_flows_not_probability_distribution")
                .put("slotsUsed", slots).put("wateredSlots", watered).put("plots", plots)
                .put("initialSeeds", JSONObject().put("required", slots).put("owned", owned).put("purchased", slots - owned)
                    .put("purchaseCash", initialPurchase).put("ownedOpportunityCost", initialOwnedOpportunity)
                    .put("initialEconomicValue", safe(initialPurchase + initialOwnedOpportunity)))
                .put("output", JSONObject().put("meanUnitsPerCycle", outputUnits).put("grossRevenueIfSold", grossRevenue)
                    .put("taxAssumption", tax).put("saleFeeAssumption", saleFee).put("netRevenueIfSold", netRevenue))
                .put("baseline", baseline).put("selected", selected).put("focusPerCycle", focus)
                .put("incrementalMeanFlowProfitPerCycle", marginal)
                .put("incrementalMeanFlowSilverPerFocus", nullable(if (focus > 0) safe(marginal / focus) else null))
                .put("projection", JSONObject().put("cycles", cycles).put("meanFlowProfit", projected)
                    .put("cycleDays", nullable(cadence)).put("daily", nullable(daily))
                    .put("weekly", nullable(daily?.let { safe(it * 7) }))
                    .put("monthly30Days", nullable(daily?.let { safe(it * 30) })))
                .put("realizedCashProfit", JSONObject.NULL)
                .put("assumptions", JSONArray().put("Input values are supplied by a trusted caller and are not verified by this calculator.")
                    .put("All output is hypothetically sold at the supplied price; taxes and fees are supplied assumptions without inferred rounding.")
                    .put("Replacement and surplus are differences of average flows, not expected shortfalls or guaranteed stock.")
                    .put("Surplus seed value is excluded from profit and is not a realized sale.")
                    .put("Projection assumes every cycle is replanted; no probability distribution, cash feasibility, time to sale or inventory path is modeled.")
                    .put("Per-plot results are averages, not a claim of equal allocation. Month means 30 days."))
        } catch (e: Failure) {
            return JSONObject().put("status", "error").put("error", JSONObject().put("code", e.code).put("message", e.message))
        } catch (_: Exception) {
            return JSONObject().put("status", "error").put("error", JSONObject().put("code", "INVALID_REQUEST").put("message", "Invalid island input."))
        }
    }
}
