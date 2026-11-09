package com.albion.market.alerts

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.*
import com.albion.market.MainActivity
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import com.google.ai.edge.litertlm.OpenApiTool
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream

object PriceAlerts {
 private val lock=Any()
 private val cities=setOf("Caerleon","Bridgewatch","Fort Sterling","Lymhurst","Thetford","Martlock","Brecilien")
 private val bases=mapOf("americas" to "https://west.albion-online-data.com/api/v2/stats", "europe" to "https://europe.albion-online-data.com/api/v2/stats", "asia" to "https://east.albion-online-data.com/api/v2/stats")
 private fun prefs(c:Context)=c.getSharedPreferences("price_alerts_v1",Context.MODE_PRIVATE)
 private fun read(c:Context)=JSONArray(prefs(c).getString("rules","[]") ?: "[]")
 private fun write(c:Context,a:JSONArray) { check(prefs(c).edit().putString("rules",a.toString()).commit()) }
 fun list(c:Context):String=synchronized(lock){read(c).toString()}
 fun base(server:String)=bases[server] ?: error("invalid server")
 fun create(c:Context,base:String,p:JSONObject):JSONObject=synchronized(lock){
   val server=bases.entries.firstOrNull{it.value==base}?.key ?: error("invalid server")
   val id=p.getString("item_id"); require(id.matches(Regex("[A-Za-z0-9_@.-]{1,120}")))
   val catalog=JSONArray(c.assets.open("items-db.json").bufferedReader().use{it.readText()})
   val item=(0 until catalog.length()).map{catalog.getJSONObject(it)}.firstOrNull{it.optString("id")==id} ?: error("unknown item")
   val quality=p.getInt("quality");val city=p.getString("city");val side=p.getString("side");val op=p.getString("operator")
   val threshold=p.getLong("threshold");val age=p.getInt("max_age_minutes")
   require(quality in 1..5 && city in cities && side in setOf("sell","buy") && op in setOf("le","ge","eq") && threshold in 1..Int.MAX_VALUE && age in 0..1440)
   val all=read(c);require(all.length()<200){"alert limit"}
   val rule=JSONObject().put("id",UUID.randomUUID().toString()).put("server",server).put("item_id",id).put("item_name",item.optString("n",id)).put("quality",quality).put("city",city).put("side",side).put("operator",op).put("threshold",threshold).put("max_age_minutes",age).put("status","active").put("last_status","waiting").put("created_at",System.currentTimeMillis())
   all.put(rule);write(c,all);schedule(c);rule
 }
 fun change(c:Context,id:String,action:String):Boolean=synchronized(lock){
   val old=read(c);val next=JSONArray();var found=false
   for(i in 0 until old.length()){val x=old.getJSONObject(i); if(x.optString("id")==id){found=true; if(action=="delete")continue;require(action in setOf("pause","resume"));x.put("status",if(action=="pause")"paused" else "active");x.put("last_status","waiting")};next.put(x)}
   if(found){write(c,next);schedule(c)};found
 }
 fun update(c:Context,id:String, result:JSONObject, notify:Boolean) = synchronized(lock){
   val all=read(c);for(i in 0 until all.length()) {val a=all.getJSONObject(i);if(a.optString("id")==id && a.optString("status")=="active"){
     for(key in result.keys())a.put(key,result.get(key))
     if(notify){ if(notificationsEnabled(c) && send(c,a)){a.put("status","triggered").put("last_status","triggered")}else a.put("last_status","notifications_disabled") }
     write(c,all);break
   }}
 }
 fun notificationsEnabled(c:Context):Boolean {
  if(!NotificationManagerCompat.from(c).areNotificationsEnabled())return false
  if(Build.VERSION.SDK_INT>=33 && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return false
  if(Build.VERSION.SDK_INT>=26){val channel=(c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).getNotificationChannel("market_price_alerts");if(channel!=null && channel.importance==NotificationManager.IMPORTANCE_NONE)return false}
  return true
 }
 private fun send(c:Context,a:JSONObject):Boolean{
   if(Build.VERSION.SDK_INT>=33 && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return false
   return try {
   val nm=c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
   if(Build.VERSION.SDK_INT>=26)nm.createNotificationChannel(NotificationChannel("market_price_alerts","Alertes de prix",NotificationManager.IMPORTANCE_DEFAULT))
   val intent=Intent(c,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
   val pi=PendingIntent.getActivity(c,a.getString("id").hashCode(),intent,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
   val symbol=when(a.getString("operator")){"le"->"≤";"ge"->"≥";else->"="}
   val text="${a.getString("item_name")} · ${a.getString("city")} : ${a.getLong("last_price")} ($symbol ${a.getLong("threshold")})"
   val n=NotificationCompat.Builder(c,"market_price_alerts").setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Albion : alerte de prix").setContentText(text).setStyle(NotificationCompat.BigTextStyle().bigText(text)).setContentIntent(pi).setAutoCancel(true).build()
   NotificationManagerCompat.from(c).notify(a.getString("id").hashCode(),n)
   true
   } catch (_:SecurityException) { false }
 }
 fun schedule(c:Context){
  val wm=WorkManager.getInstance(c);val a=read(c);val any=(0 until a.length()).any{a.getJSONObject(it).optString("status")=="active"}
  if(!any){wm.cancelUniqueWork("price-alerts-periodic");return}
  val req=PeriodicWorkRequestBuilder<PriceAlertWorker>(20,TimeUnit.MINUTES).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
  wm.enqueueUniquePeriodicWork("price-alerts-periodic",ExistingPeriodicWorkPolicy.KEEP,req)
 }
 fun snapshot(c:Context):List<JSONObject> = synchronized(lock){val a=read(c);(0 until a.length()).map{a.getJSONObject(it)}.filter{it.optString("status")=="active"}}
}

class CreatePriceAlertTool(private val context:Context,private val server:String):OpenApiTool {
 override fun getToolDescriptionJsonString()="""{"name":"create_price_alert","description":"Create a user-requested background price alert. Ask for city, price side and comparison if ambiguous. The server comes from app settings. Every alert always requires an observation from today in the device timezone. Older observations cannot be enabled. Checks target 20 minutes, can be delayed, use community prices and notifications need permission.","parameters":{"type":"object","properties":{"item_id":{"type":"string"},"quality":{"type":"integer"},"city":{"type":"string","enum":["Caerleon","Bridgewatch","Fort Sterling","Lymhurst","Thetford","Martlock","Brecilien"]},"side":{"type":"string","enum":["sell","buy"],"description":"sell = lowest sell listing (instant purchase); buy = highest buy order (instant sale)"},"operator":{"type":"string","enum":["le","ge","eq"]},"threshold":{"type":"integer"},"max_age_minutes":{"type":"integer","description":"Today in the device timezone is always required. 0 applies only the today rule; 1-1440 additionally imposes a maximum age and never allows yesterday's data."}},"required":["item_id","quality","city","side","operator","threshold","max_age_minutes"]}}"""
 override fun execute(paramsJsonString:String):String=try{val a=PriceAlerts.create(context,server,JSONObject(paramsJsonString));JSONObject().put("alert",a).put("requires_observation_today",true).put("observation_timezone",TimeZone.getDefault().id).put("notification_permission",PriceAlerts.notificationsEnabled(context)).put("warning","Every alert requires an observation from today in the device timezone; max_age_minutes is an additional restriction and cannot allow older observations. Data supplied by players may be stale or missing; thresholds can be missed between checks. Android background checks target 20 minutes and may be delayed. Enable notifications in Favorites.").toString()}catch(e:Exception){JSONObject().put("error","ALERT_CREATION_FAILED").toString()}
}

class PriceAlertWorker(c:Context,p:WorkerParameters):Worker(c,p){
 companion object { private val runLock=Any() }
 override fun doWork():Result = synchronized(runLock) { runChecks() }
 private fun runChecks():Result {
  val alerts=PriceAlerts.snapshot(applicationContext)
  for((group,rules) in alerts.groupBy{it.getString("server") to it.getInt("quality")}){
   for(chunk in rules.map{it.getString("item_id")}.distinct().chunked(40)){
    val selected=rules.filter{it.getString("item_id") in chunk}
    try {
     fun enc(s:String)=URLEncoder.encode(s,"UTF-8")
     val cities=selected.map{it.getString("city")}.distinct().joinToString(",")
     val url="${PriceAlerts.base(group.first)}/prices/${enc(chunk.joinToString(","))}.json?locations=${enc(cities)}&qualities=${group.second}"
     val conn=(URL(url).openConnection() as HttpURLConnection).apply { instanceFollowRedirects=false }
     val rows=try{conn.connectTimeout=15000;conn.readTimeout=20000;conn.setRequestProperty("Accept-Encoding","gzip");if(conn.responseCode!=200)throw Exception("HTTP_${conn.responseCode}");val stream=if(conn.contentEncoding.equals("gzip",true))GZIPInputStream(conn.inputStream) else conn.inputStream;val bytes=stream.use{val out=java.io.ByteArrayOutputStream();val buf=ByteArray(8192);while(true){val count=it.read(buf);if(count<0)break;require(out.size()+count<=4_000_000);out.write(buf,0,count)};out.toByteArray()};JSONArray(String(bytes,Charsets.UTF_8))}finally{conn.disconnect()}
     val now=System.currentTimeMillis()
     for(a in selected){
      val side=a.getString("side");val row=(0 until rows.length()).map{rows.getJSONObject(it)}.firstOrNull{it.optString("item_id")==a.getString("item_id") && it.optString("city")==a.getString("city") && it.optInt("quality")==a.getInt("quality")}
      val price=row?.optLong(if(side=="sell")"sell_price_min" else "buy_price_max",0) ?: 0
      val time=parseTime(row?.optString(if(side=="sell")"sell_price_min_date" else "buy_price_max_date") ?: "")
      val result=JSONObject().put("last_checked",now)
      if(price<=0 || time<=0 || time>now){result.put("last_status","no_data");PriceAlerts.update(applicationContext,a.getString("id"),result,false);continue}
      result.put("last_price",price).put("observed_at",time)
      val today=Calendar.getInstance();val seen=Calendar.getInstance().apply{timeInMillis=time}
      val sameDay=today.get(Calendar.YEAR)==seen.get(Calendar.YEAR) && today.get(Calendar.DAY_OF_YEAR)==seen.get(Calendar.DAY_OF_YEAR)
      val maxAge=a.getInt("max_age_minutes");val fresh=sameDay && (maxAge==0 || now-time<=maxAge*60000L)
      val hit=PriceAlertMath.eligible(now,time,price,a.getLong("threshold"),maxAge,a.getString("operator"),TimeZone.getDefault())
      result.put("last_status",if(fresh)"checked" else "stale");PriceAlerts.update(applicationContext,a.getString("id"),result,hit)
     }
    } catch(e:Exception){for(a in selected)PriceAlerts.update(applicationContext,a.getString("id"),JSONObject().put("last_checked",System.currentTimeMillis()).put("last_status","api_error"),false)}
   }
  }
  return Result.success()
 }
 private fun parseTime(raw:String):Long {for(pattern in listOf("yyyy-MM-dd'T'HH:mm:ss.SSSXXX","yyyy-MM-dd'T'HH:mm:ssXXX","yyyy-MM-dd'T'HH:mm:ss.SSS","yyyy-MM-dd'T'HH:mm:ss")){val f=SimpleDateFormat(pattern,Locale.US).apply{timeZone=TimeZone.getTimeZone("UTC");isLenient=false};val pos=ParsePosition(0);val d=f.parse(raw,pos);if(d!=null && pos.index==raw.length)return d.time};return 0}
}
class PriceAlertsModule(private val c:ReactApplicationContext):ReactContextBaseJavaModule(c){
 override fun getName()="PriceAlerts"
 @ReactMethod fun list(p:Promise){try{p.resolve(PriceAlerts.list(c))}catch(e:Exception){p.reject("ALERTS",e)}}
 @ReactMethod fun change(id:String,action:String,p:Promise){try{p.resolve(PriceAlerts.change(c,id,action))}catch(e:Exception){p.reject("ALERTS",e)}}
 @ReactMethod fun checkNow(p:Promise){try{val request=OneTimeWorkRequestBuilder<PriceAlertWorker>().setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build();WorkManager.getInstance(c).enqueueUniqueWork("price-alerts-manual",ExistingWorkPolicy.KEEP,request);p.resolve(true)}catch(e:Exception){p.reject("ALERTS",e)}}
 @ReactMethod fun notificationsEnabled(p:Promise){p.resolve(PriceAlerts.notificationsEnabled(c))}
}
class PriceAlertsPackage:ReactPackage{
 override fun createNativeModules(c:ReactApplicationContext):List<NativeModule> = listOf(PriceAlertsModule(c))
 override fun createViewManagers(c:ReactApplicationContext):List<ViewManager<*,*>> = emptyList()
}
