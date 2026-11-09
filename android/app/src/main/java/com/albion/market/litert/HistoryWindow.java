package com.albion.market.litert;
/** UTC complete-day window for daily AODP observations. Never expands the requested average. */
public final class HistoryWindow {
 public static final long DAY=86_400_000L;
 public final int days; public final long start,end;
 public HistoryWindow(long now,int days){
  if(days!=7 && days!=30 && days!=60 && days!=90)throw new IllegalArgumentException("Unsupported history days");
  this.days=days;end=Math.floorDiv(now,DAY)*DAY;start=end-days*DAY;
 }
 public boolean includes(long timestamp){
  // AODP can return one adjacent daily bucket. Exclude it explicitly, never average it.
  if(timestamp<start-DAY || timestamp>=end+DAY)throw new IllegalArgumentException("History far outside requested period");
  return timestamp>=start && timestamp<end;
 }
}
