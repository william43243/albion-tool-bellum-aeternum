package com.albion.market.siwc;

/** Monotonic, bounded authorization and late-return windows. No account data. */
public final class LoopbackWindow {
 public static final long AUTHORIZATION_MS=30*60*1000L, GRACE_MS=5*60*1000L, WORK_MS=37*60*1000L;
 public static final int WAITING=0, EXPIRED=1, CLOSED=2;
 public final long expiresAt, closesAt;
 public LoopbackWindow(long start,long active,long grace){
  if(start<0||active<=0||grace<0||active>Long.MAX_VALUE-grace||start>Long.MAX_VALUE-active-grace)throw new IllegalArgumentException("WINDOW_INVALID");
  expiresAt=start+active;closesAt=expiresAt+grace;
 }
 public int phase(long now){return now<expiresAt?WAITING:now<closesAt?EXPIRED:CLOSED;}
 public long remaining(long now){return Math.max(0,expiresAt-now);}
 public String label(long now){int p=phase(now);return p==WAITING?"WAITING":p==EXPIRED?"EXPIRED":"CLOSED";}
}
