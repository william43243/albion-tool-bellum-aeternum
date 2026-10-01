import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const requireFromAnalytics = createRequire(resolve('analytics/package.json'));
const Database = requireFromAnalytics('better-sqlite3') as any;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function waitForServer(child: ReturnType<typeof spawn>): Promise<void> {
  await new Promise<void>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('analytics server startup timeout')), 10_000);
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes('Analytics server running')) {
        clearTimeout(timer);
        resolveReady();
      }
    };
    child.stdout?.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`analytics server exited before ready: ${code}`));
    });
  });
}

test('analytics backend validates payloads, minimizes rows, and removes invalid timestamps', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'albion-analytics-test-'));
  const dbPath = join(directory, 'analytics.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE page_views (id INTEGER PRIMARY KEY, page TEXT NOT NULL, referrer TEXT, user_agent TEXT, ip TEXT, created_at DATETIME DEFAULT (datetime('now')));
    CREATE TABLE events (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT, metadata TEXT, ip TEXT, created_at DATETIME DEFAULT (datetime('now')));
    INSERT INTO page_views(page, created_at) VALUES ('/', NULL), ('/', 'not-a-date'), ('bad-calendar', '2026-09-31 12:00:00'), ('/', datetime('now', '-100 days'));
    INSERT INTO events(name, category, created_at) VALUES ('flip_calc', 'calculation', NULL), ('flip_calc', 'calculation', 'not-a-date'), ('bad-calendar', 'calculation', '2026-09-31 12:00:00'), ('flip_calc', 'calculation', datetime('now', '-100 days'));
  `);
  db.close();

  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: resolve('analytics'),
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(child);
    const base = `http://127.0.0.1:${port}`;
    const page = await fetch(`${base}/api/track/pageview`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: '/cgu.html' }),
    });
    assert.equal(page.status, 204);
    const directIndex = await fetch(`${base}/api/track/pageview`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: '/index.html' }),
    });
    assert.equal(directIndex.status, 204);

    const valid = await fetch(`${base}/api/track/event`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'price_fetch', category: 'market', metadata: { item: 'T4_BAG@1', city: 'Caerleon', platform: 'android', version: '2.0.8-beta.5.11' } }),
    });
    assert.equal(valid.status, 204);

    const pii = await fetch(`${base}/api/track/event`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'ai_prompt', category: 'ai', metadata: { model: 'alice@example.com' } }),
    });
    assert.equal(pii.status, 400);

    const verify = new Database(dbPath, { readonly: true });
    assert.equal(verify.prepare("SELECT COUNT(*) AS count FROM page_views WHERE created_at IS NULL OR datetime(created_at) IS NULL OR created_at < datetime('now', '-89 days')").get().count, 0);
    assert.equal(verify.prepare("SELECT COUNT(*) AS count FROM events WHERE created_at IS NULL OR datetime(created_at) IS NULL OR created_at < datetime('now', '-89 days')").get().count, 0);
    assert.equal(verify.prepare("SELECT COUNT(*) AS count FROM page_views WHERE page = 'bad-calendar'").get().count, 0);
    assert.equal(verify.prepare("SELECT COUNT(*) AS count FROM events WHERE name = 'bad-calendar'").get().count, 0);
    const storedPage = verify.prepare("SELECT referrer, user_agent, ip FROM page_views WHERE page = '/cgu.html'").get();
    const storedEvent = verify.prepare("SELECT ip FROM events WHERE name = 'price_fetch'").get();
    assert.deepEqual(storedPage, { referrer: null, user_agent: null, ip: null });
    assert.deepEqual(storedEvent, { ip: null });
    verify.close();
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));
    await rm(directory, { recursive: true, force: true });
  }
});
