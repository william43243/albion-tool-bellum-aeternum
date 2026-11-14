package com.albion.market.litert

/** Local model settings. A null window uses the engine/model default, which is not
 * necessarily observable. A requested window is not a guarantee of capacity. */
data class LocalRuntimeOptions(
    val maxNumTokens: Int? = null,
    val topK: Int = 20,
    val topP: Double = 0.9,
    val temperature: Double = 0.3,
) {
    init {
        require(maxNumTokens == null || maxNumTokens in 2000..32000) { "Context must be between 2000 and 32000 tokens" }
        require(topK in 1..100) { "Top K must be between 1 and 100" }
        require(topP.isFinite() && topP in 0.0..1.0) { "Top P must be between 0 and 1" }
        require(temperature.isFinite() && temperature in 0.0..2.0) { "Temperature must be between 0 and 2" }
    }
}

/** Build a bounded context; this can cut individual messages and cannot preserve
 * facts beyond the supplied text. The caller must disclose that limitation. */
internal fun composeCompactedContext(
    history: String,
    budget: Int,
    summarize: (String) -> String,
): Pair<String, String> {
    require(budget in 2000..32000)
    val input = history.takeLast((budget * 3 / 2).coerceIn(1000, 12000))
    val recent = history.takeLast((budget / 2).coerceIn(500, 4000))
    val summary = try {
        summarize(input).trim().take(4000)
    } catch (cancelled: java.util.concurrent.CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        ""
    }
    return if (summary.isNotBlank()) {
        Pair("$summary\n\nRecent exchanges (verbatim, may be truncated):\n$recent", "summary")
    } else {
        Pair(recent, "truncated")
    }
}

/** A second conversation may invalidate the first one's engine cache, even if
 * creating it fails. Once attempted the old conversation cannot be resumed. */
internal class CompactionSafety {
    private val secondaryMayHaveStarted = java.util.concurrent.atomic.AtomicBoolean(false)
    fun beforeSecondaryConversation() { secondaryMayHaveStarted.set(true) }
    fun failureRequiresReload(): Boolean = secondaryMayHaveStarted.get()
}
