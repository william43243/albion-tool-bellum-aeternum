const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
app.disable('x-powered-by');

// Trust exactly the container nginx hop. That proxy overwrites
// X-Forwarded-For, so req.ip cannot be selected from a client-supplied chain.
app.set('trust proxy', 1);

// Request size limit
app.use(express.json({ limit: '10kb', strict: true }));

// Rate limiters. Express derives req.ip only from the single trusted container
// proxy; never read forwarding headers directly here.
function clientIpKey(req) {
  return String(req.ip || 'unknown');
}

const trackingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIpKey,
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIpKey,
});

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIpKey,
});

// Database setup
const DB_PATH = process.env.DB_PATH || '/data/analytics.db';
process.umask(0o077);
const db = new Database(DB_PATH);
try {
  fs.chmodSync(DB_PATH, 0o600);
} catch (err) {
  console.error('database permissions warning:', err.message);
}
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS page_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page TEXT NOT NULL,
    referrer TEXT,
    user_agent TEXT,
    ip TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT,
    metadata TEXT,
    ip TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
  );

  -- In-app updater: one row per published APK. Only one row at a time has
  -- is_current=1. Rows are inserted by scripts/publish.js; this server only
  -- reads them in /api/version. Schema must stay in sync with publish.js.
  CREATE TABLE IF NOT EXISTS app_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT NOT NULL UNIQUE,
    version_code INTEGER NOT NULL,
    apk_url TEXT NOT NULL,
    apk_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    signature TEXT NOT NULL,
    release_notes_en TEXT,
    release_notes_fr TEXT,
    min_supported_version TEXT,
    release_date TEXT NOT NULL,
    is_current INTEGER NOT NULL DEFAULT 0,
    published_at DATETIME DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at);
  CREATE INDEX IF NOT EXISTS idx_page_views_page ON page_views(page);
  CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
  CREATE INDEX IF NOT EXISTS idx_events_name ON events(name);
  CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
  CREATE INDEX IF NOT EXISTS idx_app_versions_current ON app_versions(is_current);
`);

// Legacy columns remain for migration compatibility, but new analytics writes
// never populate IP, referrer, or user-agent fields. Continuously de-identify
// old rows and enforce the 90-day maximum.
let retentionHealthy = false;
function runAnalyticsRetentionCleanup() {
  try {
    db.exec(`
      UPDATE page_views SET referrer = NULL, user_agent = NULL, ip = NULL
        WHERE referrer IS NOT NULL OR user_agent IS NOT NULL OR ip IS NOT NULL;
      UPDATE events SET ip = NULL WHERE ip IS NOT NULL;
      DELETE FROM page_views
        WHERE created_at IS NULL OR datetime(created_at) IS NULL
          OR datetime(created_at) != created_at
          OR created_at < datetime('now', '-89 days');
      DELETE FROM events
        WHERE created_at IS NULL OR datetime(created_at) IS NULL
          OR datetime(created_at) != created_at
          OR created_at < datetime('now', '-89 days');
    `);
    retentionHealthy = true;
    return true;
  } catch (err) {
    retentionHealthy = false;
    console.error('analytics retention cleanup failed; will retry on the next interval:', err.message);
    return false;
  }
}
runAnalyticsRetentionCleanup();
const analyticsRetentionTimer = setInterval(runAnalyticsRetentionCleanup, 60 * 60 * 1000);
analyticsRetentionTimer.unref();

// Reads the currently published version row. The columns selected here are
// exactly the ones that were canonicalized+signed by scripts/publish.js —
// they MUST match one-for-one, in name and count, otherwise client-side
// signature verification will fail.
const selectCurrentVersion = db.prepare(`
  SELECT
    version,
    version_code,
    apk_url,
    apk_size AS size,
    sha256,
    signature,
    release_notes_en,
    release_notes_fr,
    min_supported_version,
    release_date
  FROM app_versions
  WHERE is_current = 1
  LIMIT 1
`);

const ALLOWED_PAGES = new Set([
  '/', '/index.html', '/app/', '/cgu.html', '/confidentialite.html',
  '/marketplace', '/crafting', '/flipping', '/history', '/advisor', '/settings',
]);
const ALLOWED_EVENTS = new Set([
  'marketplace', 'crafting', 'flipping', 'history', 'advisor', 'settings',
  'ai_prompt', 'ai_model_download', 'ai_model_start', 'ai_image_sent',
  'flip_calc', 'market_calc', 'craft_calc', 'price_fetch', 'history_fetch', 'apk_download',
  'update_install_success', 'update_check_started', 'update_check_completed', 'update_check_failed',
  'update_download_started', 'update_download_completed', 'update_download_failed', 'update_install_attempted',
]);
const ALLOWED_CATEGORIES = new Set(['app', 'website', 'tool_use', 'ai', 'calculation', 'market', 'updates', 'download']);
const ALLOWED_METADATA = new Set(['model', 'item', 'city', 'version', 'platform', 'from', 'to', 'target', 'available']);
const COMMON_METADATA = ['platform', 'version'];
const EVENT_METADATA = {
  marketplace: COMMON_METADATA, crafting: COMMON_METADATA, flipping: COMMON_METADATA,
  history: COMMON_METADATA, advisor: COMMON_METADATA, settings: COMMON_METADATA,
  ai_prompt: [...COMMON_METADATA, 'model'], ai_model_download: [...COMMON_METADATA, 'model'],
  ai_model_start: [...COMMON_METADATA, 'model'], ai_image_sent: [...COMMON_METADATA, 'model'],
  flip_calc: COMMON_METADATA, market_calc: COMMON_METADATA, craft_calc: COMMON_METADATA,
  price_fetch: [...COMMON_METADATA, 'item', 'city'], history_fetch: [...COMMON_METADATA, 'item'],
  apk_download: COMMON_METADATA,
  update_install_success: [...COMMON_METADATA, 'from', 'to'],
  update_check_started: COMMON_METADATA,
  update_check_completed: [...COMMON_METADATA, 'target', 'available'],
  update_check_failed: COMMON_METADATA,
  update_download_started: [...COMMON_METADATA, 'target'],
  update_download_completed: [...COMMON_METADATA, 'target'],
  update_download_failed: [...COMMON_METADATA, 'target'],
  update_install_attempted: [...COMMON_METADATA, 'target'],
};
const EVENT_CATEGORIES = {
  marketplace: 'tool_use', crafting: 'tool_use', flipping: 'tool_use', history: 'tool_use',
  advisor: 'tool_use', settings: 'tool_use', ai_prompt: 'ai', ai_model_download: 'ai',
  ai_model_start: 'ai', ai_image_sent: 'ai', flip_calc: 'calculation', market_calc: 'calculation',
  craft_calc: 'calculation', price_fetch: 'market', history_fetch: 'market', apk_download: 'download',
  update_install_success: 'updates', update_check_started: 'updates', update_check_completed: 'updates',
  update_check_failed: 'updates', update_download_started: 'updates', update_download_completed: 'updates',
  update_download_failed: 'updates', update_install_attempted: 'updates',
};
const ALLOWED_CITIES = new Set(['Caerleon', 'Bridgewatch', 'Fort Sterling', 'Lymhurst', 'Thetford', 'Martlock', 'Brecilien']);
const ALLOWED_PLATFORMS = new Set(['android', 'ios', 'web']);
const ALLOWED_MODELS = new Set([
  'qwen35-08b', 'qwen25-15b', 'deepseek-r1-15b', 'gemma4-e2b',
  'gemma4-e4b', 'qwen25-7b-web', 'phi35-mini-web', 'llama32-3b-web',
]);
const ITEM_IDENTIFIER = /^T[1-8](?:_[A-Z0-9]+)+(?:@[1-4])?$/;
const VERSION_IDENTIFIER = /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;

const insertPageView = db.prepare('INSERT INTO page_views (page) VALUES (?)');
const insertEvent = db.prepare('INSERT INTO events (name, category, metadata) VALUES (?, ?, ?)');

function hasOnlyKeys(object, allowed) {
  return object && typeof object === 'object' && !Array.isArray(object)
    && Object.keys(object).every((key) => allowed.has(key));
}

function boundedString(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function sanitizeMetadata(eventName, metadata) {
  if (metadata === undefined) return {};
  const eventKeys = new Set(EVENT_METADATA[eventName] || []);
  if (!hasOnlyKeys(metadata, ALLOWED_METADATA) || !hasOnlyKeys(metadata, eventKeys) || Object.keys(metadata).length > 6) return null;
  const clean = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key === 'available') {
      if (typeof value !== 'boolean') return null;
      clean[key] = value;
    } else {
      if (!boundedString(value, 80)) return null;
      if (key === 'city' && !ALLOWED_CITIES.has(value)) return null;
      if (key === 'platform' && !ALLOWED_PLATFORMS.has(value)) return null;
      if (key === 'model' && !ALLOWED_MODELS.has(value)) return null;
      if (key === 'item' && !ITEM_IDENTIFIER.test(value)) return null;
      if (['version', 'from', 'to', 'target'].includes(key) && !VERSION_IDENTIFIER.test(value)) return null;
      clean[key] = value;
    }
  }
  return clean;
}

app.post('/api/track/pageview', trackingLimiter, (req, res) => {
  if (!retentionHealthy) return res.status(503).json({ error: 'analytics retention unavailable' });
  if (!hasOnlyKeys(req.body, new Set(['page'])) || !ALLOWED_PAGES.has(req.body.page)) {
    return res.status(400).json({ error: 'invalid analytics payload' });
  }
  insertPageView.run(req.body.page);
  return res.status(204).end();
});

app.post('/api/track/event', trackingLimiter, (req, res) => {
  if (!retentionHealthy) return res.status(503).json({ error: 'analytics retention unavailable' });
  if (!hasOnlyKeys(req.body, new Set(['name', 'category', 'metadata']))
      || !ALLOWED_EVENTS.has(req.body.name)
      || !ALLOWED_CATEGORIES.has(req.body.category)
      || EVENT_CATEGORIES[req.body.name] !== req.body.category) {
    return res.status(400).json({ error: 'invalid analytics payload' });
  }
  const metadata = sanitizeMetadata(req.body.name, req.body.metadata);
  if (metadata === null) return res.status(400).json({ error: 'invalid analytics metadata' });
  insertEvent.run(req.body.name, req.body.category, JSON.stringify(metadata));
  return res.status(204).end();
});

// Admin stats API
const ADMIN_TOKEN_FILE = process.env.ADMIN_TOKEN_FILE || '/data/admin-token';
let ADMIN_TOKEN = '';
try {
  ADMIN_TOKEN = fs.readFileSync(ADMIN_TOKEN_FILE, 'utf8').trim();
  if (ADMIN_TOKEN.length < 32) {
    throw new Error('admin token must contain at least 32 characters');
  }
} catch (err) {
  ADMIN_TOKEN = '';
  console.error('admin authentication disabled:', err.message);
}

function checkAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({ error: 'admin auth not configured' });
  }
  const auth = String(req.get('authorization') || '');
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
  const provided = String(bearer || '');
  if (provided.length !== ADMIN_TOKEN.length) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(provided, 'utf8'),
      Buffer.from(ADMIN_TOKEN, 'utf8')
    );
    if (!isValid) {
      return res.status(403).json({ error: 'forbidden' });
    }
  } catch {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.set('Cache-Control', 'no-store');
  next();
}

// Overview stats
app.get('/api/stats/overview', adminLimiter, checkAdmin, (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);

    const totalPageViews = db.prepare(
      `SELECT COUNT(*) as count FROM page_views WHERE created_at >= datetime('now', ?)`
    ).get(`-${days} days`);

    const totalEvents = db.prepare(
      `SELECT COUNT(*) as count FROM events WHERE created_at >= datetime('now', ?)`
    ).get(`-${days} days`);

    const uniqueVisitors = db.prepare(
      `SELECT COUNT(DISTINCT ip) as count FROM page_views WHERE created_at >= datetime('now', ?)`
    ).get(`-${days} days`);

    const totalDownloads = db.prepare(
      `SELECT COUNT(*) as count FROM events WHERE name = 'apk_download' AND created_at >= datetime('now', ?)`
    ).get(`-${days} days`);

    const allTimePageViews = db.prepare('SELECT COUNT(*) as count FROM page_views').get();
    const allTimeDownloads = db.prepare(
      `SELECT COUNT(*) as count FROM events WHERE name = 'apk_download'`
    ).get();

    // AI stats
    const aiPrompts = db.prepare(
      `SELECT COUNT(*) as count FROM events WHERE name = 'ai_prompt' AND created_at >= datetime('now', ?)`
    ).get(`-${days} days`);

    const aiModelDownloads = db.prepare(
      `SELECT COUNT(*) as count FROM events WHERE name = 'ai_model_download' AND created_at >= datetime('now', ?)`
    ).get(`-${days} days`);

    const flipCalcs = db.prepare(
      `SELECT COUNT(*) as count FROM events WHERE name = 'flip_calc' AND created_at >= datetime('now', ?)`
    ).get(`-${days} days`);

    // Platform breakdown
    const platformBreakdown = db.prepare(`
      SELECT json_extract(metadata, '$.platform') as platform, COUNT(*) as count
      FROM events
      WHERE created_at >= datetime('now', ?) AND metadata IS NOT NULL
      GROUP BY platform
    `).all(`-${days} days`);

    // All-time AI stats
    const allTimePrompts = db.prepare(
      `SELECT COUNT(*) as count FROM events WHERE name = 'ai_prompt'`
    ).get();
    const allTimeFlips = db.prepare(
      `SELECT COUNT(*) as count FROM events WHERE name = 'flip_calc'`
    ).get();

    res.json({
      period_days: days,
      page_views: totalPageViews.count,
      unique_visitors: uniqueVisitors.count,
      downloads: totalDownloads.count,
      total_events: totalEvents.count,
      ai_prompts: aiPrompts.count,
      ai_model_downloads: aiModelDownloads.count,
      flip_calculations: flipCalcs.count,
      platforms: platformBreakdown,
      all_time: {
        page_views: allTimePageViews.count,
        downloads: allTimeDownloads.count,
        ai_prompts: allTimePrompts.count,
        flip_calculations: allTimeFlips.count,
      },
    });
  } catch (err) {
    console.error('overview error:', err.message);
    res.status(500).json({ error: 'internal error' });
  }
});

// Page views over time
app.get('/api/stats/pageviews', adminLimiter, checkAdmin, (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);

    const daily = db.prepare(`
      SELECT date(created_at) as date, COUNT(*) as views, COUNT(DISTINCT ip) as unique_visitors
      FROM page_views
      WHERE created_at >= datetime('now', ?)
      GROUP BY date(created_at)
      ORDER BY date ASC
    `).all(`-${days} days`);

    const byPage = db.prepare(`
      SELECT page, COUNT(*) as views
      FROM page_views
      WHERE created_at >= datetime('now', ?)
      GROUP BY page
      ORDER BY views DESC
    `).all(`-${days} days`);

    res.json({ daily, by_page: byPage });
  } catch (err) {
    console.error('pageviews error:', err.message);
    res.status(500).json({ error: 'internal error' });
  }
});

// Tool usage stats
app.get('/api/stats/tools', adminLimiter, checkAdmin, (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);

    const toolUsage = db.prepare(`
      SELECT name, COUNT(*) as count
      FROM events
      WHERE category = 'tool_use' AND created_at >= datetime('now', ?)
      GROUP BY name
      ORDER BY count DESC
    `).all(`-${days} days`);

    const allTimeToolUsage = db.prepare(`
      SELECT name, COUNT(*) as count
      FROM events
      WHERE category = 'tool_use'
      GROUP BY name
      ORDER BY count DESC
    `).all();

    const daily = db.prepare(`
      SELECT date(created_at) as date, name, COUNT(*) as count
      FROM events
      WHERE category = 'tool_use' AND created_at >= datetime('now', ?)
      GROUP BY date(created_at), name
      ORDER BY date ASC
    `).all(`-${days} days`);

    res.json({ period: toolUsage, all_time: allTimeToolUsage, daily });
  } catch (err) {
    console.error('tools error:', err.message);
    res.status(500).json({ error: 'internal error' });
  }
});

// Events list
app.get('/api/stats/events', adminLimiter, checkAdmin, (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);

    const events = db.prepare(`
      SELECT name, category, COUNT(*) as count
      FROM events
      WHERE created_at >= datetime('now', ?)
      GROUP BY name, category
      ORDER BY count DESC
    `).all(`-${days} days`);

    const allTimeEvents = db.prepare(`
      SELECT name, category, COUNT(*) as count
      FROM events
      GROUP BY name, category
      ORDER BY count DESC
    `).all();

    res.json({ period: events, all_time: allTimeEvents });
  } catch (err) {
    console.error('events error:', err.message);
    res.status(500).json({ error: 'internal error' });
  }
});

// In-app updater: return the currently published version manifest.
//
// The response includes a detached Ed25519 signature over the canonical JSON
// of the manifest (minus the signature field itself). Clients hardcode the
// public key in lib/updater.ts and MUST verify the signature before trusting
// any field — a compromised server or MITM cannot forge a manifest without
// the private key on /data/signing-private.bin.
//
// Clients may send version/platform headers for compatibility, but this endpoint
// does not log or persist them.
app.get('/api/version', publicLimiter, (_req, res) => {
  try {
    const row = selectCurrentVersion.get();

    if (!row) {
      return res.status(404).json({ error: 'no version published' });
    }

    // Build the response. The `signature` column is renamed to
    // `manifest_signature` in the wire format so the client knows to strip
    // it before re-canonicalizing for verification. Every other field must
    // match the signed manifest byte-for-byte after canonicalization.
    const { signature, ...manifest } = row;
    res.set('Cache-Control', 'no-store');
    res.json({ ...manifest, manifest_signature: signature });
  } catch (err) {
    console.error('version endpoint error:', err.message);
    res.status(500).json({ error: 'internal error' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Analytics server running on port ${PORT}`);
});
