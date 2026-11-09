import com.albion.market.siwc.*;
import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.*;
import com.nimbusds.jwt.*;
import java.util.*;
import java.security.*;
import java.security.interfaces.RSAPublicKey; import java.security.interfaces.RSAPrivateKey;
public class IdentityVerifierTest {
 static RSAKey key; static String jwks; static int count; static long now=1800000000000L;
 static JWTClaimsSet.Builder claims(){return new JWTClaimsSet.Builder().issuer("https://auth.openai.com").subject("test-subject").audience("oaiapp_test").issueTime(new Date(now)).expirationTime(new Date(now+60000)).claim("nonce","test-nonce");}
 static String token(JWTClaimsSet c)throws Exception{SignedJWT t=new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID("test-key").build(),c);t.sign(new RSASSASigner(key));return t.serialize();}
 static void reject(String name, JWTClaimsSet c,String client,String nonce)throws Exception{try{IdentityVerifier.verify(token(c),jwks,client,nonce,now);throw new AssertionError(name+" accepted");}catch(SecurityException expected){count++;System.out.println("PASS "+name);}}
 public static void main(String[] args)throws Exception{
  KeyPairGenerator g=KeyPairGenerator.getInstance("RSA");g.initialize(2048);KeyPair pair=g.generateKeyPair();key=new RSAKey.Builder((RSAPublicKey)pair.getPublic()).privateKey((RSAPrivateKey)pair.getPrivate()).keyID("test-key").keyUse(KeyUse.SIGNATURE).algorithm(JWSAlgorithm.RS256).build();jwks=new JWKSet(key.toPublicJWK()).toString();
  IdentityVerifier.verify(token(claims().build()),jwks,"oaiapp_test","test-nonce",now);count++;System.out.println("PASS valid signed identity");
  reject("wrong issuer",claims().issuer("https://example.invalid").build(),"oaiapp_test","test-nonce");
  reject("wrong audience",claims().audience("oaiapp_other").build(),"oaiapp_test","test-nonce");
  reject("expired identity",claims().expirationTime(new Date(now-60000)).build(),"oaiapp_test","test-nonce");
  reject("future issue time",claims().issueTime(new Date(now+60000)).build(),"oaiapp_test","test-nonce");
  reject("missing issue time",claims().issueTime(null).build(),"oaiapp_test","test-nonce");
  reject("missing expiry",claims().expirationTime(null).build(),"oaiapp_test","test-nonce");
  reject("missing subject",claims().subject(null).build(),"oaiapp_test","test-nonce");
  reject("nonce mismatch",claims().build(),"oaiapp_test","other-nonce");
  reject("not before",claims().notBeforeTime(new Date(now+60000)).build(),"oaiapp_test","test-nonce");
  reject("multiple audiences without azp",claims().audience(Arrays.asList("oaiapp_test","other")).build(),"oaiapp_test","test-nonce");
  String t=token(claims().build());String[] parts=t.split("\\.");parts[2]=(parts[2].charAt(0)=='A'?"B":"A")+parts[2].substring(1);
  try{IdentityVerifier.verify(String.join(".",parts),jwks,"oaiapp_test","test-nonce",now);throw new AssertionError("signature accepted");}catch(SecurityException expected){count++;System.out.println("PASS invalid signature");}
  System.out.println("ALL "+count+" IDENTITY TESTS PASSED; synthetic keys and claims only");
 }
}

