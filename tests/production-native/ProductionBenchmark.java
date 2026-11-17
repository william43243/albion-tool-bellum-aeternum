import com.albion.market.litert.ProductionEngine;
import java.util.Arrays;
import org.json.JSONArray;
import org.json.JSONObject;

/** Synthetic CPU benchmark; it does not measure Android UI, network or memory. */
public class ProductionBenchmark {
  public static void main(String[] args) {
    ProductionEngine engine = new ProductionEngine();
    JSONArray samples = new JSONArray();
    for (int i = 0; i < 2000; i++) {
      JSONObject scenario = ProductionEngineTest.scenario().put("label", "synthetic-" + i).put("outputUnitPrice", 300 + i).put("budget", JSONObject.NULL);
      scenario.getJSONArray("materials").put(ProductionEngineTest.material("extra2", 1, 10, false));
      scenario.getJSONArray("materials").put(ProductionEngineTest.material("extra3", 1, 10, false));
      samples.put(scenario);
    }
    JSONObject request = new JSONObject().put("scenarios", samples).put("ranking", "profit");
    for (int i = 0; i < 3; i++) engine.execute("find_profitable_crafts", request);
    double[] elapsed = new double[9];
    for (int run = 0; run < elapsed.length; run++) {
      long start = System.nanoTime();
      JSONObject result = engine.execute("find_profitable_crafts", request);
      ProductionEngineTest.check(result.getJSONArray("results").length() == 2000, "all scenarios processed");
      elapsed[run] = (System.nanoTime() - start) / 1_000_000.0;
    }
    Arrays.sort(elapsed);
    System.gc();
    Runtime runtime = Runtime.getRuntime();
    long before = runtime.totalMemory() - runtime.freeMemory();
    JSONObject result = engine.execute("find_profitable_crafts", request);
    long after = runtime.totalMemory() - runtime.freeMemory();
    ProductionEngineTest.check(result.getJSONArray("results").length() == 2000, "measured result retained");
    System.out.printf("Synthetic benchmark: 2000 scenarios and 8000 material rows in one batch; median %.3f ms (9 iterations); observed JVM heap change %.2f MiB, not peak or Android.%n", elapsed[4], (after - before) / 1048576.0);
  }
}
