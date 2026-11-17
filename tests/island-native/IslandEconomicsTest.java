import com.albion.market.litert.IslandEconomics;
import org.json.JSONObject;

public class IslandEconomicsTest {
  static void check(boolean b, String message){if(!b)throw new AssertionError(message);}
  static void equal(double actual,double expected,String label){if(Math.abs(actual-expected)>1e-7)throw new AssertionError(label+": "+actual+" != "+expected);}
  // All inputs here are hypothetical and do not assert current Albion game rules.
  static JSONObject sample(){return new JSONObject().put("plots",1).put("slotsPerPlot",9).put("slotsUsed",9).put("wateredSlots",5).put("ownedSeeds",0)
    .put("replacementSeedPrice",10000).put("ownedSeedOpportunityPrice",10000).put("harvestPerSlot",9).put("cityYieldMultiplier",1.1)
    .put("outputSalePrice",439.68).put("saleTaxRate",0).put("saleFeePerCycle",0)
    .put("seedReturnWithoutFocus",0.8).put("seedReturnWithFocus",1.2).put("focusPerWateredSlot",100)
    .put("cycleCount",1).put("cycleDays",JSONObject.NULL);}
  static JSONObject result(JSONObject x){JSONObject r=IslandEconomics.calculate(x);check(r.getString("status").equals("ok"),r.toString());return r;}
  static void fail(JSONObject x,String code){JSONObject r=IslandEconomics.calculate(x);check(r.getString("status").equals("error")&&r.getJSONObject("error").getString("code").equals(code),r.toString());}
  public static void main(String[] args){
    JSONObject r=result(sample());
    equal(r.getJSONObject("output").getDouble("meanUnitsPerCycle"),89.1,"9*9*1.10");
    equal(r.getJSONObject("output").getDouble("grossRevenueIfSold"),39175.488,"revenue");
    JSONObject b=r.getJSONObject("baseline"), s=r.getJSONObject("selected");
    equal(b.getDouble("meanReturnedSeeds"),7.2,"baseline returns");equal(b.getDouble("meanFlowReplacementSeeds"),1.8,"baseline replacements");
    equal(b.getDouble("meanFlowReplacementCost"),18000,"baseline replacement cost");equal(b.getDouble("meanFlowProfitPerCycle"),21175.488,"baseline net");
    equal(s.getDouble("meanReturnedSeeds"),9.2,"watered returns");equal(s.getDouble("meanFlowSurplusSeeds"),.2,"surplus separated");
    equal(s.getDouble("meanFlowReplacementCost"),0,"mean flow replacement");equal(s.getDouble("meanFlowProfitPerCycle"),39175.488,"surplus excluded");
    equal(r.getDouble("focusPerCycle"),500,"focus");equal(r.getDouble("incrementalMeanFlowProfitPerCycle"),18000,"marginal profit");
    equal(r.getDouble("incrementalMeanFlowSilverPerFocus"),36,"marginal efficiency");
    check(r.isNull("realizedCashProfit"),"cash profit unknown");check(r.getJSONObject("projection").isNull("daily"),"cadence unknown");
    JSONObject owned=result(sample().put("ownedSeeds",4).put("ownedSeedOpportunityPrice",12000));
    equal(owned.getJSONObject("initialSeeds").getDouble("purchaseCash"),50000,"cash purchase");
    equal(owned.getJSONObject("initialSeeds").getDouble("ownedOpportunityCost"),48000,"owned opportunity");
    equal(owned.getJSONObject("initialSeeds").getDouble("initialEconomicValue"),98000,"initial economic value");
    JSONObject perPlot=result(sample().put("plots",2).put("slotsUsed",18).put("wateredSlots",10).put("cycleDays",2).put("cycleCount",4));
    equal(perPlot.getJSONObject("baseline").getDouble("meanFlowProfitPerPlot"),21175.488,"per plot average");
    equal(perPlot.getJSONObject("projection").getDouble("daily"),39175.488,"cadence daily");
    equal(perPlot.getJSONObject("projection").getDouble("weekly"),274228.416,"cadence weekly");
    equal(perPlot.getJSONObject("projection").getDouble("monthly30Days"),1175264.64,"cadence monthly 30 days");
    equal(perPlot.getJSONObject("projection").getDouble("meanFlowProfit"),313403.904,"four cycle projection");
    JSONObject noFocus=result(sample().put("wateredSlots",0).put("seedReturnWithFocus",JSONObject.NULL).put("focusPerWateredSlot",JSONObject.NULL));
    check(noFocus.isNull("incrementalMeanFlowSilverPerFocus"),"no focus efficiency unknown");
    JSONObject fees=result(sample().put("saleTaxRate",.1).put("saleFeePerCycle",100));
    equal(fees.getJSONObject("output").getDouble("taxAssumption"),3917.5488,"declared tax");
    equal(fees.getJSONObject("baseline").getDouble("meanFlowProfitPerCycle"),17157.9392,"fees applied");
    fail(sample().put("slotsUsed",10),"INVALID_FIELD");fail(sample().put("ownedSeeds",1).put("ownedSeedOpportunityPrice",0),"INVALID_FIELD");
    fail(sample().put("cycleDays",0),"INVALID_FIELD");fail(sample().put("seedReturnWithFocus",JSONObject.NULL),"MISSING_FIELD");
    JSONObject missing=sample();missing.remove("cityYieldMultiplier");fail(missing,"MISSING_FIELD");
    fail(sample().put("bogus",1),"INVALID_FIELD");
    check(IslandEconomics.calculate(sample(),()->true).getJSONObject("error").getString("code").equals("CANCELLED"),"cancellation");
    System.out.println("IslandEconomics: all synthetic scenarios passed");
  }
}
