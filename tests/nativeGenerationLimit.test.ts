import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const native = readFileSync('android/app/src/main/java/com/albion/market/litert/LiteRTModule.kt', 'utf8');
const screen = readFileSync('screens/AdvisorScreen.tsx', 'utf8');

test('every native conversation config sets the supported 256-token output bound', () => {
  assert.match(native, /MAX_OUTPUT_TOKENS = 256\b/);
  const configs = [...native.matchAll(/val convConfig = ConversationConfig\(([\s\S]*?)\n\s*\)/g)];
  assert.equal(configs.length, 2, 'initialization/fallback and reset');
  for (const config of configs) assert.match(config[1], /maxOutputToken = MAX_OUTPUT_TOKENS/);
  assert.match(native, /fallbackEngine\.createConversation\(convConfig\)/);
  assert.match(native, /putInt\("maxOutputTokens", MAX_OUTPUT_TOKENS\)/);
});

test('time bound and native cancellation remain, independently of output token limits', () => {
  assert.match(native, /CONVERSATION_TIMEOUT_MS = 120_000L/);
  assert.match(native, /withTimeout\(CONVERSATION_TIMEOUT_MS\) \{ binding\.completion\.await\(\) \}/);
  assert.match(native, /cancelRegisteredInference\(binding\)/);
  assert.match(screen, /onPress=\{handleStop\}/);
  const interruption = screen.slice(screen.indexOf('const interruptStream ='), screen.indexOf('const sendToLLM ='));
  assert.ok(interruption.indexOf('advisorSession.invalidate()') < interruption.indexOf('cleanup?.()'));
  assert.match(interruption, /await resetNativeConversation\(\)/);
  assert.match(interruption, /streamTextRef\.current/);
});
