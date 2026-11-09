import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mobileAnalytics = readFileSync('lib/analytics.ts', 'utf8');
const mobileConsentState = readFileSync('lib/analyticsConsentState.ts', 'utf8');
const app = readFileSync('App.tsx', 'utf8');
const consentPrompt = readFileSync('components/AnalyticsConsentPrompt.tsx', 'utf8');
const settings = readFileSync('screens/SettingsScreen.tsx', 'utf8');
const flipping = readFileSync('screens/FlippingScreen.tsx', 'utf8');
const marketplace = readFileSync('screens/MarketplaceScreen.tsx', 'utf8');
const advisor = readFileSync('screens/AdvisorScreen.tsx', 'utf8');
const updateSection = readFileSync('components/UpdateSection.tsx', 'utf8');
const i18n = readFileSync('lib/i18n.ts', 'utf8');

test('mobile analytics is consent-gated with one persisted explicit decision', () => {
  assert.match(mobileAnalytics, /albion_analytics_consent/);
  assert.match(mobileConsentState, /accepted/);
  assert.match(mobileConsentState, /refused/);
  assert.match(mobileAnalytics, /AsyncStorage/);
  assert.match(mobileAnalytics, /fetch\(/);
  assert.match(mobileAnalytics, /consentState\.get\(\) === 'accepted'/);
  assert.match(mobileAnalytics, /consentState\.isAuthorizationCurrent\(authorization\)/);
  assert.doesNotMatch(mobileAnalytics, /deviceId|userId|visitorId|UUID|randomUUID/i);
  assert.match(mobileConsentState, /choice === 'refused'[\s\S]*?this\.consent = 'refused'/);
  assert.match(mobileConsentState, /await write;[\s\S]*?if \(generation !== this\.generation\) return;[\s\S]*?choice === 'accepted'/);
  assert.match(mobileConsentState, /writeQueue/);
  assert.match(mobileConsentState, /if \(generation === this\.generation\)/);
  assert.match(mobileConsentState, /removeItem/);
  assert.match(mobileConsentState, /captureAuthorization/);
  assert.match(mobileConsentState, /isAuthorizationCurrent/);
  assert.match(flipping, /captureAnalyticsAuthorization/);
  assert.match(flipping, /isAnalyticsAuthorizationCurrent/);
  for (const source of [marketplace, advisor, updateSection]) {
    assert.match(source, /captureAnalyticsAuthorization/);
  }
  assert.doesNotMatch(updateSection, /trackEvent\('update_[^']+_failed'[\s\S]{0,180}\berror\s*:/);
  assert.match(mobileAnalytics, /window\.addEventListener\('storage'/);
  assert.match(mobileConsentState, /synchronizeFromStorage/);
});

test('mobile asks once on first launch and exposes settings revocation in FR EN ES', () => {
  assert.match(app, /AnalyticsConsent/);
  assert.match(app, /Alert\.alert/);
  assert.match(app, /!analyticsLoaded/);
  assert.match(consentPrompt, /analyticsConsentPrompt/);
  assert.match(settings, /analyticsConsent/);
  assert.match(settings, /onAnalyticsConsentChange/);
  assert.match(settings, /disabled=\{analyticsConsent === 'accepted'\}/);
  assert.match(settings, /disabled=\{analyticsConsent !== 'accepted'\}/);
  assert.match(settings, /accessibilityState/);
  assert.match(consentPrompt, /accessibilityViewIsModal/);
  for (const key of ['analyticsConsentPrompt', 'analyticsAccept', 'analyticsRefuse', 'analyticsEnabled', 'analyticsDisabled']) {
    assert.equal((i18n.match(new RegExp(`${key}:`, 'g')) || []).length, 3, `${key} must be translated in FR/EN/ES`);
  }
});

test('analytics clients contain no prompt or image contents and only bounded metadata fields', () => {
  assert.doesNotMatch(mobileAnalytics, /promptText|imagePath|imageData|messageContent/);
  assert.match(mobileAnalytics, /model/);
  assert.match(mobileAnalytics, /item/);
  assert.match(mobileAnalytics, /city/);
  assert.match(mobileAnalytics, /version/);
  assert.match(mobileAnalytics, /platform/);
});
