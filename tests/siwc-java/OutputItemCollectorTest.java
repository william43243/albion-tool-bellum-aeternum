import com.albion.market.siwc.OutputItemCollector;
import java.util.*;
import java.io.IOException;
import java.io.StringReader;
import com.albion.market.siwc.SseReader;
import com.nimbusds.jose.util.JSONObjectUtils;
public class OutputItemCollectorTest {
 interface Check {void run() throws Exception;}
 static void fails(String code,Check check)throws Exception{try{check.run();throw new AssertionError(code);}catch(IOException e){if(!code.equals(e.getMessage()))throw e;}}
 public static void main(String[] args)throws Exception{
  OutputItemCollector<String> c=new OutputItemCollector<>();
  String call="{type:function_call,call_id:call_1,name:get_prices,arguments:complete}";
  c.add(1,"fc_1",call);c.add(0,"rs_1","encrypted reasoning");
  if(!c.resolve(true,List.of(),List.of()).equals(List.of("encrypted reasoning",call)))throw new AssertionError("lost final tool item");
  fails("STREAM_NOT_COMPLETED",()->c.resolve(false,List.of(),List.of()));
  c.add(1,"fc_1",call);
  if(c.resolve(true,List.of(),List.of()).size()!=2)throw new AssertionError("duplicate executed");
  fails("STREAM_ITEM_DUPLICATE",()->c.add(1,"fc_1","changed arguments"));
  fails("STREAM_OUTPUT_CONFLICT",()->c.resolve(true,List.of("other"),List.of("other_id")));
  if(c.resolve(true,List.of("encrypted reasoning",call),List.of("rs_1","fc_1")).size()!=2)throw new AssertionError("duplicate replay");
  OutputItemCollector<String> gap=new OutputItemCollector<>();gap.add(1,"fc_1",call);
  fails("STREAM_ITEM_GAP",()->gap.resolve(true,List.of(),List.of()));
  OutputItemCollector<String> empty=new OutputItemCollector<>();if(!empty.resolve(true,List.of(),List.of()).isEmpty())throw new AssertionError("invented output");
  fails("STREAM_ITEM_INVALID",()->empty.add(128,"x","x"));
  OutputItemCollector<Map<String,String>> enriched=new OutputItemCollector<>(Objects::equals,
   (a,b)->a.get("id").equals(b.get("id")),
   (a,b)->{Map<String,String> m=new HashMap<>(a);m.putAll(b);return m;});
  enriched.add(0,"rs_2",Map.of("id","rs_2","encrypted_content","opaque"));
  fails("STREAM_ITEM_DUPLICATE",()->enriched.add(0,"rs_2",Map.of("id","rs_2","encrypted_content","opaque","extra","new")));
  Map<String,String> merged=enriched.resolve(true,List.of(Map.of("id","rs_2","metadata","extra")),List.of("rs_2")).get(0);
  if(!"opaque".equals(merged.get("encrypted_content")) || !"extra".equals(merged.get("metadata")))throw new AssertionError("lost replay fields");
  String fixture="data: {\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":{\"id\":\"fc_fixture\",\"type\":\"function_call\",\"status\":\"completed\",\"call_id\":\"call_fixture\",\"name\":\"get_prices\",\"arguments\":\"{}\"}}\n\n"
   +"data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[]}}\n\n";
  SseReader reader=new SseReader(new StringReader(fixture),10000);
  OutputItemCollector<Map<String,Object>> fromStream=new OutputItemCollector<>();boolean complete=false;String raw;
  while((raw=reader.nextEvent())!=null){Map<String,Object> event=JSONObjectUtils.parse(raw);
   if("response.output_item.done".equals(event.get("type"))){
    @SuppressWarnings("unchecked") Map<String,Object> item=(Map<String,Object>)event.get("item");
    fromStream.add(((Number)event.get("output_index")).intValue(),(String)item.get("id"),item);
   } else if("response.completed".equals(event.get("type")))complete=true;
  }
  List<Map<String,Object>> retained=fromStream.resolve(complete,List.of(),List.of());
  if(retained.size()!=1 || !"call_fixture".equals(retained.get(0).get("call_id")))throw new AssertionError("SSE final function lost with minimal terminal");
  System.out.println("Final stream item retention, terminal requirement, order, conflict, duplicate and bound tests passed");
 }
}
