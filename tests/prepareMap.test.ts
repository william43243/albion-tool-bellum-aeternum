import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('an untrusted map source cannot overwrite either local map', () => {
  const root = mkdtempSync(join(tmpdir(), 'albion-map-integrity-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'assets/map'), { recursive: true });
    copyFileSync('scripts/prepare-map.mjs', join(root, 'scripts/prepare-map.mjs'));
    const target = join(root, 'assets/map/world-map.local.json');
    writeFileSync(target, 'preserve existing map');
    writeFileSync(join(root, 'bad.json'), '{"world":{"clusters":{}}}');
    const result = spawnSync(process.execPath, ['scripts/prepare-map.mjs', '--source', 'bad.json'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /SHA-256 mismatch/);
    assert.equal(readFileSync(target, 'utf8'), 'preserve existing map');
    assert.equal(existsSync(join(root, 'android/app/src/main/assets/world-map.local.json')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the build gate rejects mismatched Android and JavaScript maps', () => {
  const root = mkdtempSync(join(tmpdir(), 'albion-map-parity-'));
  try {
    for (const dir of ['scripts', 'assets/map', 'android/app/src/main/assets']) mkdirSync(join(root, dir), { recursive: true });
    copyFileSync('scripts/prepare-map.mjs', join(root, 'scripts/prepare-map.mjs'));
    copyFileSync('assets/map/world-map.local.json', join(root, 'assets/map/world-map.local.json'));
    const data = JSON.parse(readFileSync('assets/map/world-map.local.json', 'utf8'));
    data.zones[0].exits = [];
    writeFileSync(join(root, 'android/app/src/main/assets/world-map.local.json'), JSON.stringify(data));
    const result = spawnSync(process.execPath, ['scripts/prepare-map.mjs', '--check'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not match/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
