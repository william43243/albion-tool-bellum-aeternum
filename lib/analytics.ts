import { Platform } from 'react-native';

// Analytics server URL — web uses relative path, APK uses absolute
const ANALYTICS_URL = Platform.OS === 'web'
  ? '/api/track'
  : 'https://albion-tool-bellum-aeternum.com/api/track';

const APP_VERSION = '2.0.0';
const APP_PLATFORM = Platform.OS; // 'android' | 'web' | 'ios'

function send(endpoint: string, data: Record<string, unknown>): void {
  try {
    const payload = JSON.stringify({
      ...data,
      _version: APP_VERSION,
      _platform: APP_PLATFORM,
    });

    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(ANALYTICS_URL + endpoint, new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(ANALYTICS_URL + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      }).catch(() => {});
    }
  } catch {
    // Silent fail — analytics should never break the app
  }
}

// ─── Page / Screen views ─────────────────────────────────────

export function trackPageView(page: string): void {
  send('/pageview', {
    page: '/app' + (page.startsWith('/') ? page : '/' + page),
    referrer: Platform.OS === 'web' && typeof document !== 'undefined' ? document.referrer : '',
  });
}

// ─── Tool usage (tab switches) ──────────────────────────────

export function trackToolUse(toolName: string): void {
  send('/event', { name: toolName, category: 'tool_use' });
}

// ─── AI Events ──────────────────────────────────────────────

export function trackAIPrompt(modelId: string): void {
  send('/event', { name: 'ai_prompt', category: 'ai', metadata: { model: modelId } });
}

export function trackAIModelDownload(modelId: string): void {
  send('/event', { name: 'ai_model_download', category: 'ai', metadata: { model: modelId } });
}

export function trackAIModelStart(modelId: string): void {
  send('/event', { name: 'ai_model_start', category: 'ai', metadata: { model: modelId } });
}

export function trackAIImageSent(modelId: string): void {
  send('/event', { name: 'ai_image', category: 'ai', metadata: { model: modelId } });
}

// ─── Calculator Events ──────────────────────────────────────

export function trackFlipCalculation(): void {
  send('/event', { name: 'flip_calc', category: 'calculator' });
}

export function trackMarketCalculation(): void {
  send('/event', { name: 'market_calc', category: 'calculator' });
}

export function trackCraftCalculation(): void {
  send('/event', { name: 'craft_calc', category: 'calculator' });
}

export function trackPriceFetch(itemId: string, city: string): void {
  send('/event', { name: 'price_fetch', category: 'api', metadata: { item: itemId, city } });
}

export function trackHistoryFetch(itemId: string): void {
  send('/event', { name: 'history_fetch', category: 'api', metadata: { item: itemId } });
}

// ─── Generic ────────────────────────────────────────────────

export function trackEvent(name: string, category?: string, metadata?: Record<string, unknown>): void {
  send('/event', { name, category: category || null, metadata: metadata || null });
}
