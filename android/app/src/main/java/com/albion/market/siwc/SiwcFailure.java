package com.albion.market.siwc;
import java.io.IOException;
import okhttp3.Response;
import org.json.JSONObject;
/** Structured metadata only: never relay an arbitrary response body containing credentials. */
public final class SiwcFailure extends IOException {
 public final String code, param, requestId, shape; public final int status;
 public SiwcFailure(String c,int s,String p,String id,String sh){super(c);code=c;status=s;param=p;requestId=id;shape=sh;}
 public static SiwcFailure fromResponse(Response r){
  String code="HTTP_"+r.code(),param="",shape="unknown";
  try { JSONObject body=new JSONObject(r.peekBody(32768).string()); JSONObject err=body.optJSONObject("error");
   if(err!=null){shape="error";code=clean(err.optString("code",code),code);param=clean(err.optString("param",""),"");}
   else if(body.opt("error") instanceof String){shape="oauth_error";code=clean(body.getString("error"),code);}
   else if(body.has("detail"))shape="detail";
  }catch(Exception ignored){}
  return new SiwcFailure(code,r.code(),param,clean(r.header("x-request-id",""),""),shape);
 }
 public static String clean(String raw,String fallback){return raw!=null&&(!raw.isEmpty()||fallback.isEmpty())&&raw.matches("[A-Za-z0-9_.:/\\-]{0,200}")?raw:fallback;}
}
