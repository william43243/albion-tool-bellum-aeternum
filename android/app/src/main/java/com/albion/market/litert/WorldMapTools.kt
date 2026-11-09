package com.albion.market.litert
import android.content.Context
import com.google.ai.edge.litertlm.OpenApiTool
import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer
import java.util.Locale

class WorldMapTools(private val context:Context) {
 private val document by lazy {JSONObject(context.assets.open("world-map.local.json").bufferedReader().use{it.readText()})}
 private val rows by lazy {val a=document.getJSONArray("zones");(0 until a.length()).map{a.getJSONObject(it)}}
 private val graph by lazy { WorldRouteGraph(rows.map{z->val e=z.getJSONArray("exits");WorldRouteGraph.Zone(z.getString("id"),z.getString("name"),z.getString("risk"),(0 until e.length()).map{e.getString(it)})}) }
 private fun normalize(s:String)=Normalizer.normalize(s.trim(),Normalizer.Form.NFD).replace(Regex("\\p{M}"),"").lowercase(Locale.ROOT).replace(" ","")
 private fun find(value:String):JSONObject?=rows.find{it.getString("id")==value||normalize(it.getString("name"))==normalize(value)}
 private fun summary(z:JSONObject)=JSONObject().put("id",z.getString("id")).put("name",z.getString("name")).put("risk",z.getString("risk")).put("biome",z.getString("biome"))
 private fun tool(name:String,description:String,properties:JSONObject,run:(JSONObject)->JSONObject)=object:OpenApiTool {
  override fun getToolDescriptionJsonString()=JSONObject().put("name",name).put("description",description).put("parameters",JSONObject().put("type","object").put("properties",properties).put("required",JSONArray(properties.keys().asSequence().toList()))).toString()
  override fun execute(paramsJsonString:String):String=try{run(JSONObject(paramsJsonString)).toString()}catch(e:Exception){JSONObject().put("error","MAP_TOOL_INVALID_OR_UNAVAILABLE").toString()}
 }
 private fun stringField()=JSONObject().put("type","string")
 val search=tool("search_zones","Search mapped Albion zone names. Returns IDs, names and static risks; no live kill activity.",JSONObject().put("query",stringField())){p->
  val q=p.getString("query");require(q.trim().length in 1..120)
  JSONObject().put("zones",JSONArray(rows.filter{normalize(it.getString("name")).contains(normalize(q))||it.getString("id")==q}.take(20).map{summary(it)})).put("source_revision",document.getJSONObject("provenance").getString("revision"))
 }
 val show=tool("show_zone","Show a known zone or city on an interactive map in the conversation. Use when discussing a region or a city-specific price. Resolve names with search_zones if needed.",JSONObject().put("zone",stringField())){p->
  val z=find(p.getString("zone"))?:throw IllegalArgumentException("Unknown zone")
  JSONObject().put("zone",summary(z)).put("map_action",JSONObject().put("type","focus_zone").put("zoneId",z.getString("id"))).put("warning","Static map; coastlines simplified, no current kill activity.")
 }
 val route=tool("get_route","Compute a route using directed static zone exits and show it on the map. fewest_transitions minimizes zone changes; fewest_lethal minimizes red, black or unknown-risk zones then transitions. Not real-time; no safety, walking-distance or travel-time guarantee.",JSONObject().put("city_from",stringField()).put("city_to",stringField()).put("policy",JSONObject().put("type","string").put("enum",JSONArray(listOf("fewest_transitions","fewest_lethal"))))){p->
  val from=find(p.getString("city_from"));val to=find(p.getString("city_to"))
  if(from==null||to==null)JSONObject().put("error","ZONE_NOT_MAPPED").put("warning","Dynamic zones including Brecilien may have no mapped position; no route invented.")
  else {
   val policy=p.optString("policy","fewest_transitions");val ids=graph.route(from.getString("id"),to.getString("id"),policy)
   if(ids.isEmpty())JSONObject().put("error","NO_STATIC_ROUTE").put("warning","No route in this static graph; dynamic portals are excluded.")
   else {val path=ids.map{id->rows.first{it.getString("id")==id}};val red=path.count{it.getString("risk")=="red"};val black=path.count{it.getString("risk")=="black"};val unknown=path.count{it.getString("risk")=="unknown"}
    JSONObject().put("from",summary(from)).put("to",summary(to)).put("path",JSONArray(path.map{summary(it)})).put("transitions",ids.size-1).put("red_zones",red).put("black_zones",black).put("unknown_risk_zones",unknown).put("policy",policy)
     .put("map_action",JSONObject().put("type","plan_route").put("from",from.getString("id")).put("to",to.getString("id")).put("policy",policy))
     .put("source_revision",document.getJSONObject("provenance").getString("revision")).put("scope","static_cluster_exits").put("kill_activity",JSONObject.NULL).put("warning","No safety guarantee. Static snapshot, not live game state. Lines connect zones, not precise paths inside zones. No real-time or historical kill activity available.")
   }
  }
 }
}
