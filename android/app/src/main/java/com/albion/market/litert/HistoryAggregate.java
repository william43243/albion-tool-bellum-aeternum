package com.albion.market.litert;
import java.util.*;
/** Exact arithmetic on reported integer daily aggregates, not original trades. */
public final class HistoryAggregate {
 private final HistoryWindow window; private final Set<Long> seen=new HashSet<>(),usableDays=new HashSet<>();
 public long weightedSum=0,totalVol=0,min=Long.MAX_VALUE,max=0,first=Long.MAX_VALUE,last=Long.MIN_VALUE,lastPrice=0;
 public int usable=0,observed=0,excluded=0;
 public HistoryAggregate(HistoryWindow window){this.window=window;}
 public void add(long timestamp,long avg,long volume){
  if(avg<0 || avg>Integer.MAX_VALUE || volume<0 || volume>Integer.MAX_VALUE || !seen.add(timestamp))throw new IllegalArgumentException("Invalid history point");
  if(!window.includes(timestamp)){excluded++;return;}
  observed++;if(avg==0 || volume==0)return;
  weightedSum=Math.addExact(weightedSum,Math.multiplyExact(avg,volume));totalVol=Math.addExact(totalVol,volume);
  usable++;usableDays.add(Math.floorDiv(timestamp,HistoryWindow.DAY));min=Math.min(min,avg);max=Math.max(max,avg);first=Math.min(first,timestamp);
  if(timestamp>last){last=timestamp;lastPrice=avg;}
 }
 public Long averageFloor(){return MarketNumeric.weightedAverage(weightedSum,totalVol);}
 public int observedUsableDays(){return usableDays.size();}
 public int missingOrUnusableDays(){return window.days-usableDays.size();}
}
