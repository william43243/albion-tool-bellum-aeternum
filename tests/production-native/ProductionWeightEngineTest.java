import com.albion.market.litert.ProductionWeightEngine;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.file.Files;
import java.nio.file.Paths;

public class ProductionWeightEngineTest {
  static void check(boolean b,String s) { if (!b) throw new AssertionError(s); }
  static JSONObject row(String id,Object ench,double amount) { return new JSONObject().put("sourceId",id).put("enchantment",ench).put("quantity",amount); }
  static JSONObject entry(String id,Object ench,Object weight,String origin) { return new JSONObject().put("sourceId",id).put("enchantment",ench).put("weight",weight).put("origin",origin); }
  public static void main(String[] args) throws Exception {
    Object nil=JSONObject.NULL;
    JSONArray entries=new JSONArray().put(entry("ORE",0,0.51,"item")).put(entry("POTION",nil,0.87,"item"))
      .put(entry("POTION",1,1.1,"enchantment")).put(entry("POTION",2,nil,"enchantment"));
    JSONObject index=new JSONObject().put("schemaVersion",1).put("provenance",new JSONObject().put("unit","source_unconfirmed").put("sourceCommit","test"))
      .put("entries",entries);
    JSONObject complete=ProductionWeightEngine.calculate(new JSONArray().put(row("ORE",0,10)).put(row("POTION",1,2)),index);
    check(complete.getString("status").equals("ok"),"complete status");
    check(Math.abs(complete.getDouble("total")-7.3)<1e-9,"10*0.51 + 2*1.1");
    check(complete.getString("unit").equals("source_unconfirmed"),"unknown unit");
    check(complete.getJSONObject("provenance").getString("sourceCommit").equals("test"),"provenance");
    JSONObject incomplete=ProductionWeightEngine.calculate(new JSONArray().put(row("ORE",0,10)).put(row("POTION",2,4)).put(row("POTION",3,1)),index);
    check(incomplete.isNull("total"),"incomplete total is null");
    check(Math.abs(incomplete.getDouble("knownSubtotal")-5.1)<1e-9,"known subtotal");
    check(incomplete.getJSONArray("missing").length()==2,"missing count");
    check(incomplete.getJSONArray("missing").getJSONObject(0).getString("reason").equals("UNKNOWN_WEIGHT"),"known variant, unknown weight");
    check(incomplete.getJSONArray("missing").getJSONObject(1).getString("reason").equals("NO_MATCH"),"no inheritance from base");
    JSONObject unknownLevel=ProductionWeightEngine.calculate(new JSONArray().put(row("POTION",nil,1)),index);
    check(Math.abs(unknownLevel.getDouble("total")-.87)<1e-9,"exact null level");
    check(unknownLevel.getJSONArray("materials").getJSONObject(0).isNull("enchantment"),"level remains explicitly unknown");
    check(ProductionWeightEngine.calculate(new JSONArray().put(row("ORE",0,0)),index).getString("status").equals("error"),"zero quantity rejected");
    check(ProductionWeightEngine.calculate(new JSONArray().put(new JSONObject().put("sourceId","ORE").put("quantity",1)),index).getString("status").equals("error"),"missing level rejected");
    entries.put(entry("ORE",0,0.51,"item"));
    check(ProductionWeightEngine.calculate(new JSONArray().put(row("ORE",0,1)),index).getJSONObject("error").getString("code").equals("INVALID_INDEX"),"duplicate index rejected");
    JSONObject realIndex=new JSONObject(Files.readString(Paths.get("assets/production/weights.json")));
    long start=System.nanoTime();
    JSONObject real=ProductionWeightEngine.calculate(new JSONArray().put(row("T4_ORE",0,10)).put(row("T4_MAIN_SWORD",1,1)),realIndex);
    double elapsedMs=(System.nanoTime()-start)/1_000_000.0;
    check(real.isNull("total"),"real unknown variant");
    check(Math.abs(real.getDouble("knownSubtotal")-5.1)<1e-9,"real ore weight");
    check(real.getJSONArray("missing").length()==1,"real missing variant count");
    System.out.printf("ProductionWeightEngine: synthetic and full index checks passed (%.1f ms full-index calculation)%n",elapsedMs);
  }
}
