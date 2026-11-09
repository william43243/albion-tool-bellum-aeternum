import com.albion.market.litert.HistoryWindow;
import java.time.Instant;
import java.nio.file.*;
import java.util.*;
import com.nimbusds.jose.util.JSONObjectUtils;
import com.albion.market.litert.MarketNumeric;
import com.albion.market.litert.HistoryAggregate;
public class HistoryWindowTest {
 static long t(String s){return Instant.parse(s).toEpochMilli();}
 static void rejected(Runnable r){try{r.run();throw new AssertionError("accepted invalid");}catch(IllegalArgumentException expected){}}
 public static void main(String[]args)throws Exception{
  HistoryWindow w=new HistoryWindow(t("2026-11-05T23:13:14Z"),60);
  if(w.start!=t("2026-09-06T00:00:00Z") || w.end!=t("2026-11-05T00:00:00Z"))throw new AssertionError("UTC bounds");
  if(w.includes(t("2026-09-05T00:00:00Z")))throw new AssertionError("observed API boundary counted");
  if(!w.includes(w.start)||!w.includes(w.end-HistoryWindow.DAY)||w.includes(w.end))throw new AssertionError("half-open interval");
  rejected(()->w.includes(w.start-2*HistoryWindow.DAY));if(!w.includes(w.start+1))throw new AssertionError("non-midnight timestamp rejected");rejected(()->new HistoryWindow(w.end,61));
  HistoryWindow dst=new HistoryWindow(t("2026-03-30T01:30:00Z"),30);
  if(dst.end-dst.start!=30*HistoryWindow.DAY)throw new AssertionError("DST drift");
  Map<String,Object> fixture=JSONObjectUtils.parse(Files.readString(Path.of("tests/fixtures/aodp-history-t4-rock-caerleon-public-excerpt.json")));
  @SuppressWarnings("unchecked") List<Map<String,Object>> points=(List<Map<String,Object>>)fixture.get("data_excerpt");
  HistoryAggregate aggregate=new HistoryAggregate(w);
  for(Map<String,Object> point:points)aggregate.add(t(point.get("timestamp")+"Z"),((Number)point.get("avg_price")).longValue(),((Number)point.get("item_count")).longValue());
  if(aggregate.excluded!=1 || aggregate.usable!=3 || aggregate.weightedSum!=62286 || aggregate.totalVol!=7071 || aggregate.averageFloor()!=8L || aggregate.missingOrUnusableDays()!=57)throw new AssertionError("public excerpt aggregation");
  rejected(()->aggregate.add(w.start,10,4393));
  HistoryAggregate noVolume=new HistoryAggregate(w);noVolume.add(w.start,20,0);
  if(noVolume.averageFloor()!=null || noVolume.usable!=0 || noVolume.observed!=1)throw new AssertionError("zero-volume average invented");
  HistoryAggregate sameDay=new HistoryAggregate(w);sameDay.add(w.start,10,2);sameDay.add(w.start+3600000,20,3);
  if(sameDay.usable!=2 || sameDay.observedUsableDays()!=1 || sameDay.missingOrUnusableDays()!=59)throw new AssertionError("same-day coverage inflated");
  if(w.includes(w.end+3600000))throw new AssertionError("partial current day included");
  rejected(()->w.includes(w.end+HistoryWindow.DAY));
  HistoryAggregate empty=new HistoryAggregate(w);if(empty.averageFloor()!=null || empty.missingOrUnusableDays()!=60)throw new AssertionError("missing rows invented");
  HistoryAggregate overflow=new HistoryAggregate(w);overflow.add(w.start,Integer.MAX_VALUE,Integer.MAX_VALUE);overflow.add(w.start+HistoryWindow.DAY,Integer.MAX_VALUE,Integer.MAX_VALUE);
  try{overflow.add(w.start+2*HistoryWindow.DAY,Integer.MAX_VALUE,Integer.MAX_VALUE);throw new AssertionError("overflow hidden");}catch(ArithmeticException expected){}
  if(t("2026-11-05T00:00:00Z")-t("2026-09-05T00:00:00Z")==60*HistoryWindow.DAY)throw new AssertionError("calendar months confused with 60 days");
  System.out.println("History UTC bounds, real adjacent bucket, end exclusion, far-out rejection and DST tests passed");
 }
}
