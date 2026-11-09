package com.albion.market.siwc;
import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.*;
import com.nimbusds.jwt.*;
import java.util.*;

/** Strict OpenID Connect ID-token validator; trusted JWKS supplied only by fixed OpenAI HTTPS endpoint. */
public final class IdentityVerifier {
 public static JWTClaimsSet verifyRefresh(String compact,String jwks,String client,long now) throws Exception { return verifyInternal(compact,jwks,client,null,now,false); }
 public static JWTClaimsSet verify(String compact,String jwks,String client,String nonce,long now) throws Exception { return verifyInternal(compact,jwks,client,nonce,now,true); }
 private static JWTClaimsSet verifyInternal(String compact, String jwksJson, String client, String nonce, long nowMillis, boolean requireNonce) throws Exception {
  if(compact==null || compact.length()>65536)throw new SecurityException("ID_TOKEN_SIZE");
  SignedJWT jwt=SignedJWT.parse(compact);
  if(!JWSAlgorithm.RS256.equals(jwt.getHeader().getAlgorithm()))throw new SecurityException("ID_TOKEN_ALGORITHM");
  if(jwt.getHeader().getCriticalParams()!=null && !jwt.getHeader().getCriticalParams().isEmpty())throw new SecurityException("ID_TOKEN_CRITICAL_HEADER");
  String kid=jwt.getHeader().getKeyID(); if(kid==null || kid.isEmpty())throw new SecurityException("ID_TOKEN_KID");
  JWK key=JWKSet.parse(jwksJson).getKeyByKeyId(kid);
  if(!(key instanceof RSAKey) || (key.getKeyUse()!=null && !KeyUse.SIGNATURE.equals(key.getKeyUse())) || (key.getAlgorithm()!=null && !JWSAlgorithm.RS256.equals(key.getAlgorithm())))throw new SecurityException("ID_TOKEN_KEY");
  if(((RSAKey)key).size()<2048 || !jwt.verify(new RSASSAVerifier((RSAKey)key)))throw new SecurityException("ID_TOKEN_SIGNATURE");
  JWTClaimsSet claims=jwt.getJWTClaimsSet();
  if(!"https://auth.openai.com".equals(claims.getIssuer()))throw new SecurityException("ID_TOKEN_ISSUER");
  if(claims.getAudience()==null || !claims.getAudience().contains(client))throw new SecurityException("ID_TOKEN_AUDIENCE");
  String azp=claims.getStringClaim("azp");
  if((claims.getAudience().size()>1 && azp==null)||(azp!=null&&!client.equals(azp)))throw new SecurityException("ID_TOKEN_AUTHORIZED_PARTY");
  if(claims.getExpirationTime()==null || claims.getExpirationTime().getTime()<=nowMillis-5000)throw new SecurityException("ID_TOKEN_EXPIRED");
  if(claims.getIssueTime()==null || claims.getIssueTime().getTime()>nowMillis+5000)throw new SecurityException("ID_TOKEN_ISSUED_TIME");
  if(claims.getNotBeforeTime()!=null && claims.getNotBeforeTime().getTime()>nowMillis+5000)throw new SecurityException("ID_TOKEN_NOT_BEFORE");
  if(claims.getSubject()==null || claims.getSubject().isEmpty())throw new SecurityException("ID_TOKEN_SUBJECT");
  if(requireNonce && !AuthCore.equal(nonce,claims.getStringClaim("nonce")))throw new SecurityException("ID_TOKEN_NONCE");
  return claims;
 }
}
