import android.content.Context;
import com.albion.market.litert.PlanEngine;
import org.json.JSONObject;
public final class PlanToolHarness {
 public static void main(String[] args) {
  PlanEngine engine=new PlanEngine(new Context());
  JSONObject request=PlanHarness.request("ore",7,-1,"4301",new String[]{"red"});
  request.remove("enchantment");
  JSONObject full=new JSONObject(engine.getTool().execute(request.toString()));
  JSONObject compact=new JSONObject(engine.getLocalTool().execute(request.toString()));
  for(JSONObject result:new JSONObject[]{full,compact}) {
   PlanHarness.require("no_data".equals(result.getString("status")) && result.getJSONArray("results").length()==0,"unknown facts remain empty");
   PlanHarness.require(result.getJSONObject("request").getInt("enchantment")==-1,"omitted enchantment defaults to unspecified");
  }
  PlanHarness.require(full.getJSONArray("warnings").toString().contains("No enchantment filter"),"default must be disclosed");
  PlanHarness.require(compact.getJSONArray("warnings").toString().contains("No enchantment filter"),"local default must be disclosed");
  request.put("enchantment",1);
  JSONObject filtered=new JSONObject(engine.getLocalTool().execute(request.toString()));
  PlanHarness.require("no_data".equals(filtered.getString("status")) && filtered.getJSONObject("request").getInt("enchantment")==1,"filter preserved");
  PlanHarness.require(new JSONObject(engine.getTool().getToolDescriptionJsonString()).similar(new JSONObject(engine.getLocalTool().getToolDescriptionJsonString())),"tool schemas must match");
  System.out.println("PLAN TOOL JVM: empty results, filters, defaults and schemas passed");
 }
}
