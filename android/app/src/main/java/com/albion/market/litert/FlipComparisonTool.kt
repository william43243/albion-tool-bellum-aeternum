package com.albion.market.litert
import com.google.ai.edge.litertlm.OpenApiTool
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.math.RoundingMode

class FlipComparisonTool(private val prices:OpenApiTool,private val world:WorldMapTools,private val timestamp:(String)->Long):OpenApiTool {
 override fun getToolDescriptionJsonString()="""
 {"name":"compare_flip_routes","description":"Fetch fresh observed prices and compare same-city and inter-city flips with exact app fee arithmetic and real static zone routes. Automatically shows the top three route previews in chat. Use search_item first. origin_city is a market city or any to compare all purchase cities. Only the loaded buy-city to sell-city journey is counted; repositioning to buy is excluded. instant purchase uses sell ask; instant sale uses buy bid. Orders assume a fill at the quoted price, not guaranteed. No book depth or transport time available.","parameters":{"type":"object","properties":{
 "item_id":{"type":"string"},"quality":{"type":"integer","minimum":1,"maximum":5},
 "origin_city":{"type":"string","enum":["any","Caerleon","Bridgewatch","Fort Sterling","Lymhurst","Thetford","Martlock","Brecilien"]},
 "quantity":{"type":"integer","minimum":1,"maximum":100000},"premium":{"type":"boolean"},
 "buy_mode":{"type":"string","enum":["instant","order"]},"sell_mode":{"type":"string","enum":["instant","order"]},
 "max_age_minutes":{"type":"integer","minimum":1,"maximum":1440},
 "sort_by":{"type":"string","enum":["profit","profit_per_transition","distance","least_risk"]},
 "route_policy":{"type":"string","enum":["fewest_transitions","fewest_lethal"]}
 },"required":["item_id","quality","origin_city","quantity","premium","buy_mode","sell_mode","max_age_minutes","sort_by","route_policy"]}}
 """.trimIndent()
 override fun execute(paramsJsonString:String):String=try {
  val p=JSONObject(paramsJsonString)
  fun integer(key:String)=MarketNumeric.exactLong(p.get(key)).also{require(it in 1..100000L)}.toInt()
  val quality=integer("quality").also{require(it in 1..5)}
  val quantity=integer("quantity");val age=integer("max_age_minutes").also{require(it<=1440)}
  require(p.get("premium") is Boolean)
  val premium=p.getBoolean("premium");val buyMode=p.getString("buy_mode");val sellMode=p.getString("sell_mode")
  val origin=p.getString("origin_city");val sort=p.getString("sort_by");val policy=p.getString("route_policy")
  require(policy in setOf("fewest_transitions","fewest_lethal"))
  require(origin=="any"||origin in FlipComparison.CITIES)
  require(buyMode in setOf("instant","order")&&sellMode in setOf("instant","order"))
  require(sort in setOf("profit","profit_per_transition","distance","least_risk"))
  val market=JSONObject(prices.execute(JSONObject().put("item_id",p.getString("item_id")).put("quality",quality).toString()))
  if(market.has("error"))JSONObject().put("error","PRICE_SOURCE_UNAVAILABLE").put("detail",market.optString("error")).toString()
  else {
   val quotes=market.getJSONArray("prices");val now=System.currentTimeMillis()
   val values=(0 until quotes.length()).map{i->val q=quotes.getJSONObject(i)
    FlipComparison.Quote(q.getString("city"),q.optLong("sell"),q.optLong("buy"),if(q.has("sell_date"))timestamp(q.getString("sell_date")) else 0L,if(q.has("buy_date"))timestamp(q.getString("buy_date")) else 0L)
   }
   val routes=mutableMapOf<String,JSONObject>()
   val comparison=FlipComparison.compare(values,origin,quantity,premium,buyMode,sellMode,age,sort,{from,to->
    val r=JSONObject(world.route.execute(JSONObject().put("city_from",from).put("city_to",to).put("policy",policy).toString()))
    if(r.has("error"))null else {routes["$from|$to"]=r;FlipComparison.Route(r.getInt("transitions"),r.getInt("red_zones"),r.getInt("black_zones"),r.getInt("unknown_risk_zones"))}
   },now,true)
   val candidates=JSONArray(comparison.candidates.take(6).mapIndexed{i,c->
    JSONObject().put("rank",i+1).put("buy_city",c.from).put("sell_city",c.to).put("buy_price",c.buyPrice).put("sell_price",c.sellPrice)
     .put("quantity",quantity).put("purchase_total",c.cost).put("gross_revenue",c.revenue).put("buy_setup_fee",c.buyFee).put("sell_setup_fee",c.sellFee).put("sales_tax",c.tax)
     .put("net_profit",c.net).put("profitable",c.net>0).put("net_per_transition",BigDecimal.valueOf(c.net).divide(BigDecimal.valueOf(maxOf(1,c.route.transitions).toLong()),2,RoundingMode.HALF_UP))
     .put("roi_percent",BigDecimal.valueOf(c.net).multiply(BigDecimal.valueOf(100)).divide(BigDecimal.valueOf(c.cost+c.buyFee),2,RoundingMode.HALF_UP))
     .put("buy_observed_at_ms",c.buyAt).put("sell_observed_at_ms",c.sellAt).put("buy_age_minutes",maxOf(0L,now-c.buyAt)/60000).put("sell_age_minutes",maxOf(0L,now-c.sellAt)/60000)
     .put("route",routes["${c.from}|${c.to}"] ?: JSONObject.NULL)
   })
   JSONObject().put("item",market.getString("item")).put("quality",quality).put("quantity",quantity).put("origin_city",origin).put("sort_by",sort).put("route_policy",policy)
    .put("status",if(comparison.candidates.any{it.net>0})"positive_estimates" else if(comparison.candidates.isEmpty())"insufficient_fresh_data_or_routes" else "no_positive_estimate")
    .put("candidates",candidates).put("eligible_count",comparison.candidates.size).put("positive_count",comparison.candidates.count{it.net>0})
    .put("excluded",JSONArray(comparison.excluded.map{JSONObject().put("buy_city",it.from).put("sell_city",it.to).put("reason",it.reason)}))
    .put("observed_prices",quotes).put("source",market.getString("source")).put("fetched_at_ms",market.getLong("fetched_at_ms")).put("compared_at_ms",now)
    .put("assumptions",JSONObject().put("buy_mode",buyMode).put("sell_mode",sellMode).put("premium",premium).put("max_age_minutes",age)
     .put("sales_tax_percent",if(premium)4 else 8).put("order_setup_percent",2.5).put("fee_rounding","ceil_per_total_order").put("fee_basis","same assumptions as app marketplace calculator")
     .put("distance_unit","zone_transitions").put("repositioning_to_purchase_included",false).put("transport_costs_included",false).put("available_quantity_known",false))
    .put("warning","Estimates, not guaranteed executable profit. Public observed quotes may have changed; no order depth, weight, mount speed or fill time. Quantity is hypothetical. Order fills, transport costs and death losses are not modeled. No live kill activity. Route lines are zone connections, not roads. Losing alternatives are explicitly marked; never recommend them as profitable.").toString()
  }
 }catch(e:Exception){JSONObject().put("error","FLIP_COMPARISON_INVALID_OR_UNAVAILABLE").toString()}
}
