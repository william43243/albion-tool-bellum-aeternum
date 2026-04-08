#!/usr/bin/env node
/**
 * Publish a new APK version to the in-app updater.
 *
 * Builds a signed manifest and inserts a row into the `app_versions` table,
 * flipping `is_current=1` to the new row (and 0 everywhere else). The APK
 * file itself must already be copied into /data/apks/ on the host (that dir
 * is bind-mounted as /data/apks/ in the container and served by nginx at
 * /downloads/).
 *
 * Usage (from the host):
 *
 *   docker exec albion-market node /opt/analytics/scripts/publish.js \
 *     --version 2.0.4 \
 *     --versionCode 7 \
 *     --apk /data/apks/AlbionMarket-v2.0.4.apk \
 *     --notes-fr "Bouton de mise a jour integre. Cle de signature renforcee." \
 *     --notes-en "In-app update button. Hardened signing key." \
 *     --min-version 2.0.3
 *
 * Guarantees:
 *   - Never overwrites an existing version row (version column is UNIQUE,
 *     and we check for the existing row up-front).
 *   - Refuses to publish a versionCode <= the current max versionCode, to
 *     prevent accidental downgrade from the publish side.
 *   - The signing key /data/signing-private.bin never leaves the container.
 *   - Runs the UPDATE + INSERT inside a single transaction so a crash leaves
 *     a consistent state.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const nacl = require('tweetnacl');

const DB_PATH = process.env.DB_PATH || '/data/analytics.db';
const PRIVATE_KEY_PATH = '/data/signing-private.bin';
const APK_URL_BASE = 'https://albion-tool-bellum-aeternum.com/downloads/';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function usage(msg) {
  if (msg) console.error('ERROR: ' + msg + '\n');
  console.error('Usage:');
  console.error('  publish.js --version X.Y.Z --versionCode N --apk /data/apks/FILE.apk \\');
  console.error('             --notes-fr "..." --notes-en "..." [--min-version X.Y.Z]');
  process.exit(1);
}

/**
 * Deterministic JSON serialization. Must match exactly what the client does
 * in lib/updater.ts — otherwise signature verification will fail.
 *
 * Rules:
 *   - Object keys are sorted lexicographically at every level.
 *   - No whitespace between tokens.
 *   - Primitives use JSON.stringify (so strings are escaped the same way).
 *   - Arrays keep their order.
 */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

function sha256FileHex(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.version) usage('--version is required');
  if (!args.versionCode) usage('--versionCode is required');
  if (!args.apk) usage('--apk is required');
  if (!args['notes-fr']) usage('--notes-fr is required');
  if (!args['notes-en']) usage('--notes-en is required');

  // Validate version strings to rule out shell metacharacters or paths.
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(args.version)) {
    usage('--version must be in the form X.Y.Z (e.g. 2.0.4)');
  }
  if (args['min-version'] && !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(args['min-version'])) {
    usage('--min-version must be in the form X.Y.Z');
  }

  const versionCode = parseInt(args.versionCode, 10);
  if (!Number.isFinite(versionCode) || versionCode <= 0) {
    usage('--versionCode must be a positive integer');
  }

  // Resolve and validate the APK file.
  const apkPath = path.resolve(args.apk);
  if (!fs.existsSync(apkPath)) {
    console.error('ERROR: APK not found at ' + apkPath);
    console.error('Copy the APK to /root/albion-market-data/apks/ on the host first.');
    process.exit(1);
  }
  const stat = fs.statSync(apkPath);
  if (!stat.isFile()) {
    console.error('ERROR: --apk does not point to a regular file: ' + apkPath);
    process.exit(1);
  }
  if (stat.size <= 0) {
    console.error('ERROR: APK file is empty: ' + apkPath);
    process.exit(1);
  }

  console.log('Hashing ' + apkPath + ' (' + stat.size + ' bytes)...');
  const sha256 = await sha256FileHex(apkPath);
  console.log('  sha256: ' + sha256);

  // Derive the public URL from the file's basename. Use a descriptive name
  // like AlbionMarket-v2.0.4.apk when copying into /data/apks/.
  const apkBasename = path.basename(apkPath);
  const apkUrl = APK_URL_BASE + apkBasename;

  // Load the Ed25519 private key.
  if (!fs.existsSync(PRIVATE_KEY_PATH)) {
    console.error('ERROR: signing key not found at ' + PRIVATE_KEY_PATH);
    console.error('Run: docker exec albion-market node /opt/analytics/scripts/generate-signing-key.js');
    process.exit(1);
  }
  const privKey = new Uint8Array(fs.readFileSync(PRIVATE_KEY_PATH));
  if (privKey.length !== 64) {
    console.error('ERROR: signing key is malformed (expected 64 bytes, got ' + privKey.length + ')');
    process.exit(1);
  }

  // Build the manifest. Every key here is part of the signed payload — the
  // server MUST return exactly these keys (plus manifest_signature) to the
  // client, otherwise client-side re-canonicalization will not match.
  const manifest = {
    version: args.version,
    version_code: versionCode,
    apk_url: apkUrl,
    size: stat.size,
    sha256: sha256,
    release_notes_en: args['notes-en'],
    release_notes_fr: args['notes-fr'],
    min_supported_version: args['min-version'] || args.version,
    release_date: new Date().toISOString(),
  };

  // Canonicalize, sign, hex-encode.
  const canonical = canonicalize(manifest);
  const canonicalBytes = Buffer.from(canonical, 'utf-8');
  const signature = nacl.sign.detached(new Uint8Array(canonicalBytes), privKey);
  const signatureHex = Buffer.from(signature).toString('hex');

  console.log('  canonical length: ' + canonicalBytes.length + ' bytes');
  console.log('  signature: ' + signatureHex.slice(0, 32) + '...');

  // Open the DB and create the table if it doesn't exist yet. server.js also
  // creates it on startup (Phase 3), but we do it here too so publish.js can
  // run before the server has been restarted with the new schema.
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  db.prepare(`
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
    )
  `).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_app_versions_current ON app_versions(is_current)').run();

  // Refuse if this version was already published.
  const existing = db.prepare('SELECT id FROM app_versions WHERE version = ?').get(args.version);
  if (existing) {
    console.error('ERROR: version ' + args.version + ' is already in app_versions (id=' + existing.id + ').');
    console.error('Publish a new version number — this script never overwrites existing rows.');
    db.close();
    process.exit(1);
  }

  // Refuse if the new versionCode is not strictly greater than the max.
  const maxRow = db.prepare('SELECT MAX(version_code) AS max FROM app_versions').get();
  if (maxRow && maxRow.max !== null && versionCode <= maxRow.max) {
    console.error('ERROR: --versionCode ' + versionCode + ' must be strictly greater than current max ' + maxRow.max + '.');
    console.error('Pick a higher versionCode. (If you really need to republish an older build, edit the DB by hand.)');
    db.close();
    process.exit(1);
  }

  // Transaction: unset all other is_current flags and insert the new row.
  const insertAndSwap = db.transaction(() => {
    db.prepare('UPDATE app_versions SET is_current = 0').run();
    const info = db.prepare(`
      INSERT INTO app_versions (
        version, version_code, apk_url, apk_size, sha256, signature,
        release_notes_en, release_notes_fr, min_supported_version,
        release_date, is_current
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      manifest.version,
      manifest.version_code,
      manifest.apk_url,
      manifest.size,
      manifest.sha256,
      signatureHex,
      manifest.release_notes_en,
      manifest.release_notes_fr,
      manifest.min_supported_version,
      manifest.release_date
    );
    return info.lastInsertRowid;
  });

  const newId = insertAndSwap();
  db.close();

  console.log('');
  console.log('Published v' + manifest.version + ' (versionCode ' + manifest.version_code + ')');
  console.log('  row id:    ' + newId);
  console.log('  apk_url:   ' + manifest.apk_url);
  console.log('  sha256:    ' + manifest.sha256);
  console.log('  signature: ' + signatureHex);
  console.log('');
  console.log('Verify with:');
  console.log('  curl -s https://albion-tool-bellum-aeternum.com/api/version | jq');
  console.log('');
}

main().catch((err) => {
  console.error('FATAL: ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
