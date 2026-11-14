import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalContextHistory, shouldCompactLocalContext } from '../lib/localContext';

test('automatic compaction uses actual known usage and is optional', () => {
  assert.equal(shouldCompactLocalContext({ tokens: 5999, configuredMaxTokens: 8000 }, true), false);
  assert.equal(shouldCompactLocalContext({ tokens: 6000, configuredMaxTokens: 8000 }, true), true);
  assert.equal(shouldCompactLocalContext({ tokens: 24000, configuredMaxTokens: 32000 }, true), true);
  assert.equal(shouldCompactLocalContext({ tokens: 8000, configuredMaxTokens: 8000 }, false), false);
});

test('unknown or invalid native usage never becomes a fabricated percentage', () => {
  for (const usage of [
    { tokens: null, configuredMaxTokens: 8000 },
    { tokens: 6000, configuredMaxTokens: null },
    { tokens: NaN, configuredMaxTokens: 8000 },
    { tokens: Infinity, configuredMaxTokens: 8000 },
    { tokens: -1, configuredMaxTokens: 8000 },
    { tokens: 6000, configuredMaxTokens: 0 },
    { tokens: 6000, configuredMaxTokens: NaN },
  ]) assert.equal(shouldCompactLocalContext(usage, true), false);
});

test('compaction history preserves recent dialogue order and excludes system messages', () => {
  const history = buildLocalContextHistory([
    { role: 'system', content: 'private system instructions' },
    { role: 'user', content: 'First question' },
    { role: 'assistant', content: 'First answer' },
    { role: 'user', content: 'Second question' },
  ]);
  assert.equal(history, 'user: First question\nassistant: First answer\nuser: Second question');
});

test('bounded compaction history retains complete recent turns without crossing the limit', () => {
  const messages = [
    { role: 'user' as const, content: 'Old conversation that should be dropped' },
    { role: 'assistant' as const, content: 'Old answer that should be dropped' },
    { role: 'user' as const, content: 'Recent' },
    { role: 'assistant' as const, content: 'Answer' },
  ];
  const expected = 'user: Recent\nassistant: Answer';
  assert.equal(buildLocalContextHistory(messages, expected.length), expected);
  assert.equal(buildLocalContextHistory(messages, 4), '');
  assert.equal(buildLocalContextHistory([], 100), '');
});

test('tool and unknown roles never enter re-seeded conversational history', () => {
  const messages = [
    { role: 'user', content: 'How much?' },
    { role: 'tool', content: 'call or result payload' },
    { role: 'assistant', content: 'The answer.' },
    { role: 'other', content: 'unknown payload' },
  ] as unknown as Parameters<typeof buildLocalContextHistory>[0];
  assert.equal(buildLocalContextHistory(messages), 'user: How much?\nassistant: The answer.');
});

test('a latest message larger than the history budget keeps its ending and signals truncation', () => {
  const history = buildLocalContextHistory([
    { role: 'user', content: 'older information' },
    { role: 'assistant', content: 'x'.repeat(16000) + 'LAST-FACT' },
  ]);
  assert.ok(history.length <= 12000);
  assert.ok(history.startsWith('assistant: […] '));
  assert.ok(history.endsWith('LAST-FACT'));
  assert.doesNotMatch(history, /older information/);
});
