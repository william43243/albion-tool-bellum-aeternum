import { Platform } from 'react-native';

const API_BASE = '/api/track';

function send(endpoint: string, data: Record<string, unknown>): void {
  if (Platform.OS !== 'web') return;

  try {
    const payload = JSON.stringify(data);
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(API_BASE + endpoint, new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(API_BASE + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      }).catch(() => {});
    }
  } catch {
    // Silent fail
  }
}

export function trackPageView(page: string): void {
  send('/pageview', {
    page: '/app' + (page.startsWith('/') ? page : '/' + page),
    referrer: typeof document !== 'undefined' ? document.referrer : '',
  });
}

export function trackToolUse(toolName: string): void {
  send('/event', { name: toolName, category: 'tool_use' });
}

export function trackEvent(name: string, category?: string, metadata?: Record<string, unknown>): void {
  send('/event', { name, category: category || null, metadata: metadata || null });
}
