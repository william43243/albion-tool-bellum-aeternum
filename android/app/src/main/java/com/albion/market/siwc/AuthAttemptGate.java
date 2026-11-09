package com.albion.market.siwc;
/** Process-local generation fence covers service scheduling and delayed browser launches. */
public final class AuthAttemptGate {
 private long generation; private boolean pending;
 public synchronized long reserve(){if(pending)throw new IllegalStateException("AUTH_BUSY");pending=true;return ++generation;}
 public synchronized boolean isCurrent(long id){return pending&&id==generation;}
 public synchronized boolean active(){return pending;}
 public synchronized void cancel(){generation++;pending=false;}
 public synchronized void complete(long id){if(id==generation)pending=false;}
}
