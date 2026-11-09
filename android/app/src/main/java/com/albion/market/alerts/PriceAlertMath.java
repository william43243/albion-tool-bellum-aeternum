package com.albion.market.alerts;
import java.util.Calendar;
import java.util.TimeZone;
public final class PriceAlertMath {
 private PriceAlertMath() {}
 public static boolean eligible(long now,long observed,long price,long threshold,int maxAgeMinutes,String op,TimeZone zone) {
  if(price<=0 || threshold<=0 || observed<=0 || observed>now || maxAgeMinutes<0 || maxAgeMinutes>1440)return false;
  Calendar a=Calendar.getInstance(zone),b=Calendar.getInstance(zone);a.setTimeInMillis(now);b.setTimeInMillis(observed);
  if(a.get(Calendar.YEAR)!=b.get(Calendar.YEAR) || a.get(Calendar.DAY_OF_YEAR)!=b.get(Calendar.DAY_OF_YEAR))return false;
  if(maxAgeMinutes>0 && now-observed>maxAgeMinutes*60000L)return false;
  switch(op){case "le":return price<=threshold;case "ge":return price>=threshold;case "eq":return price==threshold;default:return false;}
 }
}
