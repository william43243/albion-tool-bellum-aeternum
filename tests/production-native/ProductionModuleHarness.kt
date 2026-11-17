import com.albion.market.litert.ProductionModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

private class Capture : Promise {
 private val latch=CountDownLatch(1)
 var value: Any?=null
 override fun resolve(value: Any?) { this.value=value; latch.countDown() }
 fun await(): Any? { check(latch.await(15,TimeUnit.SECONDS)); return value }
}
fun moduleHarness() {
 val module=ProductionModule(ReactApplicationContext())
 val scenario=JSONObject("""{"label":"UI test","quantity":1,"outputPerCraft":1,"materials":[{"itemId":"T4_TEST","amountPerCraft":2,"unitPrice":100,"returnable":true}],"outputUnitPrice":300,"returnRate":0.25,"stationFeePerCraft":10,"focusPerCraft":2,"salesTaxRate":0.04,"sellOrderFeeRate":0.025,"budget":null,"availableFocus":null,"volumeObserved":null,"volumeDays":null}""")
 val done=Capture(); module.execute("calculate_crafting_profit",JSONObject().put("scenario",scenario).toString(),"americas",done)
 check(JSONObject(done.await() as String).getString("status")=="ok")
 val rejected=Capture(); module.execute("calculate_crafting_profit",JSONObject().put("scenario",scenario).toString(),"incorrect-server",rejected)
 check(JSONObject(rejected.await() as String).getJSONObject("error").getString("code")=="INVALID_ARGUMENT")
 val approval=Capture(); module.approveScenario(scenario.toString(),"americas",approval)
 check(JSONObject(approval.await() as String).getString("status")=="ok")
 val weight=Capture()
 module.calculateWeight("""[{"sourceId":"T4_ORE","enchantment":null,"quantity":10}]""",
  """{"schemaVersion":1,"provenance":{"unit":"source_unconfirmed"},"entries":[{"sourceId":"T4_ORE","enchantment":null,"weight":0.51,"origin":"item"}]}""",weight)
 val weighted=JSONObject(weight.await() as String)
 check(weighted.getString("status")=="ok" && kotlin.math.abs(weighted.getDouble("total")-5.1)<1e-9)
 val missing=Capture()
 module.calculateWeight("""[{"sourceId":"UNKNOWN","enchantment":null,"quantity":2}]""",
  """{"schemaVersion":1,"provenance":{"unit":"source_unconfirmed"},"entries":[]}""",missing)
 check(JSONObject(missing.await() as String).isNull("total"))
 val cancel=Capture(); module.cancel(cancel); cancel.await()
 module.invalidate()
 println("PRODUCTION MODULE JVM: background bridge, approval, server and cancellation signal passed")
}
