package com.albion.market.litert

import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CancellationException
import kotlin.math.floor

/** Comparable mean-flow estimates; the model never supplies prices, yields, or seed-return rates. */
object IslandCropComparison {
    private data class Crop(val seed: String, val product: String, val type: String, val name: String)
    private val crops = listOf(
        Crop("T1_FARM_CARROT_SEED", "T1_CARROT", "farm", "Carrot"),
        Crop("T2_FARM_BEAN_SEED", "T2_BEAN", "farm", "Bean"),
        Crop("T3_FARM_WHEAT_SEED", "T3_WHEAT", "farm", "Wheat"),
        Crop("T4_FARM_TURNIP_SEED", "T4_TURNIP", "farm", "Turnip"),
        Crop("T5_FARM_CABBAGE_SEED", "T5_CABBAGE", "farm", "Cabbage"),
        Crop("T6_FARM_POTATO_SEED", "T6_POTATO", "farm", "Potato"),
        Crop("T7_FARM_CORN_SEED", "T7_CORN", "farm", "Corn"),
        Crop("T8_FARM_PUMPKIN_SEED", "T8_PUMPKIN", "farm", "Pumpkin"),
        Crop("T2_FARM_AGARIC_SEED", "T2_AGARIC", "herbgarden", "Arcane Agaric"),
        Crop("T3_FARM_COMFREY_SEED", "T3_COMFREY", "herbgarden", "Brightleaf Comfrey"),
        Crop("T4_FARM_BURDOCK_SEED", "T4_BURDOCK", "herbgarden", "Crenellated Burdock"),
        Crop("T5_FARM_TEASEL_SEED", "T5_TEASEL", "herbgarden", "Dragon Teasel"),
        Crop("T6_FARM_FOXGLOVE_SEED", "T6_FOXGLOVE", "herbgarden", "Elusive Foxglove"),
        Crop("T7_FARM_MULLEIN_SEED", "T7_MULLEIN", "herbgarden", "Firetouched Mullein"),
        Crop("T8_FARM_YARROW_SEED", "T8_YARROW", "herbgarden", "Ghoul Yarrow"),
    )
    // Royal-city bonuses are also published in the official farming guide. The source
    // snapshot contains corresponding island modifiers for Caerleon and Brecilien.
    private val bonuses = mapOf(
        "Lymhurst" to setOf("T1_CARROT", "T8_PUMPKIN", "T4_BURDOCK"),
        "Bridgewatch" to setOf("T2_BEAN", "T7_CORN", "T5_TEASEL"),
        "Martlock" to setOf("T3_WHEAT", "T6_POTATO", "T6_FOXGLOVE"),
        "Thetford" to setOf("T5_CABBAGE", "T2_AGARIC", "T7_MULLEIN"),
        "Fort Sterling" to setOf("T4_TURNIP", "T8_YARROW"),
        "Caerleon" to setOf("T3_COMFREY", "T5_TEASEL", "T7_MULLEIN"),
        "Brecilien" to crops.filter { it.type == "farm" }.map { it.product }.toSet(),
    )
    private const val REVISION = "5b581f18e9dc27b0866e78526cea535fb17db02d"
    private fun fail(code: String, message: String) = JSONObject().put("status", "error")
        .put("error", JSONObject().put("code", code).put("message", message))
    private fun nullIfMissing(o: JSONObject, key: String): Any = if (o.has(key) && !o.isNull(key)) o.get(key) else JSONObject.NULL

    fun execute(
        p: JSONObject,
        catalog: JSONObject,
        npc: JSONObject?,
        server: String,
        history: ((JSONObject, () -> Boolean) -> JSONObject)?,
        cancelled: () -> Boolean,
    ): JSONObject {
        fun active() { if (cancelled() || Thread.currentThread().isInterrupted) throw CancellationException() }
        try {
            active()
            val selected = if (p.isNull("crop_ids")) null else p.getJSONArray("crop_ids")
            val kind = if (p.isNull("category")) null else p.getString("category")
            val wanted = LinkedHashSet<Crop>()
            if (selected != null) {
                for (i in 0 until selected.length()) {
                    val id = selected.getString(i)
                    val crop = crops.singleOrNull { it.seed == id || it.product == id }
                        ?: return fail("UNKNOWN_CROP", "A selected crop is not in the supported farm and herb catalogue; resolve its exact item ID first.")
                    if (!wanted.add(crop)) return fail("DUPLICATE_CROP", "The same crop was selected more than once.")
                    if (kind != null && crop.type != kind) return fail("SELECTION_CONFLICT", "A selected crop does not match the requested category.")
                }
            } else wanted.addAll(crops.filter { kind == null || it.type == kind })
            if (wanted.isEmpty()) return fail("EMPTY_SELECTION", "No matching crop was selected.")

            val missing = JSONArray()
            if (p.isNull("island_city")) missing.put("island_city")
            if (p.isNull("market_city")) missing.put("market_city")
            if (p.isNull("premium")) missing.put("premium")
            if (missing.length() > 0) return JSONObject().put("status", "needs_input").put("missing_fields", missing)
                .put("selected_crop_ids", JSONArray(wanted.map { it.seed }))

            val islandCity = p.getString("island_city"); val marketCity = p.getString("market_city")
            val premium = p.getBoolean("premium")
            val plots = if (p.isNull("plot_count")) 1 else p.getInt("plot_count")
            val focusBudget = if (p.isNull("focus_budget")) 0 else p.getInt("focus_budget")
            val days = if (p.isNull("history_days")) 7 else p.getInt("history_days")
            val focusCost = if (p.isNull("focus_per_plant")) 1000 else p.getInt("focus_per_plant")
            val showChart = p.opt("show_chart") == true
            val plants = plots * 9
            val watered = minOf(plants, focusBudget / focusCost)
            val saleTax = if (premium) 0.04 else 0.08
            val setupFee = 0.025
            val farmables = catalog.getJSONArray("farmables")
            val indexed = HashMap<String, JSONObject>()
            for (i in 0 until farmables.length()) {
                val row = farmables.optJSONObject(i) ?: continue
                if (row.optString("stage") == "seeds") indexed[row.optString("sourceId")] = row
            }
            val referencePrices = HashMap<String, Double>()
            val entries = npc?.optJSONArray("entries")
            if (entries != null) for (i in 0 until entries.length()) {
                val row = entries.optJSONObject(i) ?: continue
                val price = row.opt("value")
                if (row.optString("status") in setOf("reference", "verified") && row.optString("currency") == "silver" &&
                    row.optString("transaction") == "player_buys_from_farming_merchant" && price is Number &&
                    price.toDouble().isFinite() && price.toDouble() > 0 && price.toDouble() <= 1e9) {
                    referencePrices[row.optString("itemId")] = price.toDouble()
                }
            }
            data class Rules(val seedReturn: Double, val focusBonus: Double, val seedPrice: Double?)
            val rules = HashMap<String, Rules>()
            val requestIds = LinkedHashSet<String>()
            for (crop in wanted) {
                active(); requestIds.add(crop.product)
                val row = indexed[crop.seed] ?: continue
                if (row.optString("plotType") != crop.type) continue
                val raw = row.optJSONObject("raw") ?: continue
                val harvest = raw.optJSONObject("harvest") ?: continue
                if (harvest.optString("@lootlist") != crop.product + "_LOOT") continue
                val chance = harvest.optJSONObject("seed")?.optString("@chance")?.toDoubleOrNull() ?: continue
                val bonus = raw.optString("@activefarmbonus").toDoubleOrNull() ?: continue
                if (!chance.isFinite() || chance !in 0.0..1.0 || !bonus.isFinite() || bonus !in 0.0..3.0) continue
                rules[crop.seed] = Rules(chance, bonus, referencePrices[crop.seed])
                val expectedReturn = plants * chance + watered * bonus
                if (expectedReturn > plants) requestIds.add(crop.seed)
            }
            val query = JSONObject().put("item_ids", JSONArray(requestIds.toList())).put("city", marketCity).put("days", days)
            val market = history?.invoke(query, cancelled) ?: fail("SOURCE_UNAVAILABLE", "Historical market data is unavailable.")
            active()
            if (market.optJSONObject("error")?.optString("code") == "CANCELLED") throw CancellationException()
            val observations = HashMap<String, JSONObject>()
            val expectedSource = when (server) {
                "americas" -> "https://west.albion-online-data.com/api/v2/stats"
                "europe" -> "https://europe.albion-online-data.com/api/v2/stats"
                else -> "https://east.albion-online-data.com/api/v2/stats"
            }
            val historyValid = market.optString("status") == "ok" && market.optString("server") == server &&
                market.optString("source") == expectedSource && market.optString("city") == marketCity &&
                market.optInt("quality") == 1 && market.optInt("requested_days") == days
            if (historyValid) {
                val values = market.optJSONArray("results") ?: JSONArray()
                for (i in 0 until values.length()) {
                    val value = values.optJSONObject(i) ?: continue
                    val id = value.optString("item_id")
                    if (id in requestIds && id !in observations) observations[id] = value
                }
            }
            fun price(id: String): Double? {
                val row = observations[id] ?: return null
                val value = row.opt("average")
                return if (row.optString("status") == "ok" && value is Number && value.toDouble().isFinite() &&
                    value.toDouble() > 0 && value.toDouble() <= 1e12 && row.optInt("usable_days") in 1..days) value.toDouble() else null
            }
            // Daily points use only observations returned for that day. Multiple
            // buckets on the same day are quantity-weighted; gaps stay gaps.
            fun dailyPrices(id: String): Map<Int, Double> {
                val row = observations[id] ?: return emptyMap()
                if (row.optString("status") != "ok") return emptyMap()
                val points = row.optJSONArray("observations") ?: return emptyMap()
                if (points.length() > 1000) return emptyMap()
                val sums = HashMap<Int, Pair<Double, Double>>()
                for (i in 0 until points.length()) {
                    val point = points.optJSONArray(i) ?: continue
                    if (point.length() != 3) continue
                    val day = point.opt(0); val value = point.opt(1); val count = point.opt(2)
                    if (day !is Number || value !is Number || count !is Number) continue
                    val dayValue = day.toDouble(); val priceValue = value.toDouble(); val quantity = count.toDouble()
                    if (!dayValue.isFinite() || dayValue % 1.0 != 0.0 || dayValue < 0 || dayValue >= days ||
                        !priceValue.isFinite() || priceValue <= 0 || priceValue > 1e12 ||
                        !quantity.isFinite() || quantity <= 0 || quantity > 1e12) continue
                    val key = dayValue.toInt(); val prior = sums[key] ?: (0.0 to 0.0)
                    val sum = prior.first + priceValue * quantity; val weight = prior.second + quantity
                    if (sum.isFinite() && weight.isFinite()) sums[key] = sum to weight
                }
                return sums.mapValues { (_, value) -> value.first / value.second }
            }
            val resultRows = ArrayList<JSONObject>(); var missingResults = 0
            for (crop in wanted) {
                active()
                val rule = rules[crop.seed]; val outputPrice = price(crop.product)
                val yieldPerPlant = 4.5 * (if (premium) 2.0 else 1.0) * (if (crop.product in bonuses.getValue(islandCity)) 1.1 else 1.0)
                val expectedOutput = plants * yieldPerPlant
                val returned = rule?.let { plants * it.seedReturn + watered * it.focusBonus }
                val replacement = returned?.let { maxOf(0.0, plants - it) }
                val surplus = returned?.let { maxOf(0.0, it - plants) }
                val seedSalePrice = if (surplus != null && surplus > 0) price(crop.seed) else null
                val grossOutput = outputPrice?.let { expectedOutput * it }
                val netOutput = grossOutput?.let { it * (1.0 - saleTax - setupFee) }
                val replacementCost = if (rule?.seedPrice != null && replacement != null) replacement * rule.seedPrice else null
                val netSurplus = if (surplus == 0.0) 0.0 else if (surplus != null && seedSalePrice != null) surplus * seedSalePrice * (1.0 - saleTax - setupFee) else null
                val partialProfit = if (netOutput != null && replacementCost != null) netOutput - replacementCost else null
                val profit = if (partialProfit != null && netSurplus != null) partialProfit + netSurplus else null
                val firstCost = rule?.seedPrice?.let { plants * it }
                val complete = profit != null
                if (!complete) missingResults++
                val row = JSONObject().put("seed_id", crop.seed).put("product_id", crop.product).put("name", crop.name).put("building", crop.type)
                    .put("status", if (complete) "estimated" else "partial")
                    .put("history_status", observations[crop.product]?.optString("status") ?: if (historyValid) "MISSING" else "SOURCE_UNAVAILABLE")
                    .put("history_average", outputPrice ?: JSONObject.NULL)
                    .put("history_usable_days", observations[crop.product]?.opt("usable_days") ?: JSONObject.NULL)
                    .put("history_missing_days", observations[crop.product]?.opt("missing_days") ?: JSONObject.NULL)
                    .put("history_last_observed", observations[crop.product]?.opt("last_observed") ?: JSONObject.NULL)
                    .put("merchant_seed_price_reference", rule?.seedPrice ?: JSONObject.NULL)
                    .put("initial_seed_cost_if_all_purchased", firstCost ?: JSONObject.NULL)
                    .put("expected_harvest_per_cycle", expectedOutput)
                    .put("city_bonus_percent", if (crop.product in bonuses.getValue(islandCity)) 10 else 0)
                    .put("seed_return_probability_unwatered", rule?.seedReturn ?: JSONObject.NULL)
                    .put("watered_positions", watered).put("focus_used_estimate", watered * focusCost)
                    .put("mean_returned_seeds", returned ?: JSONObject.NULL).put("mean_replacement_seeds", replacement ?: JSONObject.NULL)
                    .put("mean_surplus_seeds", surplus ?: JSONObject.NULL).put("surplus_seed_history_average", seedSalePrice ?: JSONObject.NULL)
                    .put("estimated_output_revenue_after_fees", netOutput ?: JSONObject.NULL)
                    .put("estimated_replacement_seed_cost", replacementCost ?: JSONObject.NULL)
                    .put("estimated_profit_excluding_surplus", partialProfit ?: JSONObject.NULL)
                    .put("estimated_profit_per_cycle", profit ?: JSONObject.NULL)
                if (showChart) {
                    val points = JSONArray()
                    if (replacementCost != null && surplus != null) {
                        val productDays = dailyPrices(crop.product)
                        val seedDays = if (surplus > 0) dailyPrices(crop.seed) else emptyMap()
                        for ((day, dailyPrice) in productDays.toSortedMap()) {
                            active()
                            val seedPrice = if (surplus > 0) seedDays[day] ?: continue else 0.0
                            val dailyProfit = (expectedOutput * dailyPrice + surplus * seedPrice) * (1.0 - saleTax - setupFee) - replacementCost
                            if (dailyProfit.isFinite() && kotlin.math.abs(dailyProfit) <= 9e15)
                                points.put(JSONArray().put(day).put(kotlin.math.round(dailyProfit * 100.0) / 100.0))
                        }
                    }
                    row.put("profit_history", points)
                }
                resultRows.add(row)
            }
            resultRows.sortWith(compareByDescending<JSONObject> { !it.isNull("estimated_profit_per_cycle") }
                .thenByDescending { if (it.isNull("estimated_profit_per_cycle")) Double.NEGATIVE_INFINITY else it.getDouble("estimated_profit_per_cycle") }
                .thenBy { it.getString("seed_id") })
            return JSONObject().put("status", if (missingResults == 0) "ok" else "partial")
                .put("server", server).put("island_city", islandCity).put("market_city", marketCity)
                .put("plot_count", plots).put("plot_count_defaulted", p.isNull("plot_count"))
                .put("planting_positions_per_building", 9).put("total_planting_positions", plants)
                .put("premium", premium).put("focus_budget", focusBudget).put("focus_defaulted", p.isNull("focus_budget"))
                .put("focus_per_plant", focusCost).put("focus_cost_assumption", if (p.isNull("focus_per_plant")) "base cost without specialization; actual costs vary by character" else "user supplied cost per plant")
                .put("history_days", days).put("history_days_defaulted", p.isNull("history_days"))
                .put("chart_requested", showChart)
                .put("selection", if (selected == null) "all_matching_category" else "explicit_crops_only")
                .put("ranked_available_count", resultRows.count { !it.isNull("estimated_profit_per_cycle") })
                .put("missing_count", missingResults).put("ranking_scope", if (missingResults == 0) "all_requested_crops" else "available_crops_only")
                .put("candidates", JSONArray(resultRows)).put("history", market)
                .put("assumptions", JSONArray()
                    .put("One farm or herb garden has 9 positions. Each row compares filling all specified empty plots with that crop, not a mixed allocation.")
                    .put("Harvest estimate uses the midpoint of 3–6 units per seed, doubled with Premium and adjusted for the island's 10% local bonus where applicable.")
                    .put("Seed returns and merchant prices are game-data references, not guaranteed current in-game values. All initial seeds are assumed purchased for the upfront cost.")
                    .put("Sale estimates use historical reported sell-order averages, 4%/8% sales tax and a 2.5% sell-order fee. They do not represent guaranteed fills or current executable prices.")
                    .put("Graph points estimate per-harvest profit using each day's observed product price with the same reference seed costs and current scenario assumptions; they are not realized historical profits.")
                    .put("Expected seed replacement and surplus use differences of mean flows, not a probability distribution. Missing seed-market history leaves surplus and total profit unknown.")
                    .put("Construction, travel, equipment, labor, actual sale timing and byproducts are excluded; growth time is about 22 hours. Profits are estimates per harvest, not realized cash."))
                .put("reference_sources", JSONArray()
                    .put("https://albiononline.com/news/guide-farming")
                    .put("https://github.com/ao-data/ao-bin-dumps/blob/$REVISION/loot.json")
                    .put("https://github.com/ao-data/ao-bin-dumps/blob/$REVISION/farmingmodifiers.json"))
        } catch (_: CancellationException) { return fail("CANCELLED", "Island comparison was cancelled.") }
        catch (_: Exception) { return fail("INVALID_ARGUMENT", "The island comparison could not validate its inputs or catalogue.") }
    }
}
