package com.albion.market.siwc;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;

/** Pure-Java protocol guard. No real tokens, credentials, or provider calls. */
public final class AuthCore {
    public static final String MOCK_CLIENT = "oaiapp_mock_local_only";
    public static final String MOCK_CODE = "mock_code_never_exchange";
    public static final class Attempt {
        public final String state = random();
        public final String nonce = random();
        public final String verifier = random();
        public final String challenge = challenge(verifier);
        public final String redirect;
        public final long deadline;
        public final String selectedClient;
        private boolean consumed;
        public Attempt(String uri, long now, String client) {
            if (!uri.matches("http://127\\.0\\.0\\.1:[0-9]+/auth/callback"))
                throw new IllegalArgumentException("Exact IPv4 loopback callback required");
            redirect = uri; deadline = now + 120000; selectedClient = client;
        }
        public synchronized String consume(Map<String,String> query, long now) {
            if (consumed) return "REJECT_REPLAY";
            if (now > deadline) { consumed = true; return "REJECT_EXPIRED"; }
            if (!equal(state, query.get("state"))) return "REJECT_STATE";
            consumed = true;
            if (query.containsKey("error")) return "access_denied".equals(query.get("error")) ? "CANCELLED" : "REJECT_OAUTH_ERROR";
            if (!MOCK_CODE.equals(query.get("code"))) return "REJECT_CODE";
            String issued = query.get("client_id");
            if (selectedClient != null) {
                if (issued != null && !equal(selectedClient, issued)) return "REJECT_CLIENT_MISMATCH";
            } else if (issued == null || !issued.startsWith("oaiapp_") || issued.equals("dynamic_agent_client")) {
                return "REJECT_MISSING_CLIENT";
            }
            return "CALLBACK_ACCEPTED";
        }
        public synchronized void cancel() { consumed = true; }
    }
    public static String random() {
        byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
    public static String challenge(String verifier) {
        try { return Base64.getUrlEncoder().withoutPadding().encodeToString(
            MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII))); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    public static boolean equal(String expected, String supplied) {
        return expected != null && supplied != null && MessageDigest.isEqual(
            expected.getBytes(StandardCharsets.UTF_8), supplied.getBytes(StandardCharsets.UTF_8));
    }
    /** Local fixture only: production MUST verify signed ID token, iss/aud/exp/sub and scopes too. */
    public static String checkMockExchange(Attempt a, String exactRedirect, String presentedVerifier, String fixtureNonce) {
        if (!equal(a.redirect, exactRedirect)) return "REJECT_REDIRECT";
        if (!equal(a.challenge, challenge(presentedVerifier))) return "REJECT_PKCE";
        if (!equal(a.nonce, fixtureNonce)) return "REJECT_NONCE";
        return "SUCCESS_MOCK_ONLY";
    }
}
