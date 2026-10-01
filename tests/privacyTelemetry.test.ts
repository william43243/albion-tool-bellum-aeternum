import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const mobileAnalytics = readFileSync('lib/analytics.ts', 'utf8');
const siteAnalytics = readFileSync('site/js/analytics.js', 'utf8');
const siteIndex = readFileSync('site/index.html', 'utf8');
const analyticsServer = readFileSync('analytics/server.js', 'utf8');
const privacyPolicy = readFileSync('site/confidentialite.html', 'utf8');

function htmlFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? htmlFiles(path) : entry.name.endsWith('.html') ? [path] : [];
  });
}

test('mobile analytics exports cannot perform network transport', () => {
  for (const forbidden of ['fetch(', 'sendBeacon(', 'XMLHttpRequest', '/api/track']) {
    assert.equal(mobileAnalytics.includes(forbidden), false, `mobile analytics contains ${forbidden}`);
  }
});

test('website ships no analytics transport or auto-loaded tracker', () => {
  assert.equal(siteIndex.includes('/js/analytics.js'), false);
  for (const forbidden of ['sendBeacon(', 'XMLHttpRequest', 'fetch(', '/api/track']) {
    assert.equal(siteAnalytics.includes(forbidden), false, `site analytics contains ${forbidden}`);
  }
});

test('tracking endpoints are retired without persistence', () => {
  assert.match(analyticsServer, /app\.post\('\/api\/track\/pageview',[\s\S]*?res\.status\(410\)\.json\(\{ error: 'analytics disabled' \}\)/);
  assert.match(analyticsServer, /app\.post\('\/api\/track\/event',[\s\S]*?res\.status\(410\)\.json\(\{ error: 'analytics disabled' \}\)/);
  assert.doesNotMatch(analyticsServer, /insertPageView\.run\(/);
  assert.doesNotMatch(analyticsServer, /insertEvent\.run\(/);
});

test('legacy telemetry has no public stats surface', () => {
  assert.doesNotMatch(analyticsServer, /app\.get\(['"]\/api\/stats\/public['"]/);
  assert.doesNotMatch(siteIndex, /Live Stats|live_stats_title|data-target="(?:ai_prompts|flip_calculations|page_views|unique_visitors|ai_model_downloads)"/);
  for (const route of ['overview', 'pageviews', 'tools', 'events']) {
    assert.match(analyticsServer, new RegExp(`app\\.get\\('/api/stats/${route}', adminLimiter, checkAdmin,`));
  }
});

test('legacy telemetry is de-identified and retained for at most 90 days', () => {
  assert.match(analyticsServer, /UPDATE page_views SET ip = NULL/);
  assert.match(analyticsServer, /UPDATE events SET ip = NULL/);
  assert.match(analyticsServer, /DELETE FROM page_views WHERE created_at < datetime\('now', '-90 days'\)/);
  assert.match(analyticsServer, /DELETE FROM events WHERE created_at < datetime\('now', '-90 days'\)/);
});

test('privacy policy accurately states disabled product analytics and legacy retention', () => {
  assert.match(privacyPolicy, /télémétrie produit est désactivée/i);
  assert.match(privacyPolicy, /90 jours/i);
  assert.match(privacyPolicy, /Cloudflare/i);
});

test('website does not disclose visitor metadata to remote font providers', () => {
  for (const path of htmlFiles('site')) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /fonts\.googleapis\.com|fonts\.gstatic\.com/, path);
  }
});

test('legacy retention cleanup repeats while the analytics process remains running', () => {
  assert.match(analyticsServer, /setInterval\(runLegacyRetentionCleanup/);
  assert.match(analyticsServer, /function runLegacyRetentionCleanup\(\)[\s\S]*try \{[\s\S]*db\.exec/);
  assert.match(analyticsServer, /catch \(err\)[\s\S]*will retry on the next interval/);
});
