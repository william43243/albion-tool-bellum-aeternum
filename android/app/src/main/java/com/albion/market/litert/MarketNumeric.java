package com.albion.market.litert;
public final class MarketNumeric {
 public static long exactLong(Object number){if(!(number instanceof Integer)&&!(number instanceof Long))throw new IllegalArgumentException("Non-integer numeric field");return ((Number)number).longValue();}
 public static Long weightedAverage(long sum,long volume){if(sum<0||volume<0)throw new IllegalArgumentException("Negative market value");return volume==0?null:sum/volume;}
}
