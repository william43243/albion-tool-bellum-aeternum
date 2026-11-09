import com.albion.market.litert.FlipComparison;
import java.util.*;
public class FlipComparisonTest {
 static final long NOW=1793919600000L;
 static FlipComparison.Quote q(String city,long ask,long bid,long age){return new FlipComparison.Quote(city,ask,bid,NOW-age,NOW-age);}
 static FlipComparison.Routes routes=(a,b)->b.equals("Brecilien")?null:new FlipComparison.Route(b.equals("Martlock")?6:12,b.equals("Martlock")?3:0,0,0);
 static void ok(boolean v,String message){if(!v)throw new AssertionError(message);}
 public static void main(String[]args){
  List<FlipComparison.Quote> qs=Arrays.asList(q("Caerleon",100,90,0),q("Martlock",250,200,0),q("Thetford",220,150,0),q("Lymhurst",999,999,3600001),q("Brecilien",300,300,0));
  FlipComparison.Result profit=FlipComparison.compare(qs,"Caerleon",10,true,"instant","instant",60,"profit",routes,NOW);
  ok(profit.candidates.size()==2,"stale, absent and unmapped candidates excluded");
  FlipComparison.Candidate best=profit.candidates.get(0);
  ok(best.to.equals("Martlock")&&best.buyPrice==100&&best.sellPrice==200&&best.cost==1000&&best.tax==80&&best.net==920,"instant bid/ask and premium net");
  ok(profit.excluded.stream().anyMatch(e->e.to.equals("Lymhurst")&&e.reason.equals("stale_sale_quote")),"stale quote cannot win despite its price");
  ok(profit.excluded.stream().anyMatch(e->e.to.equals("Brecilien")&&e.reason.equals("no_static_route")),"cannot draw unknown route");
  FlipComparison.Result safer=FlipComparison.compare(qs,"Caerleon",10,true,"instant","instant",60,"least_risk",routes,NOW);
  ok(safer.candidates.get(0).to.equals("Thetford"),"risk preference changes recommendation");
  FlipComparison.Result staleOrigin=FlipComparison.compare(Arrays.asList(q("Caerleon",1,1,3600001),q("Martlock",100,99,0)),"Caerleon",1,false,"instant","instant",60,"profit",routes,NOW);
  ok(staleOrigin.candidates.isEmpty(),"old purchase quote cannot produce a false profit");
  FlipComparison.Candidate order=new FlipComparison.Candidate("Caerleon","Martlock",11,13,NOW,NOW,3,false,true,true,new FlipComparison.Route(6,3,0,0));
  ok(order.cost==33&&order.revenue==39&&order.buyFee==1&&order.sellFee==1&&order.tax==4&&order.net==0,"ceil each fee once per order, not per item");
  FlipComparison.Candidate huge=new FlipComparison.Candidate("A","B",Integer.MAX_VALUE,Integer.MAX_VALUE,NOW,NOW,100000,false,true,true,new FlipComparison.Route(1,0,0,0));
  ok(huge.cost==214748364700000L&&huge.net<0,"large legal amounts do not overflow or become free");
  FlipComparison.Result orderModes=FlipComparison.compare(qs,"Caerleon",1,true,"order","order",60,"profit",routes,NOW);
  ok(orderModes.candidates.get(0).buyPrice==90&&orderModes.candidates.get(0).sellPrice==250,"order sides differ from instant sides");
  FlipComparison.Result any=FlipComparison.compare(qs,"any",1,true,"instant","instant",60,"profit_per_transition",routes,NOW);
  ok(any.candidates.stream().noneMatch(c->c.from.equals(c.to)),"intercity scope excludes same city");
  ok(any.candidates.get(0).net>0,"profitable alternatives precede loss-making rows");
  FlipComparison.Result local=FlipComparison.compare(Arrays.asList(q("Caerleon",100,80,0)),"Caerleon",10,true,"order","order",60,"profit",routes,NOW,true);
  FlipComparison.Candidate same=local.candidates.get(0);
  ok(same.from.equals(same.to)&&same.buyPrice==80&&same.sellPrice==100&&same.net==115&&same.route.transitions==0,"same-city uses order sides, fees and zero transitions");
  FlipComparison.Result expiredLocal=FlipComparison.compare(Arrays.asList(q("Caerleon",100,80,3600001)),"Caerleon",1,true,"order","order",60,"profit",routes,NOW,true);
  ok(expiredLocal.candidates.isEmpty(),"stale local quotes are excluded");
  try{FlipComparison.compare(qs,"Caerleon",0,true,"instant","instant",60,"profit",routes,NOW);throw new AssertionError("zero quantity accepted");}catch(IllegalArgumentException expected){}
  try{FlipComparison.compare(Arrays.asList(qs.get(0),qs.get(0)),"any",1,true,"instant","instant",60,"profit",routes,NOW);throw new AssertionError("duplicate quote accepted");}catch(IllegalArgumentException expected){}
  System.out.println("Flip quotes, stale exclusions, route risk ranking, order sides, fee rounding and overflow passed");
 }
}

