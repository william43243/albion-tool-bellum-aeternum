package com.albion.market.siwc;
import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Base64;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** App-private AES-GCM vault. Key is non-exportable in Android Keystore. Backups disabled. */
public final class SecureStore {
 public static final Object LOCK=new Object();
 private final SharedPreferences prefs;
 private static final String ALIAS="albion_tool_siwc_credential_v1";
 public SecureStore(Context context){prefs=context.getSharedPreferences("official_siwc",Context.MODE_PRIVATE);}
 private SecretKey key() throws Exception {
  KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
  if(!ks.containsAlias(ALIAS)){
   KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
   gen.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());gen.generateKey();
  }
  return (SecretKey)ks.getKey(ALIAS,null);
 }
 public synchronized void save(JSONObject credentials) throws Exception {
  Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key());
  byte[] sealed=c.doFinal(credentials.toString().getBytes(StandardCharsets.UTF_8));
  JSONObject envelope=new JSONObject().put("iv",Base64.getEncoder().encodeToString(c.getIV())).put("ciphertext",Base64.getEncoder().encodeToString(sealed));
  if(!prefs.edit().putString("credential_envelope",envelope.toString()).putString("verified_subject",credentials.optString("subject","")).commit())throw new IllegalStateException("VAULT_WRITE_FAILED");
 }
 public synchronized JSONObject load() throws Exception {
  String raw=prefs.getString("credential_envelope",null);if(raw==null)return null;
  JSONObject envelope=new JSONObject(raw);Cipher c=Cipher.getInstance("AES/GCM/NoPadding");
  c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.getDecoder().decode(envelope.getString("iv"))));
  return new JSONObject(new String(c.doFinal(Base64.getDecoder().decode(envelope.getString("ciphertext"))),StandardCharsets.UTF_8));
 }
 public synchronized void rememberClient(String id){if(!id.matches("oaiapp_[A-Za-z0-9_-]+"))throw new IllegalArgumentException("CLIENT_ID_INVALID");if(!prefs.edit().putString("issued_client_id",id).commit())throw new IllegalStateException("REGISTRATION_WRITE_FAILED");} public String recoveryClient(){return prefs.getString("issued_client_id",null);} public synchronized String host(){String h=prefs.getString("host_id",null);if(h==null){h="urn:uuid:"+java.util.UUID.randomUUID();if(!prefs.edit().putString("host_id",h).commit())throw new IllegalStateException("HOST_WRITE_FAILED");}return h;}
 public synchronized void clearUnverifiedClient(){if(recoverySubject()!=null)throw new IllegalStateException("VERIFIED_CLIENT_PRESENT");if(!prefs.edit().remove("issued_client_id").commit())throw new IllegalStateException("REGISTRATION_WRITE_FAILED");}
 public String recoverySubject(){return prefs.getString("verified_subject",null);}
 public synchronized void clearTokens() throws Exception {
 JSONObject saved;
 try{saved=load();}catch(Exception invalidVault){
  if(!prefs.edit().remove("credential_envelope").commit())throw new IllegalStateException("VAULT_WRITE_FAILED");
  KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);ks.deleteEntry(ALIAS);return;
 }
 if(saved!=null){saved.put("access_token","").put("refresh_token","").put("id_token","").put("expires_at",0);save(saved);}
 }
}
