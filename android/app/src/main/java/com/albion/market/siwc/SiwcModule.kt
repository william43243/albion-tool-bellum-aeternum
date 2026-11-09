package com.albion.market.siwc



import android.app.AlertDialog

import android.content.Intent

import android.net.Uri

import android.os.Bundle

import android.os.Handler

import android.os.Looper

import android.os.ResultReceiver

import android.widget.EditText

import com.facebook.react.bridge.*
import com.facebook.react.common.LifecycleState

import com.facebook.react.modules.core.DeviceEventManagerModule

import org.json.JSONObject

import java.util.concurrent.Executors

import java.util.concurrent.atomic.AtomicBoolean



class SiwcModule(private val context:ReactApplicationContext):ReactContextBaseJavaModule(context) {

    private val engine=SiwcEngine(context)

    private val worker=Executors.newSingleThreadExecutor()

    private val busy=AtomicBoolean(false)

    private val connecting=AtomicBoolean(false)

    private val main=Handler(Looper.getMainLooper())

    override fun getName()="Siwc"

    @ReactMethod fun addListener(name:String) {}

    @ReactMethod fun removeListeners(count:Double) {}

    private fun error(p:Promise,e:Exception){val code=if(e is SiwcFailure)e.code else OfficialClient.safeFailure(e);p.reject(code,code)}

    @ReactMethod fun getSession(p:Promise){worker.execute {try{p.resolve(engine.session().toString())}catch(e:Exception){error(p,e)}}}

    private fun run(p:Promise,action:()->Any){

        if(!busy.compareAndSet(false,true)){p.reject("BUSY","Une opération est déjà en cours.");return}

        engine.prepareOperation()

        worker.execute{try{p.resolve(action())}catch(e:Exception){error(p,e)}finally{busy.set(false)}}

    }

    @ReactMethod fun getModels(p:Promise)=run(p){engine.models().toString()}

    @ReactMethod fun generate(options:String,requestId:String,p:Promise)=run(p){

        try{engine.generate(JSONObject(options)){event ->

            event.put("requestId",requestId)

            context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("siwcEvent",event.toString())

        }}catch(e:Exception){

            val event=JSONObject().put("type","error").put("code",if(e is SiwcFailure)e.code else OfficialClient.safeFailure(e)).put("message","La requête n’a pas abouti.").put("requestId",requestId)

            if(e is SiwcFailure)event.put("httpStatus",e.status).put("param",e.param).put("requestIdProvider",e.requestId).put("bodyShape",e.shape)

            context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("siwcEvent",event.toString());throw e

        }

    }

    @ReactMethod fun cancel(p:Promise){engine.cancel();SiwcAuthService.cancelCurrent();worker.execute { p.resolve(null) }}

    @ReactMethod fun disconnect(p:Promise){engine.cancel();SiwcAuthService.cancelCurrent();worker.execute{try{engine.disconnect();p.resolve(null)}catch(e:Exception){error(p,e)}}}

    @ReactMethod fun connect(p:Promise){

        if(android.os.Build.VERSION.SDK_INT<26){p.reject("ANDROID_26_REQUIRED","Android 8 ou plus récent requis.");return}

        if(busy.get() || SiwcAuthService.active() || !connecting.compareAndSet(false,true)){p.reject("BUSY","Connexion déjà en cours.");return}

        main.post{

            val activity=context.currentActivity

            if(activity==null||activity.isFinishing||context.lifecycleState!=LifecycleState.RESUMED){connecting.set(false);p.reject("FOREGROUND_REQUIRED","Ouvrez Albion Tool pour vous connecter.");return@post}

            val input=EditText(activity).apply{hint="oaiapp_… (identifiant public existant, facultatif)";setSingleLine(true)}

            val saved=SecureStore(context).recoveryClient()

            if(saved!=null)input.setText(saved)

            AlertDialog.Builder(activity).setTitle("Connecter ChatGPT à Albion Tool")

                .setMessage("Autoriser un acc\u00e8s persistant \u00e0 votre compte et \u00e0 votre forfait ChatGPT sur cet appareil ? Les jetons seront chiffr\u00e9s dans Android Keystore. Votre conversation et les r\u00e9sultats des outils Albion seront envoy\u00e9s \u00e0 OpenAI lorsque vous envoyez un message. Une session locale illisible sera r\u00e9initialis\u00e9e. Aucun jeton du prototype n'est import\u00e9. Si vous poss\u00e9dez d\u00e9j\u00e0 un ID public oaiapp_, saisissez-le ci-dessous. Sinon, une nouvelle inscription sera propos\u00e9e. Vous devrez approuver dans le navigateur OpenAI.")

                .setView(input).setNegativeButton("Annuler"){_,_->connecting.set(false);p.reject("OWNER_DECLINED","Connexion annulée.")}

                .setOnCancelListener{connecting.set(false);p.reject("OWNER_DECLINED","Connexion annulée.")}

                .setPositiveButton("Continuer"){_,_->

                    try{

                        val id=input.text.toString().trim()

                        val vault=SecureStore(context)

                        if(saved!=null && id!=saved && vault.recoverySubject()!=null)throw IllegalArgumentException("CLIENT_MISMATCH")

                        try {vault.load()} catch(e:Exception){vault.clearTokens()}

                        if(id.isEmpty() && saved!=null)vault.clearUnverifiedClient()

                        if(id.isNotEmpty())SecureStore(context).rememberClient(id)

                        val operation=SiwcAuthService.GATE.reserve()

                        val receiver=object:ResultReceiver(main){override fun onReceiveResult(code:Int,data:Bundle?){

                            val a=context.currentActivity

                            if(!SiwcAuthService.GATE.isCurrent(operation))return
                            if(code!=1||a==null||a.isFinishing||context.lifecycleState!=LifecycleState.RESUMED){SiwcAuthService.cancelCurrent();return}

                            val url=data?.getString("url")?:return

                            try{a.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(url)))}catch(e:Exception){SiwcAuthService.cancelCurrent()}

                        }}

                        val intent=Intent(context,SiwcAuthService::class.java).putExtra("operation",operation).putExtra("registrationApproved",id.isEmpty()).putExtra("receiver",receiver)

                        activity.startForegroundService(intent);connecting.set(false);p.resolve(null)

                    }catch(e:Exception){SiwcAuthService.cancelCurrent();connecting.set(false);error(p,e)}

                }.show()

        }

    }

    override fun invalidate(){engine.cancel();SiwcAuthService.cancelCurrent();worker.shutdown();super.invalidate()}

}

