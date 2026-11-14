import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Android SDK objects cannot run in this Node harness. Verify that the tested
// native safety policy is wired before the risky operation and that its failure
// path quarantines the runtime; device behavior remains a separate QA check.
test('native compaction marks the old cache unsafe before creating a second conversation', () => {
  const source = readFileSync('android/app/src/main/java/com/albion/market/litert/LiteRTModule.kt', 'utf8');
  const start = source.indexOf('fun compactConversation(');
  const end = source.indexOf('\n    @ReactMethod', start);
  assert.ok(start >= 0 && end > start);
  const compaction = source.slice(start, end);
  const mark = compaction.indexOf('compactionSafety.beforeSecondaryConversation()');
  const create = compaction.indexOf('eng.createConversation(', mark);
  assert.ok(mark >= 0 && create > mark);
  const between = compaction.slice(mark, create);
  assert.doesNotMatch(between, /\breturn\b|catch\s*\(/);
  const policy = compaction.indexOf('compactionSafety.failureRequiresReload()');
  const quarantine = compaction.indexOf('quarantineRuntimeUnsafe()', policy);
  const lost = compaction.indexOf('promise.reject("COMPACT_RUNTIME_LOST"', policy);
  assert.ok(policy > create && quarantine > policy && lost > quarantine);
});
