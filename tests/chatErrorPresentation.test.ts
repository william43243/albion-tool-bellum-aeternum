import test from 'node:test';
import assert from 'node:assert/strict';
import { chatErrorPresentation } from '../components/chat/presentation';

for (const language of ['fr', 'en', 'es']) {
  test(`response/stream failures do not offer an authentication action (${language})`, () => {
    for (const code of ['EMPTY_MODEL_RESPONSE', 'EMPTY_RESPONSE', 'STREAM_INCOMPLETE', 'STREAM_TEXT_CONFLICT', 'STREAM_FINAL_MESSAGE_MISSING', 'SSE_LINE_LIMIT', 'RESPONSE_INCOMPLETE']) {
      const result = chatErrorPresentation(code, language);
      assert.equal(result.kind, 'response', code);
      assert.equal(result.checkSession, false, code);
      assert.ok(result.message.length > 0); assert.ok(result.actionLabel.length > 0);
    }
  });
}
test('model refusal is neither network failure nor a reason to sign in again', () => {
  const result = chatErrorPresentation('MODEL_REFUSAL', 'fr');
  assert.equal(result.kind, 'refusal'); assert.equal(result.checkSession, false);
  assert.match(result.message, /refusé/); assert.match(result.actionLabel, /Reformuler/);
});
test('only recognized session failures offer a read-only session check', () => {
  for (const code of ['SIGN_IN_REQUIRED', 'SESSION_EXPIRED', 'invalid_grant', 'invalid_token', 'HTTP_401']) {
    const result = chatErrorPresentation(code, 'en');
    assert.equal(result.kind, 'session'); assert.equal(result.checkSession, true); assert.equal(result.actionLabel, 'Check session');
  }
  for (const code of ['PLAN_SCOPE_NOT_GRANTED', 'UNKNOWN_TOOL', 'FAST_NOT_CONFIRMED', 'HTTP_500', 'INVALID_REFRESH_RESPONSE']) {
    assert.equal(chatErrorPresentation(code, 'en').checkSession, false);
  }
});
test('network failures offer network advice without changing authorization', () => {
  for (const code of ['SocketTimeoutException', 'UnknownHostException', 'ConnectException', 'SSLHandshakeException', 'NETWORK_ERROR']) {
    const result = chatErrorPresentation(code, 'en');
    assert.equal(result.kind, 'network'); assert.equal(result.checkSession, false); assert.match(result.message, /internet/);
  }
});
