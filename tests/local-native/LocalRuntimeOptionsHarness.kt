import com.albion.market.litert.LocalRuntimeOptions
import com.albion.market.litert.composeCompactedContext
import com.albion.market.litert.CompactionSafety
import java.util.concurrent.CancellationException

private fun rejects(name: String, action: () -> Unit) {
    try {
        action()
        error("Expected invalid $name to be rejected")
    } catch (_: IllegalArgumentException) {
        // Invalid user-controlled configuration must fail before native initialization.
    }
}

fun main() {
    check(LocalRuntimeOptions().maxNumTokens == null)
    for (context in listOf(2000, 4096, 8192, 30000, 32000)) {
        check(LocalRuntimeOptions(maxNumTokens = context).maxNumTokens == context)
    }
    for (context in listOf(-1, 0, 1999, 32001, Int.MAX_VALUE)) {
        rejects("context $context") { LocalRuntimeOptions(maxNumTokens = context) }
    }
    for (topK in listOf(1, 100)) check(LocalRuntimeOptions(topK = topK).topK == topK)
    for (topK in listOf(-1, 0, 101)) rejects("topK $topK") { LocalRuntimeOptions(topK = topK) }
    for (topP in listOf(0.0, 0.5, 1.0)) check(LocalRuntimeOptions(topP = topP).topP == topP)
    for (topP in listOf(-0.1, 1.1, Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)) {
        rejects("topP $topP") { LocalRuntimeOptions(topP = topP) }
    }
    for (temp in listOf(0.0, 0.3, 2.0)) check(LocalRuntimeOptions(temperature = temp).temperature == temp)
    for (temp in listOf(-0.1, 2.1, Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)) {
        rejects("temperature $temp") { LocalRuntimeOptions(temperature = temp) }
    }
    val history = "x".repeat(5000) + "LAST TURN"
    var attempts = 0
    val (summary, summaryMode) = composeCompactedContext(history, 2000) { input ->
        attempts++
        check(input.length <= 3000 && input.endsWith("LAST TURN"))
        "   goals and constraints   "
    }
    check(attempts == 1 && summaryMode == "summary")
    check(summary.startsWith("goals and constraints") && summary.endsWith("LAST TURN"))
    val (fallback, fallbackMode) = composeCompactedContext(history, 2000) { throw IllegalStateException("model unavailable") }
    check(fallbackMode == "truncated" && fallback.length == 1000 && fallback.endsWith("LAST TURN"))
    val (emptyFallback, emptyMode) = composeCompactedContext(history, 2000) { "  " }
    check(emptyMode == "truncated" && emptyFallback == fallback)
    try {
        composeCompactedContext(history, 2000) { throw CancellationException("cancel") }
        error("Cancellation must not be swallowed as a summarization failure")
    } catch (_: CancellationException) { }
    val safety = CompactionSafety()
    check(!safety.failureRequiresReload())
    val (_, failedSummaryMode) = composeCompactedContext(history, 2000) {
        safety.beforeSecondaryConversation()
        throw IllegalStateException("secondary conversation creation failed")
    }
    check(failedSummaryMode == "truncated")
    check(safety.failureRequiresReload()) // Any subsequent replacement failure must retire the old runtime.
    safety.beforeSecondaryConversation()
    check(safety.failureRequiresReload())
    println("LocalRuntimeOptions JVM behavior: passed")
}
