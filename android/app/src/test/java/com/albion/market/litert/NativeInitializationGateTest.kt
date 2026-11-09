package com.albion.market.litert

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class NativeInitializationGateTest {
    @Test fun onlyOneCallerIsAdmittedUntilItsLeaseCloses() {
        val gate = NativeInitializationGate()
        val first = checkNotNull(gate.tryAcquire())
        assertNull(gate.tryAcquire())
        first.close()
        assertNotNull(gate.tryAcquire())
    }

    @Test fun workerCompletionDoesNotReleaseAnUnfinishedCallerBetweenFallbackTiers() {
        val gate = NativeInitializationGate()
        val lease = checkNotNull(gate.tryAcquire())
        val first = lease.trackWorker()
        assertTrue(first.start())
        first.finish()
        assertNull(gate.tryAcquire())
        val fallback = lease.trackWorker()
        assertTrue(fallback.start())
        lease.close()
        assertNull(gate.tryAcquire())
        fallback.finish()
        assertNotNull(gate.tryAcquire())
    }

    @Test fun cancellationBeforeDispatchReleasesReservationWithoutStartingNativeWork() {
        val gate = NativeInitializationGate()
        val lease = checkNotNull(gate.tryAcquire())
        val worker = lease.trackWorker()
        lease.close()
        assertNull(gate.tryAcquire())
        worker.cancelBeforeStart()
        assertFalse(worker.start())
        assertNotNull(gate.tryAcquire())
    }

    @Test fun rejectedSubmissionCanReleaseItsUnstartedWorker() {
        val gate = NativeInitializationGate()
        val lease = checkNotNull(gate.tryAcquire())
        val worker = lease.trackWorker()
        // Same cleanup used when ThreadPoolExecutor.submit rejects admission.
        worker.cancelBeforeStart()
        assertNull(gate.tryAcquire())
        lease.close()
        assertNotNull(gate.tryAcquire())
    }

    @Test fun futureCancellationDoesNotReleaseUninterruptibleWorkOrLateCleanup() {
        val gate = NativeInitializationGate()
        val lease = checkNotNull(gate.tryAcquire())
        val worker = lease.trackWorker()
        val executor = Executors.newSingleThreadExecutor()
        val started = CountDownLatch(1)
        val finishNative = CountDownLatch(1)
        val cleanupStarted = CountDownLatch(1)
        val finishCleanup = CountDownLatch(1)
        val settled = CountDownLatch(1)
        fun awaitIgnoringInterrupt(latch: CountDownLatch) {
            while (true) {
                try { latch.await(); return } catch (_: InterruptedException) {}
            }
        }
        try {
            val future = executor.submit {
                if (!worker.start()) return@submit
                try {
                    started.countDown()
                    awaitIgnoringInterrupt(finishNative)
                    cleanupStarted.countDown()
                    awaitIgnoringInterrupt(finishCleanup)
                } finally {
                    worker.finish()
                    settled.countDown()
                }
            }
            assertTrue(started.await(2, TimeUnit.SECONDS))
            future.cancel(true)
            worker.cancelBeforeStart() // Cannot release a worker that has started.
            lease.close()
            assertTrue(future.isDone)
            assertTrue(future.isCancelled)
            assertNull(gate.tryAcquire())
            finishNative.countDown()
            assertTrue(cleanupStarted.await(2, TimeUnit.SECONDS))
            assertNull("late resource cleanup still owns the lease", gate.tryAcquire())
            finishCleanup.countDown()
            assertTrue(settled.await(2, TimeUnit.SECONDS))
            assertNotNull(gate.tryAcquire())
        } finally {
            finishNative.countDown()
            finishCleanup.countDown()
            executor.shutdownNow()
            assertTrue(executor.awaitTermination(2, TimeUnit.SECONDS))
        }
    }

    @Test fun multipleOutstandingWorkersMustAllSettle() {
        val gate = NativeInitializationGate()
        val lease = checkNotNull(gate.tryAcquire())
        val first = lease.trackWorker()
        val second = lease.trackWorker()
        first.start(); second.start(); lease.close()
        first.finish()
        assertNull(gate.tryAcquire())
        second.finish()
        assertNotNull(gate.tryAcquire())
    }

    @Test fun failuresReleaseInFinallyAndDuplicateSignalsCannotReleaseANewerLease() {
        val gate = NativeInitializationGate()
        val lease = checkNotNull(gate.tryAcquire())
        val worker = lease.trackWorker()
        assertTrue(worker.start())
        try { throw IllegalStateException("native failed") }
        catch (_: IllegalStateException) {}
        finally { worker.finish(); lease.close() }
        val newer = checkNotNull(gate.tryAcquire())
        worker.finish(); worker.cancelBeforeStart(); lease.close()
        assertNull(gate.tryAcquire())
        newer.close()
        assertNotNull(gate.tryAcquire())
    }

    @Test fun aClosedCallerCannotRegisterMoreWork() {
        val lease = checkNotNull(NativeInitializationGate().tryAcquire())
        lease.close()
        assertThrows(IllegalStateException::class.java) { lease.trackWorker() }
    }

    @Test fun failedCleanupQuarantinesEvenAfterTheRealWorkerFinishes() {
        val gate = NativeInitializationGate()
        val lease = checkNotNull(gate.tryAcquire())
        val worker = lease.trackWorker()
        worker.start()
        lease.close()
        lease.quarantine()
        assertThrows(IllegalStateException::class.java) { lease.requireSafeInitialization() }
        worker.finish()
        assertNull(gate.tryAcquire())
    }

    @Test fun cancellationRacingWorkerStartSettlesExactlyOnce() {
        val executor = Executors.newFixedThreadPool(2)
        try {
            repeat(200) {
                val gate = NativeInitializationGate()
                val lease = checkNotNull(gate.tryAcquire())
                val worker = lease.trackWorker()
                lease.close()
                val start = executor.submit { if (worker.start()) worker.finish() }
                val cancel = executor.submit { worker.cancelBeforeStart() }
                start.get(2, TimeUnit.SECONDS)
                cancel.get(2, TimeUnit.SECONDS)
                assertNotNull(gate.tryAcquire())
            }
        } finally {
            executor.shutdownNow()
            assertTrue(executor.awaitTermination(2, TimeUnit.SECONDS))
        }
    }
}
