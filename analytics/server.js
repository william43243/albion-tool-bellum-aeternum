const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
app.use(express.json());

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

  CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at);
  CREATE INDEX IF NOT EXISTS idx_page_views_page ON page_views(page);
  CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
  CREATE INDEX IF NOT EXISTS idx_events_name ON events(name);
  CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
`);

// Prepared statements
const insertPageView = db.prepare(
  'INSERT INTO page_views (page, referrer, user_agent, ip) VALUES (?, ?, ?, ?)'
);
const insertEvent = db.prepare(
  'INSERT INTO events (name, category, metadata, ip) VALUES (?, ?, ?, ?)'
);

// Track page view
app.post('/api/track/pageview', (req, res) => {
  const { page } = req.body;
  if (!page) return res.status(400).json({ error: 'page required' });

  const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  const referrer = req.body.referrer || req.headers['referer'] || '';
  const userAgent = req.headers['user-agent'] || '';

  insertPageView.run(page, referrer, userAgent, ip);
  res.json({ ok: true });
});

// Track event (tool usage, downloads, AI prompts, etc.)
app.post('/api/track/event', (req, res) => {
  const { name, category, metadata, _version, _platform } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';

  // Merge version/platform into metadata for tracking
  const fullMetadata = { ...(metadata || {}), _version, _platform };

  insertEvent.run(
    name,
    category || null,
    JSON.stringify(fullMetadata),
    ip
  );
  res.json({ ok: true });
});

// Admin stats API
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

function checkAdmin(req, res, next) {
  if (ADMIN_TOKEN && req.query.token !== ADMIN_TOKEN) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

// Overview stats
app.get('/api/stats/overview', checkAdmin, (req, res) => {
  const days = parseInt(req.query.days) || 30;

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
});

// Page views over time
app.get('/api/stats/pageviews', checkAdmin, (req, res) => {
  const days = parseInt(req.query.days) || 30;

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
});

// Tool usage stats
app.get('/api/stats/tools', checkAdmin, (req, res) => {
  const days = parseInt(req.query.days) || 30;

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
});

// Events list
app.get('/api/stats/events', checkAdmin, (req, res) => {
  const days = parseInt(req.query.days) || 30;

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
});

// Public stats endpoint (no auth, all-time counters only — for the landing page)
app.get('/api/stats/public', (req, res) => {
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
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Analytics server running on port ${PORT}`);
});
