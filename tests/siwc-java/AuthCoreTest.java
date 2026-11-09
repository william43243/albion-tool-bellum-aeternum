import com.albion.market.siwc.AuthCore;
import java.util.*;
public final class AuthCoreTest {
    static int passed;
    static void eq(String name,String expected,String actual){if(!expected.equals(actual))throw new AssertionError(name+": expected "+expected+", got "+actual);System.out.println("PASS "+name);passed++;}
    static AuthCore.Attempt fresh(){return new AuthCore.Attempt("http://127.0.0.1:54321/auth/callback",1000,null);}
    static Map<String,String> callback(AuthCore.Attempt a){Map<String,String> q=new HashMap<>();q.put("state",a.state);q.put("code",AuthCore.MOCK_CODE);q.put("client_id",AuthCore.MOCK_CLIENT);return q;}
    public static void main(String[] args){
        eq("RFC7636 S256 vector","E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",AuthCore.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
        AuthCore.Attempt a=fresh();eq("random lengths","43/43/43",a.state.length()+"/"+a.nonce.length()+"/"+a.verifier.length());
        eq("fresh entropy distinct","true",""+(!a.state.equals(a.nonce)&&!a.state.equals(a.verifier)&&!a.state.equals(fresh().state)));
        eq("valid callback","CALLBACK_ACCEPTED",a.consume(callback(a),2000));
        eq("callback replay rejected","REJECT_REPLAY",a.consume(callback(a),2000));
        a=fresh();Map<String,String> q=callback(a);q.put("state","bad");eq("wrong state rejected","REJECT_STATE",a.consume(q,2000));
        eq("wrong state does not consume valid attempt","CALLBACK_ACCEPTED",a.consume(callback(a),2000));
        a=fresh();q=callback(a);q.remove("state");eq("missing state rejected","REJECT_STATE",a.consume(q,2000));
        a=fresh();q=callback(a);q.put("error","access_denied");eq("denial does not exchange","CANCELLED",a.consume(q,2000));
        a=fresh();q=callback(a);q.put("error","access_denied");q.put("state","bad");eq("denial validates state first","REJECT_STATE",a.consume(q,2000));
        a=fresh();q=callback(a);q.remove("client_id");eq("issued client required","REJECT_MISSING_CLIENT",a.consume(q,2000));
        a=fresh();q=callback(a);q.put("client_id","dynamic_agent_client");eq("entrypoint is not issued client","REJECT_MISSING_CLIENT",a.consume(q,2000));
        a=new AuthCore.Attempt("http://127.0.0.1:54321/auth/callback",1000,AuthCore.MOCK_CLIENT);q=callback(a);q.put("client_id","oaiapp_other");eq("returning client mismatch","REJECT_CLIENT_MISMATCH",a.consume(q,2000));
        a=new AuthCore.Attempt("http://127.0.0.1:54321/auth/callback",1000,AuthCore.MOCK_CLIENT);q=callback(a);q.remove("client_id");eq("returning client retained","CALLBACK_ACCEPTED",a.consume(q,2000));
        a=fresh();eq("expiry","REJECT_EXPIRED",a.consume(callback(a),121001));
        a=fresh();a.cancel();eq("cancelled attempt cannot return","REJECT_REPLAY",a.consume(callback(a),2000));
        a=fresh();eq("mock exchange binding","SUCCESS_MOCK_ONLY",AuthCore.checkMockExchange(a,a.redirect,a.verifier,a.nonce));
        eq("verifier mismatch","REJECT_PKCE",AuthCore.checkMockExchange(a,a.redirect,"bad",a.nonce));
        eq("nonce mismatch","REJECT_NONCE",AuthCore.checkMockExchange(a,a.redirect,a.verifier,"bad"));
        eq("exact redirect including port","REJECT_REDIRECT",AuthCore.checkMockExchange(a,a.redirect.replace("54321","54322"),a.verifier,a.nonce));
        eq("localhost not equivalent","REJECT_REDIRECT",AuthCore.checkMockExchange(a,a.redirect.replace("127.0.0.1","localhost"),a.verifier,a.nonce));
        try{new AuthCore.Attempt("http://localhost:54321/auth/callback",0,null);throw new AssertionError("localhost accepted");}catch(IllegalArgumentException expected){System.out.println("PASS listener URI guard");passed++;}
        System.out.println("ALL "+passed+" TESTS PASSED; no network, tokens or accounts");
    }
}
