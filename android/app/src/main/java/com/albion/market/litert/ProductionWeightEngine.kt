package com.albion.market.litert

import org.json.JSONArray
import org.json.JSONObject

/** Pure calculation: the caller supplies a locally loaded, validated source index. */
object ProductionWeightEngine {
    private class Invalid(val code: String, message: String) : Exception(message)
    private data class Key(val id: String, val enchantment: Int?)
    private data class Entry(val weight: Double?, val origin: String)
    private const val MAX_SAFE = 9_007_199_254_740_991.0

    private fun string(obj: JSONObject, name: String): String {
        val value = obj.opt(name)
        if (value !is String || value.isBlank() || value.length > 128)
            throw Invalid("INVALID_FIELD", "Invalid $name")
        return value
    }
    private fun enchantment(obj: JSONObject): Int? {
        if (!obj.has("enchantment")) throw Invalid("INVALID_FIELD", "Missing enchantment")
        val value = obj.opt("enchantment")
        if (value == null || value == JSONObject.NULL) return null
        if (value !is Number) throw Invalid("INVALID_FIELD", "Invalid enchantment")
        val n = value.toDouble()
        if (!n.isFinite() || n < 0 || n > 1000 || n % 1.0 != 0.0)
            throw Invalid("INVALID_FIELD", "Invalid enchantment")
        return n.toInt()
    }
    private fun numeric(obj: JSONObject, name: String, allowNull: Boolean, positive: Boolean): Double? {
        if (!obj.has(name)) throw Invalid("INVALID_FIELD", "Missing $name")
        val value = obj.opt(name)
        if (value == null || value == JSONObject.NULL) {
            if (allowNull) return null
            throw Invalid("INVALID_FIELD", "Missing $name")
        }
        if (value !is Number) throw Invalid("INVALID_FIELD", "Invalid $name")
        val n = value.toDouble()
        if (!n.isFinite() || n < 0 || n > 1e12 || (positive && n == 0.0))
            throw Invalid("INVALID_FIELD", "Invalid $name")
        return n
    }
    private fun safe(n: Double): Double {
        if (!n.isFinite() || n > MAX_SAFE) throw Invalid("LIMIT_EXCEEDED", "Weight total is too large")
        return n
    }
    private fun json(v: Any?): Any = v ?: JSONObject.NULL

    @JvmStatic
    fun calculate(materials: JSONArray, index: JSONObject): JSONObject {
        try {
            if (materials.length() !in 1..1000) throw Invalid("LIMIT_EXCEEDED", "Provide 1 to 1000 material rows")
            if (index.opt("schemaVersion") !is Number || (index.opt("schemaVersion") as Number).toDouble() != 1.0)
                throw Invalid("INVALID_INDEX", "Unsupported weight index")
            val provenance = index.optJSONObject("provenance") ?: throw Invalid("INVALID_INDEX", "Missing provenance")
            if (provenance.opt("unit") != "source_unconfirmed") throw Invalid("INVALID_INDEX", "Unverified weight unit required")
            val entries = index.optJSONArray("entries") ?: throw Invalid("INVALID_INDEX", "Missing entries")
            if (entries.length() > 20000) throw Invalid("LIMIT_EXCEEDED", "Too many weight entries")
            val lookup = HashMap<Key, Entry>(entries.length())
            for (i in 0 until entries.length()) {
                val obj = entries.optJSONObject(i) ?: throw Invalid("INVALID_INDEX", "Invalid entry")
                val key = Key(string(obj, "sourceId"), enchantment(obj))
                val origin = string(obj, "origin")
                if (origin != "item" && origin != "enchantment") throw Invalid("INVALID_INDEX", "Invalid weight origin")
                if (origin == "enchantment" && key.enchantment == null) throw Invalid("INVALID_INDEX", "Missing variant level")
                val value = numeric(obj, "weight", allowNull = true, positive = false)
                if (lookup.put(key, Entry(value, origin)) != null) throw Invalid("INVALID_INDEX", "Duplicate identity")
            }
            val details = JSONArray()
            val missing = JSONArray()
            var knownSubtotal = 0.0
            for (i in 0 until materials.length()) {
                val row = materials.optJSONObject(i) ?: throw Invalid("INVALID_FIELD", "Invalid material")
                val key = Key(string(row, "sourceId"), enchantment(row))
                val quantity = numeric(row, "quantity", allowNull = false, positive = true)!!
                val found = lookup[key]
                val total = found?.weight?.let { safe(it * quantity) }
                if (total != null) knownSubtotal = safe(knownSubtotal + total)
                else missing.put(JSONObject().put("index", i).put("sourceId", key.id)
                    .put("enchantment", json(key.enchantment)).put("reason", if (found == null) "NO_MATCH" else "UNKNOWN_WEIGHT"))
                details.put(JSONObject().put("sourceId", key.id).put("enchantment", json(key.enchantment))
                    .put("quantity", quantity).put("unitWeight", json(found?.weight))
                    .put("weight", json(total)).put("origin", json(found?.origin)))
            }
            return JSONObject().put("status", "ok").put("unit", "source_unconfirmed")
                .put("knownSubtotal", knownSubtotal).put("total", if (missing.length() == 0) knownSubtotal else JSONObject.NULL)
                .put("missing", missing).put("materials", details).put("provenance", JSONObject(provenance.toString()))
        } catch (e: Invalid) {
            return JSONObject().put("status", "error").put("error", JSONObject().put("code", e.code).put("message", e.message))
        }
    }
}
