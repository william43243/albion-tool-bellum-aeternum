const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();

// Trust reverse proxy (nginx)
app.set('trust proxy', 1);

// Request size limit
app.use(express.json({ limit: '10kb', strict: true }));

// Rate limiters
const trackingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Database setup
const DB_PATH = process.env.DB_PATH || '/data/analytics.db';
const db = new Database(DB_PATH);
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

// Input validation constants
const MAX_PAGE_LENGTH = 255;
const MAX_NAME_LENGTH = 100;
const MAX_CATEGORY_LENGTH = 50;
const MAX_METADATA_LENGTH = 2048;
const MAX_REFERRER_LENGTH = 512;

// Prepared statements
const insertPageView = db.prepare(
  'INSERT INTO page_views (page, referrer, user_agent, ip) VALUES (?, ?, ?, ?)'
);
const insertEvent = db.prepare(
  'INSERT INTO events (name, category, metadata, ip) VALUES (?, ?, ?, ?)'
);

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

// Track page view
app.post('/api/track/pageview', trackingLimiter, (req, res) => {
  try {
    const { page } = req.body;
    if (!page || typeof page !== 'string' || page.length > MAX_PAGE_LENGTH) {
      return res.status(400).json({ error: 'invalid page' });
    }

    const ip = req.ip || 'unknown';
    const referrer = String(req.body.referrer || req.headers['referer'] || '').slice(0, MAX_REFERRER_LENGTH);
    const userAgent = String(req.headers['user-agent'] || '').slice(0, MAX_REFERRER_LENGTH);

    insertPageView.run(page, referrer, userAgent, ip);
    res.json({ ok: true });
  } catch (err) {
    console.error('pageview error:', err.message);
    res.status(500).json({ error: 'internal error' });
  }
});

// Track event (tool usage, downloads, AI prompts, etc.)
app.post('/api/track/event', trackingLimiter, (req, res) => {
  try {
    const { name, category, metadata, _version, _platform } = req.body;
    if (!name || typeof name !== 'string' || name.length > MAX_NAME_LENGTH) {
      return res.status(400).json({ error: 'invalid name' });
    }
    if (category && (typeof category !== 'string' || category.length > MAX_CATEGORY_LENGTH)) {
      return res.status(400).json({ error: 'invalid category' });
    }

    const ip = req.ip || 'unknown';

    // Merge version/platform into metadata for tracking
    const fullMetadata = { ...(metadata || {}), _version, _platform };
    const metaStr = JSON.stringify(fullMetadata);
    if (metaStr.length > MAX_METADATA_LENGTH) {
      return res.status(400).json({ error: 'metadata too large' });
    }

    insertEvent.run(name, category || null, metaStr, ip);
    res.json({ ok: true });
  } catch (err) {
    console.error('event error:', err.message);
    res.status(500).json({ error: 'internal error' });
  }
});

// Admin stats API
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

function checkAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return next();
  }
  const provided = String(req.query.token || '');
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
      SELECT json_extract(metadata, '$._platform') as platform, COUNT(*) as count
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

// Public stats endpoint (no auth, all-time counters only — for the landing page)
app.get('/api/stats/public', publicLimiter, (req, res) => {
  try {
    const allTimePrompts = db.prepare(
      `SELECT COUNT(*) as count FROM events WHERE name = 'ai_prompt'`
    ).get();
    const allTimeFlips = db.prepare(
      `SELECT COUNT(*) as count FROM events WHERE name = 'flip_calc'`
    ).get();
    const allTimePageViews = db.prepare('SELECT COUNT(*) as count FROM page_views').get();
    const uniqueVisitors = db.prepare('SELECT COUNT(DISTINCT ip) as count FROM page_views').get();
    const aiDownloads = db.prepare(
      `SELECT COUNT(*) as count FROM events WHERE name = 'ai_model_download'`
    ).get();

    res.json({
      ai_prompts: allTimePrompts.count,
      flip_calculations: allTimeFlips.count,
      page_views: allTimePageViews.count,
      unique_visitors: uniqueVisitors.count,
      ai_model_downloads: aiDownloads.count,
    });
  } catch (err) {
    console.error('public stats error:', err.message);
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
// Clients should send X-Current-Version and X-Platform so we can track which
// builds are checking for updates; these are logged as `update_check` events.
app.get('/api/version', publicLimiter, (req, res) => {
  try {
    const row = selectCurrentVersion.get();

    // Audit: log the check (best-effort; don't fail the request if it fails).
    try {
      const clientVersion = String(req.headers['x-current-version'] || '').slice(0, 32);
      const clientPlatform = String(req.headers['x-platform'] || '').slice(0, 16);
      const meta = JSON.stringify({
        current: clientVersion || null,
        platform: clientPlatform || null,
        target: row ? row.version : null,
      });
      if (meta.length <= MAX_METADATA_LENGTH) {
        insertEvent.run('update_check', 'updates', meta, req.ip || 'unknown');
      }
    } catch (logErr) {
      console.error('update_check audit failed:', logErr.message);
    }

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
