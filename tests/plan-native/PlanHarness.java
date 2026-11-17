import com.albion.market.litert.PlanEngine;
import org.json.*;
public class PlanHarness {
 static JSONObject request(String q,int t,int e,String start,String[] risks) { return new JSONObject().put("query",q).put("kind","resource").put("tier",t).put("enchantment",e).put("startZoneId",start).put("excludedRisks",new JSONArray(risks)).put("policy","fewest_transitions"); }
 static void require(boolean v,String m){if(!v) throw new AssertionError(m);}
 public static void main(String[] args){
  PlanEngine p=new PlanEngine(new android.content.Context());
  JSONObject result=p.search(request("ore",7,-1,"4301",new String[]{"red"}));
  require(result.getString("status").equals("no_data") && result.getJSONArray("results").length()==0,"no sourced occurrences");
  require(p.search(request("ore",7,-1,"not a zone",new String[]{})).getString("status").equals("invalid_request"),"unknown origin");
  for(String id:new String[]{"2311","4208","4338","4342","4353","4000"}) {
   JSONObject zone=p.zoneResources(id);
   require(zone.getString("status").equals("no_data") && zone.getJSONArray("resources").length()==0 && zone.isNull("totalNodes"),"unknown zone "+id);
  }
  JSONObject toolResult=new JSONObject(p.getZoneResourcesTool().execute("{\"zone\":\"Mawar Gorge\"}"));
  require(toolResult.getString("status").equals("no_data") && toolResult.getJSONArray("resources").length()==0,"zone tool dispatch");
  require(p.zoneResources("not a zone").getString("status").equals("invalid_zone"),"invalid zone");
  System.out.println("PLAN JVM: unknown zone lookup, empty planner, tool dispatch and invalid origin passed");
 }
}
