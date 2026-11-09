package com.albion.market.siwc;
import android.content.Context;
import android.os.SystemClock;
import com.nimbusds.jwt.JWTClaimsSet;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import okhttp3.*; import java.util.concurrent.TimeUnit;

/** Official public SIWC endpoints only. Never logs URLs, credentials, raw errors or token responses. */
public final class OfficialClient {
 public static final String ISSUER="https://auth.openai.com";
 public static final String AUTHORIZE=ISSUER+"/api/accounts/authorize";
 public static final String TOKEN=ISSUER+"/api/accounts/oauth/token";
 public static final String JWKS=ISSUER+"/.well-known/jwks.json";
 public static final String RESOURCE="https://api.openai.com/v1";
 public interface Reporter { void event(String safeMessage); }
 private final OkHttpClient http=new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).connectTimeout(20,TimeUnit.SECONDS).readTimeout(30,TimeUnit.SECONDS).callTimeout(90,TimeUnit.SECONDS).build(); private final SecureStore store; private final Reporter report; private final boolean allowApprovedSecond; private volatile boolean cancelled; private final OperationFence operationGate=new OperationFence(); private final long workDeadline=SystemClock.elapsedRealtime()+LoopbackWindow.WORK_MS; private final Set<Call> connections=java.util.concurrent.ConcurrentHashMap.newKeySet(); private final java.util.concurrent.atomic.AtomicBoolean cleanupQueued=new java.util.concurrent.atomic.AtomicBoolean();
 public void cancel(){
  operationGate.cancel();cancelled=true;
  if(cleanupQueued.compareAndSet(false,true))NetworkCleanup.execute(()->{
   for(Call c:connections){try{c.cancel();}catch(RuntimeException ignored){}}
   http.connectionPool().evictAll();
  });
 } private void checkActive() throws IOException {if(cancelled||SystemClock.elapsedRealtime()>workDeadline)throw new IOException("OPERATION_CANCELLED");} public void rememberClient(String id){store.rememberClient(id);}
 public OfficialClient(Context c,Reporter r){this(c,r,false);} public OfficialClient(Context c,Reporter r,boolean approvedSecond){store=new SecureStore(c);report=r;allowApprovedSecond=approvedSecond;}
 public static final class Pending {
  public final String state=AuthCore.random(),nonce=AuthCore.random(),verifier=AuthCore.random();
  public final String redirect,host,client,subject;
  public final long deadline;
  public boolean consumed; public volatile boolean cancelled;
  Pending(String r,String h,String c,String sub){this(r,h,c,sub,LoopbackWindow.AUTHORIZATION_MS);} Pending(String r,String h,String c,String sub,long duration){redirect=r;host=h;client=c;subject=sub;deadline=new LoopbackWindow(SystemClock.elapsedRealtime(),duration,0).expiresAt;}
 }
 public Pending prepare(String redirect)throws Exception {
  if(!redirect.matches("http://127\\.0\\.0\\.1:[0-9]+/auth/callback"))throw new SecurityException("REDIRECT_INVALID");
  JSONObject saved=store.load();
  String existing=saved==null?store.recoveryClient():saved.getString("client_id"); if(allowApprovedSecond){if(existing!=null)throw new IllegalStateException("EXISTING_CLIENT_PRESENT");}else if(existing==null)throw new IllegalStateException("EXISTING_CLIENT_ID_REQUIRED"); return new Pending(redirect,store.host(),existing,saved==null?store.recoverySubject():saved.getString("subject"));
 }
 public String authorizationUrl(Pending p)throws Exception {
  Map<String,String> q=new LinkedHashMap<>();q.put("client_id",p.client==null?"dynamic_agent_client":p.client);
  if(p.client==null)q.put("agent_name_hint","Albion Tool");q.put("ext_agent_host_id",p.host);q.put("response_type","code");q.put("redirect_uri",p.redirect);
  q.put("scope","openid profile email offline_access resource.invoke chatgpt.tokens.use.direct");q.put("resource",RESOURCE);q.put("state",p.state);q.put("nonce",p.nonce);q.put("code_challenge_method","S256");q.put("code_challenge",AuthCore.challenge(p.verifier));
  // Deliberately omit id_token_hint to keep ID tokens out of browser URLs and OS intent diagnostics.
  return AUTHORIZE+"?"+form(q);
 }
 public String accept(Pending p,Map<String,String> q)throws Exception {
  synchronized(p){
   if(p.cancelled)throw new SecurityException("OPERATION_CANCELLED"); if(p.consumed)throw new SecurityException("CALLBACK_REPLAY");
   if(SystemClock.elapsedRealtime()>=p.deadline)throw new SecurityException("CALLBACK_EXPIRED");
   if(!AuthCore.equal(p.state,q.get("state")))throw new SecurityException("CALLBACK_STATE");
   p.consumed=true;
  }
  if(q.containsKey("error"))throw new SecurityException("access_denied".equals(q.get("error"))?"OWNER_DECLINED":"OAUTH_CALLBACK_ERROR");
  String client=q.get("client_id");
  if(p.client!=null){if(client!=null&&!AuthCore.equal(client,p.client))throw new SecurityException("CLIENT_MISMATCH");client=p.client;}
  if(client==null||!client.matches("oaiapp_[A-Za-z0-9_-]+"))throw new SecurityException("ISSUED_CLIENT_MISSING");
  String code=q.get("code");if(code==null||code.isEmpty()||code.length()>16384)throw new SecurityException("CODE_INVALID");
  return client;
 }
 public void exchangeAndTest(Pending p,Map<String,String> q,String client) {
  try{
   checkActive(); JSONObject discovery=new JSONObject(get(ISSUER+"/.well-known/openid-configuration",null));
   if(!ISSUER.equals(discovery.optString("issuer"))||!AUTHORIZE.equals(discovery.optString("authorization_endpoint"))||!TOKEN.equals(discovery.optString("token_endpoint"))||!JWKS.equals(discovery.optString("jwks_uri")))throw new SecurityException("DISCOVERY_MISMATCH");
   Map<String,String> body=new LinkedHashMap<>();body.put("grant_type","authorization_code");body.put("client_id",client);body.put("code",q.get("code"));body.put("code_verifier",p.verifier);body.put("redirect_uri",p.redirect);body.put("resource",RESOURCE);
   JSONObject tokens=new JSONObject(post(TOKEN,"application/x-www-form-urlencoded",form(body),null));
   if(!"Bearer".equalsIgnoreCase(tokens.optString("token_type")))throw new SecurityException("TOKEN_TYPE");
   JWTClaimsSet identity=IdentityVerifier.verify(tokens.getString("id_token"),get(JWKS,null),client,p.nonce,System.currentTimeMillis());
   if(p.subject!=null&&!AuthCore.equal(p.subject,identity.getSubject()))throw new SecurityException("ACCOUNT_MISMATCH");
   Set<String> scopes=new HashSet<>(Arrays.asList(tokens.optString("scope","").trim().split("\\s+")));
   
   long expires=tokens.optLong("expires_in",0);if(expires<=0||expires>31536000)throw new SecurityException("TOKEN_EXPIRY_MISSING");
   if(tokens.optString("access_token","").isEmpty())throw new SecurityException("ACCESS_TOKEN_MISSING");
   JSONObject record=new JSONObject().put("issuer",ISSUER).put("subject",identity.getSubject()).put("client_id",client).put("ext_agent_host_id",p.host).put("id_token",tokens.getString("id_token")).put("access_token",tokens.getString("access_token")).put("refresh_token",tokens.optString("refresh_token","")).put("scope",tokens.optString("scope","")).put("expires_at",System.currentTimeMillis()+expires*1000L).put("email",identity.getStringClaim("email"));
   synchronized(SecureStore.LOCK){operationGate.commit(()->{checkActive();store.save(record);});} checkActive(); report.event("REAL_AUTH_VALIDATED signature issuer audience expiry nonce identity verified; Android Keystore encrypted storage OK");
   report.event("AUTH_COMPLETED");
  }catch(Exception e){report.event("REAL_FLOW_FAILED "+safeFailure(e));}
 }
 public Call newCall(String url,String bearer,String method,String type,String body)throws Exception {
  checkActive(); URL target=new URL(url);if(!target.getProtocol().equals("https")||!(target.getHost().equals("auth.openai.com")||target.getHost().equals("api.openai.com"))||target.getPort()!=-1)throw new SecurityException("NETWORK_DESTINATION");
  Request.Builder request=new Request.Builder().url(url).header("Accept","application/json");if(bearer!=null)request.header("Authorization","Bearer "+bearer);
  if(method.equals("POST"))request.post(RequestBody.create(body,MediaType.get(type)));else request.get();
  Call call=http.newCall(request.build());connections.add(call);
  // OkHttp Call.cancel is sticky even before execute(), closing the pre-connect cancellation race.
  if(cancelled||SystemClock.elapsedRealtime()>workDeadline){NetworkCleanup.execute(call::cancel);connections.remove(call);throw new IOException("OPERATION_CANCELLED");}return call;
 }
 private static String read(InputStream in,int max)throws Exception{try(InputStream source=in;ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buf=new byte[4096];int n;while((n=source.read(buf))!=-1){if(out.size()+n>max)throw new IOException("BODY_LIMIT");out.write(buf,0,n);}return out.toString("UTF-8");}}
 public String get(String url,String token)throws Exception{return executeText(newCall(url,token,"GET",null,null),"GET_HTTP_");}
 public String post(String url,String type,String body,String token)throws Exception{return executeText(newCall(url,token,"POST",type,body),"TOKEN_HTTP_");}
 private String executeText(Call call,String label)throws Exception{try(Response response=call.execute()){if(response.code()!=200)throw SiwcFailure.fromResponse(response);if(response.body()==null)throw new IOException("EMPTY_BODY");return read(response.body().byteStream(),2097152);}finally{connections.remove(call);}}
 public static String boundedLine(Reader r,int cap)throws Exception{StringBuilder s=new StringBuilder();int c;while((c=r.read())!=-1){if(c==10)break;if(s.length()>=cap)throw new IOException("SSE_LINE_LIMIT");if(c!=13)s.append((char)c);}return c==-1&&s.length()==0?null:s.toString();}
  public static String form(Map<String,String> q)throws Exception{StringBuilder s=new StringBuilder();for(Map.Entry<String,String> e:q.entrySet()){if(s.length()>0)s.append('&');s.append(URLEncoder.encode(e.getKey(),"UTF-8")).append('=').append(URLEncoder.encode(e.getValue(),"UTF-8"));}return s.toString();}
 public void finished(Call call){connections.remove(call);}
 public static String safeFailure(Exception e){String m=e.getMessage();return m!=null&&m.matches("[A-Z][A-Z0-9_]{0,80}")?m:e.getClass().getSimpleName();}
}



