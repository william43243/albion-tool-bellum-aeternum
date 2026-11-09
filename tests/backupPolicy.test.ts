import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('cloud backup and device transfer exclude every Android storage domain', () => {
  const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
  const rules = readFileSync('android/app/src/main/res/xml/data_extraction_rules.xml', 'utf8');
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:fullBackupContent="false"/);
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
  const domains = ['root', 'file', 'database', 'sharedpref', 'external', 'device_root', 'device_file', 'device_database', 'device_sharedpref'];
  for (const mode of ['cloud-backup', 'device-transfer']) {
    const body = rules.match(new RegExp(`<${mode}>([\\s\\S]*?)<\\/${mode}>`))?.[1];
    assert.ok(body, `${mode} rules are missing`);
    assert.doesNotMatch(body, /<include\b/);
    for (const domain of domains) assert.match(body, new RegExp(`<exclude\\s+domain="${domain}"\\s+path="\\."\\s*\\/>`));
  }
});
