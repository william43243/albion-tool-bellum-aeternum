package com.albion.market.litert

import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/** A failed/cancelled Future does not mean its JNI work has stopped. Keep the
 * initialization lease until both its caller and every real worker settle. */
internal class NativeInitializationGate {
    private val active = AtomicReference<Lease?>(null)

    fun tryAcquire(): Lease? {
        val lease = Lease { completed -> active.compareAndSet(completed, null) }
        return if (active.compareAndSet(null, lease)) lease else null
    }

    internal class Lease(private val release: (Lease) -> Unit) {
        private var callerFinished = false
        private var workers = 0
        private var quarantined = false

        @Synchronized
        fun trackWorker(): Worker {
            check(!callerFinished) { "Initialization caller has already finished" }
            workers += 1
            return Worker(::workerFinished)
        }

        @Synchronized
        fun close() {
            if (callerFinished) return
            callerFinished = true
            if (workers == 0 && !quarantined) release(this)
        }

        /** A failed native close leaves resource ownership uncertain. Fail closed
         * for this process rather than admit another potentially overlapping engine. */
        @Synchronized
        fun quarantine() { quarantined = true }

        @Synchronized
        fun requireSafeInitialization() {
            check(!quarantined) { "Previous AI cleanup failed. Restart the app before initializing another model." }
        }

        @Synchronized
        private fun workerFinished() {
            check(workers > 0)
            workers -= 1
            if (callerFinished && workers == 0 && !quarantined) release(this)
        }
    }

    internal class Worker(private val release: () -> Unit) {
        // 0 = submitted, 1 = running, 2 = settled or cancelled before start.
        private val state = AtomicInteger(0)

        fun start(): Boolean = state.compareAndSet(0, 1)

        fun cancelBeforeStart() {
            if (state.compareAndSet(0, 2)) release()
        }

        fun finish() {
            if (state.compareAndSet(1, 2)) release()
        }
    }
}
