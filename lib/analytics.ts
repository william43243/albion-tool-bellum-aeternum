import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { AnalyticsConsentState } from './analyticsConsentState';
import type { AnalyticsConsent, ExplicitAnalyticsConsent } from './analyticsConsentState';

export type { AnalyticsConsent } from './analyticsConsentState';

export const ANALYTICS_CONSENT_KEY = 'albion_analytics_consent';

const ANALYTICS_BASE_URL = 'https://albion-tool-bellum-aeternum.com';
const ALLOWED_METADATA = new Set(['model', 'item', 'city', 'version', 'platform', 'from', 'to', 'target', 'available']);
const consentState = new AnalyticsConsentState(AsyncStorage, ANALYTICS_CONSENT_KEY);
let webConsentSyncInstalled = false;

function installWebConsentSync(): void {
  if (webConsentSyncInstalled || Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.addEventListener('storage', (event) => {
    if (event.key === ANALYTICS_CONSENT_KEY) void consentState.synchronizeFromStorage();
  });
  webConsentSyncInstalled = true;
}

export async function initializeAnalyticsConsent(): Promise<AnalyticsConsent> {
  installWebConsentSync();
  return consentState.initialize();
}

export function getAnalyticsConsent(): AnalyticsConsent {
  return consentState.get();
}

export function captureAnalyticsAuthorization(): number | null {
  return consentState.captureAuthorization();
}

export function isAnalyticsAuthorizationCurrent(generation: number | null): boolean {
  return consentState.isAuthorizationCurrent(generation);
}

export async function setAnalyticsConsent(choice: ExplicitAnalyticsConsent): Promise<void> {
  return consentState.set(choice);
}

function boundedText(value: unknown, max = 80): string | boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string' || value.length === 0 || value.length > max) return undefined;
  return value;
}

function sanitizeMetadata(metadata: Record<string, unknown> = {}): Record<string, string | boolean> {
  const clean: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA.has(key)) continue;
    const bounded = boundedText(value);
    if (bounded !== undefined) clean[key] = bounded;
  }
  const version = boundedText(Application.nativeApplicationVersion || undefined);
  if (version !== undefined) clean.version = version;
  clean.platform = Platform.OS;
  return clean;
}

function send(path: '/api/track/pageview' | '/api/track/event', body: Record<string, unknown>, authorization?: number | null): void {
  const authorized = authorization === undefined
    ? consentState.get() === 'accepted'
    : consentState.isAuthorizationCurrent(authorization);
  if (!authorized) return;
  void fetch(`${ANALYTICS_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

export function trackPageView(page: string): void {
  send('/api/track/pageview', { page });
}

export function trackEvent(name: string, category = 'app', metadata: Record<string, unknown> = {}, authorization?: number | null): void {
  send('/api/track/event', { name, category, metadata: sanitizeMetadata(metadata) }, authorization);
}

export function trackToolUse(toolName: string): void { trackEvent(toolName, 'tool_use'); }
export function trackAIPrompt(modelId: string): void { trackEvent('ai_prompt', 'ai', { model: modelId }); }
export function trackAIModelDownload(modelId: string, authorization?: number | null): void { trackEvent('ai_model_download', 'ai', { model: modelId }, authorization); }
export function trackAIModelStart(modelId: string, authorization?: number | null): void { trackEvent('ai_model_start', 'ai', { model: modelId }, authorization); }
export function trackAIImageSent(modelId: string): void { trackEvent('ai_image_sent', 'ai', { model: modelId }); }
export function trackFlipCalculation(): void { trackEvent('flip_calc', 'calculation'); }
export function trackMarketCalculation(authorization?: number | null): void { trackEvent('market_calc', 'calculation', {}, authorization); }
export function trackCraftCalculation(): void { trackEvent('craft_calc', 'calculation'); }
export function trackPriceFetch(itemId: string, city: string, authorization?: number | null): void { trackEvent('price_fetch', 'market', { item: itemId, city }, authorization); }
export function trackHistoryFetch(itemId: string): void { trackEvent('history_fetch', 'market', { item: itemId }); }
