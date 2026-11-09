package com.albion.market.litert;
import java.util.*;

/** Read-only, snapshot-based inter-city comparison. No order depth or execution guarantee. */
public final class FlipComparison {
 public static final List<String> CITIES=Collections.unmodifiableList(Arrays.asList("Caerleon","Bridgewatch","Fort Sterling","Lymhurst","Thetford","Martlock","Brecilien"));
 public static final class Quote {
  public final String city; public final long ask,bid,askAt,bidAt;
  public Quote(String city,long ask,long bid,long askAt,long bidAt){this.city=city;this.ask=ask;this.bid=bid;this.askAt=askAt;this.bidAt=bidAt;}
 }
 public static final class Route {
  public final int transitions,red,black,unknown;
  public Route(int transitions,int red,int black,int unknown){
   if(transitions<0||transitions>414||red<0||black<0||unknown<0)throw new IllegalArgumentException("Invalid route");
   this.transitions=transitions;this.red=red;this.black=black;this.unknown=unknown;
  }
  public int hazards(){return red+black+unknown;}
 }
 public interface Routes { Route find(String from,String to); }
 public static final class Candidate {
  public final String from,to;public final long buyPrice,sellPrice,buyAt,sellAt,cost,revenue,buyFee,sellFee,tax,net;public final Route route;
  public Candidate(String from,String to,long buyPrice,long sellPrice,long buyAt,long sellAt,int quantity,boolean premium,boolean buyOrder,boolean sellOrder,Route route){
   if(buyPrice<1||buyPrice>Integer.MAX_VALUE||sellPrice<1||sellPrice>Integer.MAX_VALUE||quantity<1||quantity>100000)throw new IllegalArgumentException("Invalid quote size");
   this.from=from;this.to=to;this.buyPrice=buyPrice;this.sellPrice=sellPrice;this.buyAt=buyAt;this.sellAt=sellAt;this.route=route;
   cost=buyPrice*quantity;revenue=sellPrice*quantity;
   buyFee=buyOrder?ceilRate(cost,25,1000):0;sellFee=sellOrder?ceilRate(revenue,25,1000):0;tax=ceilRate(revenue,premium?4:8,100);
   net=revenue-cost-buyFee-sellFee-tax;
  }
 }
 public static final class Excluded {
  public final String from,to,reason;
  public Excluded(String from,String to,String reason){this.from=from;this.to=to;this.reason=reason;}
 }
 public static final class Result {
  public final List<Candidate> candidates=new ArrayList<>();public final List<Excluded> excluded=new ArrayList<>();
 }
 private static long ceilRate(long total,long numerator,long denominator){return (total*numerator+denominator-1)/denominator;}
 private static boolean fresh(long timestamp,long now,int maxAge){return timestamp>0&&timestamp<=now+300000L&&now-timestamp<=maxAge*60000L;}
 public static Result compare(List<Quote> quotes,String origin,int quantity,boolean premium,String buyMode,String sellMode,int maxAge,String sort,Routes routes,long now){
  return compare(quotes,origin,quantity,premium,buyMode,sellMode,maxAge,sort,routes,now,false);
 }
 public static Result compare(List<Quote> quotes,String origin,int quantity,boolean premium,String buyMode,String sellMode,int maxAge,String sort,Routes routes,long now,boolean includeSameCity){
  if(!origin.equals("any")&&!CITIES.contains(origin))throw new IllegalArgumentException("Unknown origin");
  if(quantity<1||quantity>100000||maxAge<1||maxAge>1440||!Arrays.asList("instant","order").contains(buyMode)||!Arrays.asList("instant","order").contains(sellMode)||!Arrays.asList("profit","profit_per_transition","distance","least_risk").contains(sort))throw new IllegalArgumentException("Invalid comparison");
  Map<String,Quote> byCity=new HashMap<>();
  for(Quote q:quotes){if(!CITIES.contains(q.city)||byCity.put(q.city,q)!=null||q.ask<0||q.bid<0||q.ask>Integer.MAX_VALUE||q.bid>Integer.MAX_VALUE)throw new IllegalArgumentException("Invalid quote identity");}
  Result result=new Result();
  for(String from:CITIES){if(!origin.equals("any")&&!from.equals(origin))continue;
   for(String to:CITIES){if(from.equals(to)&&!includeSameCity)continue;
    Quote a=byCity.get(from),b=byCity.get(to);boolean buyOrder=buyMode.equals("order"),sellOrder=sellMode.equals("order");
    long buy=a==null?0:buyOrder?a.bid:a.ask,buyAt=a==null?0:buyOrder?a.bidAt:a.askAt;
    long sell=b==null?0:sellOrder?b.ask:b.bid,sellAt=b==null?0:sellOrder?b.askAt:b.bidAt;
    String reason=buy<=0?"missing_purchase_quote":!fresh(buyAt,now,maxAge)?"stale_purchase_quote":sell<=0?"missing_sale_quote":!fresh(sellAt,now,maxAge)?"stale_sale_quote":null;
    Route route=reason==null?(from.equals(to)?new Route(0,0,0,0):routes.find(from,to)):null;
    if(reason==null&&route==null)reason="no_static_route";
    if(reason!=null){result.excluded.add(new Excluded(from,to,reason));continue;}
    result.candidates.add(new Candidate(from,to,buy,sell,buyAt,sellAt,quantity,premium,buyOrder,sellOrder,route));
   }
  }
  result.candidates.sort((a,b)->{
   // Positive estimates precede losing alternatives for every criterion.
   int c=Boolean.compare(b.net>0,a.net>0);if(c!=0)return c;
   if(sort.equals("distance"))c=Integer.compare(a.route.transitions,b.route.transitions);
   else if(sort.equals("least_risk"))c=Integer.compare(a.route.hazards(),b.route.hazards());
   else if(sort.equals("profit_per_transition"))c=Long.compare(b.net*Math.max(1,a.route.transitions),a.net*Math.max(1,b.route.transitions));
   else c=Long.compare(b.net,a.net);
   if(c==0)c=Long.compare(b.net,a.net);
   if(c==0)c=Integer.compare(a.route.transitions,b.route.transitions);
   if(c==0)c=Integer.compare(a.route.hazards(),b.route.hazards());
   if(c==0)c=a.from.compareTo(b.from);return c==0?a.to.compareTo(b.to):c;
  });
  return result;
 }
}
