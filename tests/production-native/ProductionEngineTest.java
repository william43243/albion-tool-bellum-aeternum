import com.albion.market.litert.ProductionEngine;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONArray;
import org.json.JSONObject;

public class ProductionEngineTest {
  static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
  static void eq(JSONObject result, String key, double expected) {
    double actual = result.getDouble(key);
    check(Math.abs(actual - expected) < 1e-7, key + " expected " + expected + " but got " + actual);
  }
  static JSONObject material(String id, double amount, double price, boolean returnable) {
    return new JSONObject().put("itemId", id).put("amountPerCraft", amount).put("unitPrice", price).put("returnable", returnable);
  }
  // Synthetic only: ten crafts consume 40 ore and 10 extra items; expected return is ten ore.
  static JSONObject scenario() {
    return new JSONObject().put("label", "synthetic").put("quantity", 10).put("outputPerCraft", 2)
      .put("materials", new JSONArray().put(material("ore", 4, 100, true)).put(material("extra", 1, 50, false)))
      .put("outputUnitPrice", 200).put("returnRate", 0.25).put("stationFeePerCraft", 10)
      .put("focusPerCraft", 5).put("salesTaxRate", 0.04).put("sellOrderFeeRate", 0.025)
      .put("budget", 5000).put("availableFocus", 100).put("volumeObserved", 200).put("volumeDays", 10);
  }
  static JSONObject request(JSONObject scenario) { return new JSONObject().put("scenario", scenario); }
  static JSONObject chainScenario() { return scenario().put("budget", JSONObject.NULL).put("availableFocus", JSONObject.NULL); }
  static JSONObject chainStep(String id, JSONObject s) { return new JSONObject().put("outputItemId", id).put("scenario", s); }
  static JSONObject chain() {
    JSONObject first = chainScenario().put("outputPerCraft", 1).put("materials", new JSONArray().put(material("raw", 4, 100, true)));
    JSONObject last = chainScenario().put("materials", new JSONArray().put(material("intermediate", 1, 200, false)).put(material("extra", 1, 50, false)));
    return new JSONObject().put("steps", new JSONArray().put(chainStep("intermediate", first)).put(chainStep("final", last)))
      .put("budget", 4800).put("availableFocus", 100);
  }
  static JSONObject success(ProductionEngine e, String action, JSONObject scenario) {
    JSONObject response = e.execute(action, request(scenario));
    check(response.getString("status").equals("ok"), response.toString());
    return response.getJSONObject("result");
  }
  static void error(ProductionEngine e, JSONObject scenario, String code) {
    JSONObject response = e.execute("calculate_crafting_profit", request(scenario));
    check(response.getString("status").equals("error") && response.getJSONObject("error").getString("code").equals(code), response.toString());
  }
  public static void main(String[] args) {
    ProductionEngine engine = new ProductionEngine();
    JSONObject r = success(engine, "calculate_crafting_profit", scenario());
    // Independent arithmetic: 4500 gross - 1000 returned + 100 station = 3600 expected cost;
    // 4000 revenue - 160 tax - 100 listing - 3600 = 140 profit, 4700 upfront.
    eq(r, "grossMaterialCost", 4500); eq(r, "expectedReturnedValue", 1000);
    eq(r, "expectedMaterialCost", 3500); eq(r, "stationFees", 100);
    eq(r, "initialCapitalRequired", 4700); eq(r, "expectedTotalCost", 3600);
    eq(r, "grossRevenue", 4000); eq(r, "salesTax", 160); eq(r, "sellOrderFee", 100);
    eq(r, "netProfit", 140); eq(r, "profitPerUnit", 7); eq(r, "roiPercent", 14000.0 / 4700);
    eq(r, "focusRequired", 50); eq(r, "silverPerFocus", 2.8); eq(r, "observedUnitsPerDay", 20); eq(r, "estimatedSaleDays", 1);
    check(r.getBoolean("feasible") && r.getString("provenance").equals("manual"), "manual feasible");
    eq(r.getJSONArray("materials").getJSONObject(0), "expectedReturnedUnits", 10);
    eq(r.getJSONArray("materials").getJSONObject(1), "expectedReturnedUnits", 0);

    JSONObject noFocus = scenario().put("returnRate", 0).put("focusPerCraft", 0).put("volumeObserved", JSONObject.NULL).put("volumeDays", JSONObject.NULL);
    JSONObject simple = success(engine, "calculate_focus_efficiency", noFocus);
    eq(simple, "expectedReturnedValue", 0); eq(simple, "netProfit", -860);
    check(simple.isNull("silverPerFocus") && simple.isNull("estimatedSaleDays"), "unknown metrics must stay null");
    check(success(engine, "analyze_market_liquidity", scenario().put("volumeObserved", 0)).isNull("estimatedSaleDays"), "zero volume is not a finite wait");

    check(!success(engine, "calculate_crafting_profit", scenario().put("budget", 4699)).getBoolean("feasible"), "budget includes gross upfront and listing fee");
    check(!success(engine, "calculate_crafting_profit", scenario().put("availableFocus", 49)).getBoolean("feasible"), "focus constraint");
    error(engine, scenario().put("returnRate", 1), "INVALID_FIELD");
    error(engine, scenario().put("volumeDays", JSONObject.NULL), "INVALID_FIELD");
    error(engine, scenario().put("outputUnitPrice", JSONObject.NULL), "INVALID_FIELD");
    error(engine, scenario().put("outputUnitPrice", 0), "INVALID_FIELD");
    JSONObject zeroInput = scenario(); zeroInput.getJSONArray("materials").getJSONObject(0).put("unitPrice", 0); error(engine, zeroInput, "INVALID_FIELD");
    JSONObject missing = scenario(); missing.remove("budget"); error(engine, missing, "MISSING_FIELD");
    JSONObject duplicate = scenario(); duplicate.getJSONArray("materials").put(material("ore", 1, 1, true)); error(engine, duplicate, "INVALID_FIELD");
    error(engine, scenario().put("quantity", 1.5), "INVALID_FIELD");
    error(engine, scenario().put("ownedStock", 30), "INVALID_FIELD");
    error(engine, scenario().put("metadata", "not an object"), "INVALID_FIELD");
    check(success(engine, "calculate_crafting_profit", scenario().put("metadata", new JSONObject().put("tier", 5))).getString("provenance").equals("manual"), "descriptive metadata does not alter calculations");
    error(engine, scenario().put("focusPerCraft", 1e-100), "LIMIT_EXCEEDED");

    JSONObject low = scenario().put("label", "low").put("outputUnitPrice", 199);
    JSONObject invalid = scenario().put("returnRate", 2);
    JSONObject constrained = scenario().put("budget", 100);
    JSONObject batch = new JSONObject().put("scenarios", new JSONArray().put(low).put(scenario()).put(invalid).put(constrained)).put("ranking", "profit");
    for (String action : new String[]{"find_profitable_crafts", "optimize_refining", "optimize_production_plan", "compare_crafting_routes"}) {
      JSONObject ranked = engine.execute(action, batch);
      check(ranked.getString("status").equals("ok") && ranked.getString("scope").equals("single_scenario_alternatives"), action);
      check(ranked.getJSONArray("results").length() == 2 && ranked.getJSONArray("rejected").length() == 2, "invalid and constrained excluded");
      check(ranked.getJSONArray("results").getJSONObject(0).getInt("inputIndex") == 1, "profit ordering");
    }
    JSONObject noVolume = scenario().put("volumeObserved", JSONObject.NULL).put("volumeDays", JSONObject.NULL);
    JSONObject volumeRank = engine.execute("find_profitable_crafts", new JSONObject().put("scenarios", new JSONArray().put(noVolume).put(scenario())).put("ranking", "liquidity"));
    check(volumeRank.getJSONArray("results").getJSONObject(0).getInt("inputIndex") == 1, "known liquidity before unknown");
    JSONObject loss = scenario().put("outputUnitPrice", 1);
    JSONObject onlyProfit = engine.execute("find_profitable_crafts", new JSONObject().put("scenarios", new JSONArray().put(loss).put(scenario())).put("ranking", "profit"));
    check(onlyProfit.getJSONArray("results").length() == 1 && onlyProfit.getJSONArray("rejected").getJSONObject(0).getString("code").equals("NON_PROFITABLE"), "profit ranking excludes losses");
    JSONObject breakEven = scenario().put("quantity", 1).put("outputPerCraft", 1).put("outputUnitPrice", 100).put("returnRate", 0).put("focusPerCraft", 0).put("stationFeePerCraft", 0).put("salesTaxRate", 0).put("sellOrderFeeRate", 0).put("materials", new JSONArray().put(material("raw", 1, 100, false)));
    JSONObject zeroProfit = engine.execute("find_profitable_crafts", new JSONObject().put("scenarios", new JSONArray().put(breakEven)).put("ranking", "profit"));
    check(zeroProfit.getJSONArray("results").length() == 0 && zeroProfit.getJSONArray("rejected").getJSONObject(0).getString("code").equals("NON_PROFITABLE"), "break-even is not profitable");
    JSONObject compareLoss = engine.execute("optimize_refining", new JSONObject().put("scenarios", new JSONArray().put(loss)).put("ranking", "profit"));
    check(!compareLoss.getJSONArray("results").getJSONObject(0).getBoolean("profitable"), "comparison retains and labels losses");
    JSONObject badRank = engine.execute("find_profitable_crafts", new JSONObject().put("scenarios", new JSONArray().put(scenario())).put("ranking", "madeup"));
    check(badRank.getString("status").equals("error"), "unsupported rank");

    JSONObject chainResult = engine.execute("optimize_production_plan", chain());
    check(chainResult.getString("status").equals("ok") && chainResult.getString("scope").equals("explicit_linear_chain"), chainResult.toString());
    JSONObject cr = chainResult.getJSONObject("result");
    // Independent arithmetic: buy raw 4000 + extra 500; stations 200; listing 100.
    // Final sale 4000 - tax 160 - listing 100 - purchases 4500 - stations 200 = -960 cash.
    // Expected returned raw 10 x 100 = 1000 held, so -960 + 1000 = 40 estimated.
    eq(cr, "externalPurchaseCost", 4500); eq(cr, "stationFees", 200); eq(cr, "sellOrderFee", 100); eq(cr, "salesTax", 160);
    eq(cr, "initialCapitalRequired", 4800); eq(cr, "cashFlowBeforeFinalSale", -4800); eq(cr, "cashProfitIfFinalSale", -960);
    eq(cr, "expectedReturnAssetValueAtInputPrices", 1000); eq(cr, "estimatedProfitIncludingReturns", 40); eq(cr, "focusRequired", 100);
    check(cr.isNull("realizedProfit") && cr.getBoolean("feasible"), "hypothetical sale is not a realized profit");
    JSONObject carried = cr.getJSONArray("steps").getJSONObject(1).getJSONArray("inputs").getJSONObject(0);
    eq(carried, "grossUnits", 10); eq(carried, "internalUnits", 10); eq(carried, "externalUnits", 0);
    JSONObject constrainedChain = chain().put("budget", 4799).put("availableFocus", 99);
    JSONObject constrainedResult = engine.execute("optimize_production_plan", constrainedChain).getJSONObject("result");
    check(!constrainedResult.getBoolean("feasible") && constrainedResult.getJSONArray("violations").length() == 2, "whole-chain limits");
    JSONObject surplus = chain(); surplus.getJSONArray("steps").getJSONObject(1).getJSONObject("scenario").put("quantity", 9);
    check(engine.execute("optimize_production_plan", surplus).getJSONObject("error").getString("code").equals("UNSOLD_INTERMEDIATE"), "ambiguous residual intermediate is rejected");
    JSONObject fractional = chain(); fractional.getJSONArray("steps").getJSONObject(1).getJSONObject("scenario").getJSONArray("materials").getJSONObject(0).put("amountPerCraft", 0.15);
    check(engine.execute("optimize_production_plan", fractional).getJSONObject("error").getString("code").equals("INVALID_FIELD"), "fractional certain stock is rejected");
    JSONObject forward = chain(); forward.getJSONArray("steps").getJSONObject(0).getJSONObject("scenario").getJSONArray("materials").getJSONObject(0).put("itemId", "final");
    check(engine.execute("optimize_production_plan", forward).getJSONObject("error").getString("code").equals("FORWARD_DEPENDENCY"), "future output cannot satisfy earlier input");
    JSONObject three = chain();
    JSONObject middleStep = three.getJSONArray("steps").getJSONObject(1); middleStep.put("outputItemId", "middle2");
    JSONObject middleInput = middleStep.getJSONObject("scenario").getJSONArray("materials").getJSONObject(0); middleInput.put("returnable", true);
    JSONObject finalStep = chainScenario().put("quantity", 10).put("outputPerCraft", 1)
      .put("materials", new JSONArray().put(material("middle2", 2, 200, false)).put(material("intermediate", 1, 200, false)));
    three.getJSONArray("steps").put(chainStep("final", finalStep));
    JSONObject threeResult = engine.execute("optimize_production_plan", three).getJSONObject("result");
    JSONObject returnedButUnavailable = threeResult.getJSONArray("steps").getJSONObject(2).getJSONArray("inputs").getJSONObject(1);
    eq(returnedButUnavailable, "internalUnits", 0); eq(returnedButUnavailable, "externalUnits", 10);
    check(engine.execute("optimize_production_plan", chain().put("ranking", "profit")).getJSONObject("error").getString("code").equals("INVALID_FIELD"), "chain and ranking are exclusive");
    check(engine.execute("optimize_production_plan", chain().put("initialInventory", new JSONObject())).getJSONObject("error").getString("code").equals("INVALID_FIELD"), "unsupported inventory cannot be ignored");

    JSONObject quantityScenario = scenario().put("outputUnitPrice", 101).put("budget", 930).put("availableFocus", 100);
    JSONObject quantityResult = engine.execute("optimize_production_plan", new JSONObject().put("scenario", quantityScenario).put("optimizeQuantity", true));
    JSONObject qr = quantityResult.getJSONObject("result");
    check(quantityResult.getString("scope").equals("single_scenario_quantity") && qr.getInt("requestedQuantity") == 10 && qr.getInt("selectedQuantity") == 1, "930 cannot cover two crafts when listing fee is rounded to 11");
    eq(qr.getJSONObject("scenarioResult"), "initialCapitalRequired", 466);
    check(qr.getJSONArray("limitingFactors").getString(0).equals("insufficient_budget"), "next craft budget reason");
    quantityScenario.put("budget", 931);
    check(engine.execute("optimize_production_plan", new JSONObject().put("scenario", quantityScenario).put("optimizeQuantity", true)).getJSONObject("result").getInt("selectedQuantity") == 2, "931 covers two crafts");
    quantityScenario.put("budget", 465);
    JSONObject none = engine.execute("optimize_production_plan", new JSONObject().put("scenario", quantityScenario).put("optimizeQuantity", true)).getJSONObject("result");
    check(none.getInt("selectedQuantity") == 0 && none.isNull("scenarioResult"), "insufficient minimum budget");
    quantityScenario.put("budget", JSONObject.NULL).put("availableFocus", 17);
    check(engine.execute("optimize_production_plan", new JSONObject().put("scenario", quantityScenario).put("optimizeQuantity", true)).getJSONObject("result").getInt("selectedQuantity") == 3, "focus is a separate constraint");
    quantityScenario.put("availableFocus", JSONObject.NULL);
    check(engine.execute("optimize_production_plan", new JSONObject().put("scenario", quantityScenario).put("optimizeQuantity", true)).getJSONObject("result").getInt("selectedQuantity") == 10, "without limits, retain requested quantity");
    JSONArray excessive = new JSONArray(); for (int i = 0; i < 2001; i++) excessive.put(scenario());
    check(engine.execute("find_profitable_crafts", new JSONObject().put("scenarios", excessive).put("ranking", "profit")).getJSONObject("error").getString("code").equals("LIMIT_EXCEEDED"), "bounded scenarios");
    JSONArray tooManyMaterials = new JSONArray(); for (int i = 0; i < 2000; i++) { JSONObject s = scenario(); JSONArray m = new JSONArray(); for (int j = 0; j < 5; j++) m.put(material("x" + j, 1, 1, false)); s.put("materials", m); tooManyMaterials.put(s); }
    check(engine.execute("find_profitable_crafts", new JSONObject().put("scenarios", tooManyMaterials).put("ranking", "profit")).getJSONObject("error").getString("code").equals("LIMIT_EXCEEDED"), "bounded material rows");
    AtomicInteger checks = new AtomicInteger();
    ProductionEngine cancelled = new ProductionEngine(() -> checks.incrementAndGet() > 4);
    check(cancelled.execute("find_profitable_crafts", batch).getJSONObject("error").getString("code").equals("CANCELLED"), "cooperative cancellation");
    System.out.println("Production engine: 7 actions, independent fee/return calculations, constraints, validation, ranking and cancellation passed.");
  }
}
