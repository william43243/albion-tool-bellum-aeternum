package com.albion.market.siwc;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/** Socket/TLS teardown can perform I/O. Never execute it on the caller/UI thread. */
public final class NetworkCleanup {
 private static final AtomicInteger IDS = new AtomicInteger();
 private static final ExecutorService WORKERS = Executors.newFixedThreadPool(2, runnable -> {
  Thread thread = new Thread(runnable, "albion-network-cleanup-" + IDS.incrementAndGet());
  thread.setDaemon(true);
  return thread;
 });
 private NetworkCleanup() {}
 public static void execute(Runnable cleanup) {
  WORKERS.execute(() -> { try { cleanup.run(); } catch (RuntimeException ignored) { /* Best-effort teardown; cancellation remains effective. */ } });
 }
}
