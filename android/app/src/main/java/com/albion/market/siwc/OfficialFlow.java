package com.albion.market.siwc;
import android.os.SystemClock;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Short-lived device loopback callback. Authorization secrets are never logged. */
public final class OfficialFlow {
 private final ServerSocket server;
 private final OfficialClient client;
 private final OfficialClient.Reporter report;
 private final OfficialClient.Pending pending; private final boolean diagnostic; private final LoopbackWindow window; private final long boundAt=SystemClock.elapsedRealtime(); private volatile boolean expiryReported;
 private volatile boolean closed; private volatile Socket activeSocket;
 private volatile boolean accepted;
 public OfficialFlow(OfficialClient c,OfficialClient.Reporter r)throws Exception{this(c,r,false);}
 public OfficialFlow(OfficialClient c,OfficialClient.Reporter r,boolean localDiagnostic)throws Exception{
  diagnostic=localDiagnostic; client=c;report=r;server=new ServerSocket();server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"),0),4);server.setSoTimeout(1000);
  try{String redirect="http://127.0.0.1:"+server.getLocalPort()+"/auth/callback"; pending=diagnostic?new OfficialClient.Pending(redirect,"local_diagnostic",null,null,20000):client.prepare(redirect);}catch(Exception e){NetworkCleanup.execute(()->{try{server.close();}catch(IOException ignored){}});throw e;}
  long active=diagnostic?20000:LoopbackWindow.AUTHORIZATION_MS; window=new LoopbackWindow(pending.deadline-active,active,diagnostic?10000:LoopbackWindow.GRACE_MS);
 }
 public String authorizationUrl()throws Exception{return diagnostic?pending.redirect+"?diagnostic=local_only":client.authorizationUrl(pending);}
 public void start(){
  report.event((diagnostic?"DIAGNOSTIC_LISTENER_READY":"REAL_LISTENER_READY")+" IPv4 port="+server.getLocalPort()+" path=/auth/callback wait_seconds="+(diagnostic?20:1800)+" grace_seconds="+(diagnostic?10:300));
  new Thread(()->{
   while(!closed){
    if(!accepted){int phase=window.phase(SystemClock.elapsedRealtime());if(phase!=LoopbackWindow.WAITING&&!expiryReported){expiryReported=true;report.event(diagnostic?"DIAGNOSTIC_AUTH_EXPIRED grace still listening":"REAL_AUTH_EXPIRED return is no longer accepted; local explanation remains available for 5 minutes");}if(phase==LoopbackWindow.CLOSED){report.event(diagnostic?"DIAGNOSTIC_WINDOW_FINISHED":"REAL_AUTH_TIMEOUT no automatic restart");close("EXPIRED_GRACE_ENDED");break;}}
    try(Socket s=server.accept()){activeSocket=s;if(closed)continue;s.setSoTimeout(5000);report.event(diagnostic?"DIAGNOSTIC_TCP_ACCEPTED":"REAL_LOOPBACK_TCP_ACCEPTED");handle(s);}
    catch(SocketTimeoutException ignored){}
    catch(Exception e){if(!closed)report.event("REAL_CALLBACK_REJECTED "+OfficialClient.safeFailure(e));}finally{activeSocket=null;}
   }
  },"official-siwc-callback").start();
 }
 private static String line(InputStream in,int limit)throws Exception{ByteArrayOutputStream out=new ByteArrayOutputStream();int b;while((b=in.read())!=-1){if(b=='\n')break;if(out.size()>=limit)throw new IOException("HTTP_LINE_LIMIT");if(b!='\r')out.write(b);}return b==-1&&out.size()==0?null:out.toString("US-ASCII");}
 private void handle(Socket s)throws Exception{
  if(!s.getInetAddress().isLoopbackAddress())return;
  InputStream in=s.getInputStream();String first=line(in,32768);if(first==null)return;
  String[] parts=first.split(" ");if(parts.length!=3||!parts[0].equals("GET")||!parts[1].startsWith("/")){response(s,400,"Requete refusee.",null);return;}
  int size=first.length();String header,host=null;while((header=line(in,8192))!=null&&!header.isEmpty()){size+=header.length();if(size>49152)throw new IOException("HTTP_HEADER_LIMIT");if(header.toLowerCase(Locale.ROOT).startsWith("host:")){if(host!=null)throw new IOException("HTTP_DUPLICATE_HOST");host=header.substring(5).trim();}}
  if(!("127.0.0.1:"+server.getLocalPort()).equals(host)){response(s,400,"Hote refuse.",null);return;}
  URI uri=new URI(parts[1]);if(uri.getRawFragment()!=null||uri.getAuthority()!=null){response(s,400,"URI refusee.",null);return;}
  if(uri.getPath().equals("/health")){response(s,200,"ALBION_SIWC_HEALTH_OK phase="+window.label(SystemClock.elapsedRealtime())+" port="+server.getLocalPort(),null);return;}
  if(uri.getPath().equals("/auth/callback")&&!accepted&&window.phase(SystemClock.elapsedRealtime())!=LoopbackWindow.WAITING){
   response(s,410,"ALBION_SIWC_EXPIRED La tentative a expire. Revenez dans Albion Tool. Aucun code ne sera echange; ne creez pas une nouvelle inscription.",null);
   report.event(diagnostic?"DIAGNOSTIC_LATE_CALLBACK_HTTP_410":"REAL_LATE_CALLBACK_HTTP_410 no exchange");return;
  }
  if(uri.getPath().equals("/auth/result")){
   response(s,200,accepted?"Autorisation recue. Revenez dans Albion Tool avec Retour pour suivre la validation et la reponse de test.":"Aucune autorisation recue.",null);
   if(accepted)close("RESULT_PAGE_DELIVERED");return;
  }
  if(!uri.getPath().equals("/auth/callback")){response(s,404,"Chemin refuse.",null);return;}
  Map<String,String> query=parse(uri.getRawQuery());String issued;
  if(diagnostic){if(query.size()==1&&"local_only".equals(query.get("diagnostic"))){response(s,200,"Test local reussi : Chrome atteint le callback sur ce S22. Aucun compte ni autorisation OpenAI utilise.",null);report.event("DIAGNOSTIC_CALLBACK_ACCEPTED path host query OK; no provider call");}else{response(s,400,"Test local invalide.",null);report.event("DIAGNOSTIC_REJECTED");}return;}
  try{issued=client.accept(pending,query);}catch(Exception e){response(s,400,"Connexion interrompue ou retour invalide. Revenez dans Albion Tool.",null);report.event("REAL_CALLBACK_REJECTED "+OfficialClient.safeFailure(e));if(pending.consumed)close("CALLBACK_CONSUMED");return;}
  accepted=true; client.rememberClient(issued);
  report.event("REAL_CALLBACK_ACCEPTED state and issued client verified; exchanging with official endpoint");
  new Thread(()->client.exchangeAndTest(pending,query,issued),"official-siwc-exchange").start();
  response(s,303,"Retour recu.","/auth/result");
  new Thread(()->{try{Thread.sleep(30000);}catch(InterruptedException ignored){}close("RESULT_GRACE_ENDED");},"official-callback-cleanup").start();
 }
 private void response(Socket s,int status,String message,String location)throws Exception{
  String body="<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body style='font:20px sans-serif;padding:24px;background:#101b28;color:white'><h1>Albion Tool</h1><p>"+message+"</p><p>Aucun jeton n'est affiche dans cette page.</p></body></html>";
  byte[] b=body.getBytes(StandardCharsets.UTF_8);OutputStream out=s.getOutputStream();
  String h="HTTP/1.1 "+status+" "+(status==200?"OK":status==303?"See Other":"Rejected")+"\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: "+b.length+"\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nConnection: close\r\n"+(location==null?"":"Location: "+location+"\r\n")+"\r\n";out.write(h.getBytes(StandardCharsets.US_ASCII));out.write(b);out.flush();
 }
 static Map<String,String> parse(String query)throws Exception{Map<String,String> q=new HashMap<>();if(query==null)return q;for(String pair:query.split("&")){String[] kv=pair.split("=",2);String k=URLDecoder.decode(kv[0],"UTF-8"),v=kv.length==2?URLDecoder.decode(kv[1],"UTF-8"):"";if(q.put(k,v)!=null)throw new SecurityException("DUPLICATE_CALLBACK_PARAMETER");}return q;}
 public void cancel(){pending.cancelled=true;client.cancel();close("SERVICE_STOP_OR_CANCEL");}
 public void close(){close("CLOSED");}
 private synchronized void close(String reason){if(closed)return;closed=true;
  final Socket socket=activeSocket;
  NetworkCleanup.execute(()->{try{server.close();}catch(IOException ignored){}try{if(socket!=null)socket.close();}catch(IOException ignored){}});
  report.event((diagnostic?"DIAGNOSTIC_LISTENER_CLOSED":"REAL_LISTENER_CLOSED")+" port="+server.getLocalPort()+" reason="+reason+" elapsed_ms="+(SystemClock.elapsedRealtime()-boundAt));}
 public boolean readyForBrowser(){return !closed&&!pending.cancelled&&!accepted&&window.phase(SystemClock.elapsedRealtime())==LoopbackWindow.WAITING;}
 public void verifyReady()throws Exception {if(!readyForBrowser())throw new IOException("LISTENER_NOT_WAITING");probe("/health",200,"ALBION_SIWC_HEALTH_OK phase=WAITING");if(!readyForBrowser())throw new IOException("LISTENER_NOT_WAITING");report.event(diagnostic?"DIAGNOSTIC_PREFLIGHT_HEALTH_OK":"REAL_PREFLIGHT_HEALTH_OK before browser");}
 public void verifyExpiredDiagnostic()throws Exception {if(!diagnostic)throw new IllegalStateException("DIAGNOSTIC_ONLY");probe("/health",200,"phase=EXPIRED");probe("/auth/callback?diagnostic=local_only",410,"ALBION_SIWC_EXPIRED");report.event("DIAGNOSTIC_EXPIRED_HEALTH_200_CALLBACK_410");}
 private void probe(String path,int expected,String expectedBody)throws Exception {
  if(closed)throw new IOException("LISTENER_ALREADY_CLOSED");
  try(Socket s=new Socket()){
   s.connect(new InetSocketAddress("127.0.0.1",server.getLocalPort()),2000);s.setSoTimeout(3000);
   s.getOutputStream().write(("GET "+path+" HTTP/1.1\r\nHost: 127.0.0.1:"+server.getLocalPort()+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
   ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buf=new byte[512];int n;
   while((n=s.getInputStream().read(buf))!=-1){if(bytes.size()+n>8192)throw new IOException("HEALTH_SIZE");bytes.write(buf,0,n);}
   String result=bytes.toString("UTF-8");if(!result.startsWith("HTTP/1.1 "+expected+" ")||!result.contains(expectedBody))throw new IOException("HEALTH_RESPONSE_INVALID");
  }
 }
}



