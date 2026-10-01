import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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
const siteAnalytics = readFileSync('site/js/analytics.js', 'utf8');
const siteIndex = readFileSync('site/index.html', 'utf8');
const siteTerms = readFileSync('site/cgu.html', 'utf8');
const analyticsServer = readFileSync('analytics/server.js', 'utf8');
const privacyPolicy = readFileSync('site/confidentialite.html', 'utf8');

function htmlFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? htmlFiles(path) : entry.name.endsWith('.html') ? [path] : [];
  });
}

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

test('website asks once with external accessible UI and rejects malformed saved consent', () => {
  assert.match(siteIndex, /id="analyticsConsent"/);
  assert.match(siteIndex, /id="analyticsAccept"/);
  assert.match(siteIndex, /id="analyticsRefuse"/);
  assert.match(siteIndex, /aria-labelledby="analyticsConsentTitle"/);
  assert.match(siteIndex, /\/assets\/analytics-consent\.css/);
  assert.match(siteIndex, /\/js\/analytics\.js/);
  assert.match(siteAnalytics, /albion_analytics_consent/);
  assert.match(siteAnalytics, /choice === 'accepted' \|\| choice === 'refused'/);
  assert.match(siteAnalytics, /localStorage\.setItem/);
  assert.match(siteAnalytics, /localStorage\.removeItem/);
  assert.match(siteAnalytics, /addEventListener\('keydown'/);
  assert.match(siteAnalytics, /event\.key !== 'Tab'/);
  assert.match(siteAnalytics, /consent = readConsent\(\)/);
  assert.match(siteAnalytics, /sendBeacon\(|fetch\(/);
  assert.match(siteAnalytics, /if \(consent !== 'accepted'\) return/);
  assert.match(siteAnalytics, /previous !== 'accepted' && choice === 'accepted'/);
  assert.match(siteAnalytics, /\.focus\(\)/);
  assert.match(siteIndex, /data-i18n="analytics_consent_title"/);
  assert.doesNotMatch(siteIndex, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(siteIndex, /<style(?:\s[^>]*)?>/i);
});

test('every public website entry path exposes consent and revocation controls', () => {
  for (const [path, html] of [
    ['index.html', siteIndex],
    ['cgu.html', siteTerms],
    ['confidentialite.html', privacyPolicy],
  ] as const) {
    assert.match(html, /id="analyticsConsent"/, path);
    assert.match(html, /id="analyticsAccept"/, path);
    assert.match(html, /id="analyticsRefuse"/, path);
    assert.match(html, /id="analyticsSettings"/, path);
    assert.match(html, /\/assets\/analytics-consent\.css/, path);
    assert.match(html, /\/js\/analytics\.js/, path);
  }
});

test('backend accepts only bounded allowlisted aggregate analytics and persists no IP or user-agent', () => {
  assert.match(analyticsServer, /ALLOWED_EVENTS/);
  assert.match(analyticsServer, /ALLOWED_CATEGORIES/);
  assert.match(analyticsServer, /ALLOWED_METADATA/);
  assert.match(analyticsServer, /EVENT_METADATA/);
  assert.match(analyticsServer, /'\/cgu\.html'/);
  assert.match(analyticsServer, /'\/confidentialite\.html'/);
  assert.match(analyticsServer, /'\/index\.html'/);
  assert.match(analyticsServer, /ALLOWED_MODELS/);
  assert.match(analyticsServer, /ITEM_IDENTIFIER/);
  assert.match(analyticsServer, /VERSION_IDENTIFIER/);
  assert.doesNotMatch(analyticsServer, /SAFE_IDENTIFIER/);
  assert.match(analyticsServer, /insertPageView\.run\(/);
  assert.match(analyticsServer, /insertEvent\.run\(/);
  assert.doesNotMatch(analyticsServer, /insertPageView\.run\([^)]*(?:req\.ip|user-agent)/s);
  assert.doesNotMatch(analyticsServer, /insertEvent\.run\([^)]*(?:req\.ip|user-agent)/s);
  assert.match(analyticsServer, /res\.status\(204\)\.end\(\)/);
  assert.match(analyticsServer, /UPDATE page_views SET referrer = NULL, user_agent = NULL, ip = NULL/);
  assert.match(analyticsServer, /DELETE FROM page_views[\s\S]*?created_at IS NULL[\s\S]*?datetime\(created_at\) IS NULL[\s\S]*?datetime\(created_at\) != created_at[\s\S]*?created_at < datetime\('now', '-89 days'\)/);
  assert.match(analyticsServer, /DELETE FROM events[\s\S]*?created_at IS NULL[\s\S]*?datetime\(created_at\) IS NULL[\s\S]*?datetime\(created_at\) != created_at[\s\S]*?created_at < datetime\('now', '-89 days'\)/);
});

test('backend fails closed when retention cleanup is unhealthy', () => {
  assert.match(analyticsServer, /retentionHealthy/);
  assert.match(analyticsServer, /if \(!retentionHealthy\)[\s\S]*?status\(503\)/);
});

test('analytics clients contain no prompt or image contents and only bounded metadata fields', () => {
  assert.doesNotMatch(mobileAnalytics, /promptText|imagePath|imageData|messageContent/);
  assert.match(mobileAnalytics, /model/);
  assert.match(mobileAnalytics, /item/);
  assert.match(mobileAnalytics, /city/);
  assert.match(mobileAnalytics, /version/);
  assert.match(mobileAnalytics, /platform/);
  assert.match(siteAnalytics, /metadata/);
});

test('privacy policy accurately describes opt-in analytics, revocation, retention and infrastructure logs', () => {
  assert.match(privacyPolicy, /consentement/i);
  assert.match(privacyPolicy, /refuser/i);
  assert.match(privacyPolicy, /retirer/i);
  assert.match(privacyPolicy, /90 jours/i);
  assert.match(privacyPolicy, /adresse IP[^<]*(?:n'est pas|ne sont pas|jamais)/i);
  assert.match(privacyPolicy, /agent utilisateur[^<]*(?:n'est pas|ne sont pas|jamais)/i);
  assert.match(privacyPolicy, /Cloudflare/i);
  assert.match(privacyPolicy, /GitHub/i);
  assert.match(privacyPolicy, /Hugging Face/i);
  assert.match(privacyPolicy, /huggingface\.co\/mlc-ai/i);
  assert.match(privacyPolicy, /raw\.githubusercontent\.com/i);
  assert.match(privacyPolicy, /serveur d'origine/i);
  assert.match(privacyPolicy, /3 fichiers[^<]*10 Mo/i);
  assert.match(privacyPolicy, /journaux techniques/i);
  assert.match(privacyPolicy, /événements individuels/i);
  assert.match(privacyPolicy, /horodatage/i);
  assert.match(privacyPolicy, /téléchargement de l'APK/i);
  assert.match(privacyPolicy, /incident technique[^<]*retarder/i);
});

test('website does not disclose visitor metadata to remote font providers', () => {
  for (const path of htmlFiles('site')) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /fonts\.googleapis\.com|fonts\.gstatic\.com/, path);
  }
});

test('retention cleanup repeats while the analytics process remains running', () => {
  assert.match(analyticsServer, /setInterval\(runAnalyticsRetentionCleanup/);
  assert.match(analyticsServer, /function runAnalyticsRetentionCleanup\(\)[\s\S]*try \{[\s\S]*db\.exec/);
  assert.match(analyticsServer, /catch \(err\)[\s\S]*will retry on the next interval/);
});
