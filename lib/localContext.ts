export interface LocalContextUsage { tokens: number | null; configuredMaxTokens: number | null }

/** No percentage can be trusted when either the count or budget is unknown. */
export function shouldCompactLocalContext(usage: LocalContextUsage, enabled: boolean): boolean {
  const { tokens, configuredMaxTokens } = usage;
  return enabled && typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= 0 &&
    typeof configuredMaxTokens === 'number' && Number.isFinite(configuredMaxTokens) && configuredMaxTokens > 0 &&
    tokens >= configuredMaxTokens * 0.75;
}

/** Recent visible turns only; never replay tool operations or system messages. */
export function buildLocalContextHistory(messages: { role: 'user' | 'assistant' | 'system'; content: string }[], maxChars = 12000): string {
  const selected: string[] = [];
  let length = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if ((message.role !== 'user' && message.role !== 'assistant') || !message.content.trim()) continue;
    const line = `${message.role}: ${message.content}`;
    const added = line.length + (selected.length ? 1 : 0);
    if (length + added > maxChars) {
      // If even the newest message is too large, keep its tail rather than
      // feeding an empty history to compaction. The marker makes loss explicit.
      const prefix = `${message.role}: […] `;
      if (!selected.length && maxChars > prefix.length) {
        selected.push(prefix + message.content.slice(-(maxChars - prefix.length)));
      }
      break;
    }
    selected.unshift(line);
    length += added;
  }
  return selected.join('\n');
}
