package com.albion.market.siwc;

import android.app.*;

import android.content.*;

import android.content.pm.ServiceInfo;

import android.os.*;

import com.albion.market.MainActivity;

/** Bounded foreground authorization. No network or browser work on application startup. */

public final class SiwcAuthService extends Service {

 private static volatile SiwcAuthService current;

 public static final AuthAttemptGate GATE=new AuthAttemptGate();

 private long operation;

 public static volatile String lastError="";

 private OfficialClient client; private OfficialFlow flow; private volatile boolean finished;

 private final Handler handler=new Handler(Looper.getMainLooper());

 public static boolean active(){return GATE.active();}

 public static void cancelCurrent(){GATE.cancel();SiwcAuthService s=current;if(s!=null)s.finish("OPERATION_CANCELLED");}

 @Override public IBinder onBind(Intent intent){return null;}

 @Override public int onStartCommand(Intent intent,int flags,int id){

  if(Build.VERSION.SDK_INT<26){if(intent!=null)GATE.complete(intent.getLongExtra("operation",-1));lastError="ANDROID_26_REQUIRED";stopSelf();return START_NOT_STICKY;}

  if(intent==null){stopSelf();return START_NOT_STICKY;}

  if(finished){GATE.complete(intent.getLongExtra("operation",-1));lastError="AUTH_RETRY_REQUIRED";stopSelf();return START_NOT_STICKY;}
  if(client!=null)return START_NOT_STICKY;

  operation=intent.getLongExtra("operation",-1);if(!GATE.isCurrent(operation)){stopSelf();return START_NOT_STICKY;}

  current=this;lastError="";

  NotificationManager nm=getSystemService(NotificationManager.class);

  nm.createNotificationChannel(new NotificationChannel("siwc_auth","Connexion ChatGPT",NotificationManager.IMPORTANCE_LOW));

  PendingIntent open=PendingIntent.getActivity(this,7138,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);

  Notification n=new Notification.Builder(this,"siwc_auth").setSmallIcon(android.R.drawable.ic_lock_lock).setContentTitle("Albion Tool").setContentText("Connexion ChatGPT en cours. Revenez dans l’application pour annuler.").setContentIntent(open).setOngoing(true).build();

  if(Build.VERSION.SDK_INT>=34)startForeground(7138,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);else startForeground(7138,n);

  handler.postDelayed(()->finish("AUTH_TIMEOUT"),LoopbackWindow.WORK_MS);

  ResultReceiver receiver=intent.getParcelableExtra("receiver");

  new Thread(()->{

   try{

    synchronized(this){if(finished||!GATE.isCurrent(operation))return;client=new OfficialClient(this,this::event,intent.getBooleanExtra("registrationApproved",false));flow=new OfficialFlow(client,this::event);flow.start();}

    flow.verifyReady();

    handler.post(()->{if(finished||!GATE.isCurrent(operation))return;try{Bundle b=new Bundle();b.putString("url",flow.authorizationUrl());if(receiver==null)throw new IllegalStateException("BROWSER_RECEIVER_MISSING");receiver.send(1,b);}catch(Exception e){finish(OfficialClient.safeFailure(e));}});

   }catch(Exception e){handler.post(()->finish(OfficialClient.safeFailure(e)));}

  },"siwc-auth").start();

  return START_NOT_STICKY;

 }

 private void event(String event){

  if(event.equals("AUTH_COMPLETED"))handler.post(()->finish(""));

  else if(event.startsWith("REAL_FLOW_FAILED")||event.startsWith("REAL_AUTH_TIMEOUT")||event.startsWith("REAL_CALLBACK_REJECTED OWNER_DECLINED"))handler.post(()->finish(event.replace(' ','_')));

 }

 private synchronized void finish(String error){if(finished)return;finished=true;GATE.complete(operation);lastError=error;if(flow!=null)flow.cancel();if(client!=null)client.cancel();handler.removeCallbacksAndMessages(null);stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();if(current==this)current=null;}

 @Override public void onDestroy(){finish("AUTH_INTERRUPTED");super.onDestroy();}

}

