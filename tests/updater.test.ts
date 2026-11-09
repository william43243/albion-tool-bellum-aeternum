import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import nacl from 'tweetnacl';
import type * as Updater from '../lib/updater';

const source = readFileSync('lib/updater.ts', 'utf8');
const documents = 'file:///data/user/0/com.albion.market/files/';
const payload = new TextEncoder().encode('unit test bytes, not an APK');
const digest = createHash('sha256').update(payload).digest('hex');
const testKeys = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
const productionKey = source.match(/PUBLIC_SIGNING_KEY\s*=\s*'([a-f0-9]{64})'/)?.[1];
assert.ok(productionKey);
const manifest: Updater.VersionManifest = {
  version: '2.0.9', version_code: 18, apk_url: 'https://updates.invalid/test.apk',
  size: payload.length, sha256: digest, release_notes_en: 'Test',
  release_notes_fr: 'Essai', min_supported_version: '2.0.8', release_date: '2026-11-05',
};
function signed(value: Updater.VersionManifest) {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
  const signature = nacl.sign.detached(new TextEncoder().encode(canonical), testKeys.secretKey);
  return { ...value, manifest_signature: Buffer.from(signature).toString('hex') };
}

function execute(code: string, dependencies: Record<string, unknown>) {
  const output = ts.transpileModule(code, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(output, {
    exports, Uint8Array, ArrayBuffer, TextEncoder, atob,
    console: { warn() {} },
    fetch: dependencies.fetch,
    require(name: string) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}

function harness(options: { documents?: string | null; directoryError?: Error; contentUriError?: Error; productionKey?: boolean } = {}) {
  const events: string[] = [];
  const files = new Map<string, Uint8Array>([
    [documents + 'updates/stale.apk', new Uint8Array([1])],
    [documents + 'updates/notes.txt', new Uint8Array([2])],
  ]);
  const deletes: string[] = [];
  const intents: Array<{ action: string; options: Record<string, unknown> }> = [];
  let downloadedTo = '';
  let response: unknown = signed(manifest);
  const application = { nativeApplicationVersion: '2.0.8', nativeBuildVersion: '17' };
  const legacy = {
    documentDirectory: options.documents === undefined ? documents : options.documents,
    EncodingType: { Base64: 'base64' },
    async makeDirectoryAsync(uri: string, settings: { intermediates: boolean }) {
      events.push('mkdir');
      assert.equal(uri, documents + 'updates/');
      assert.equal(settings.intermediates, true);
      if (options.directoryError) throw options.directoryError;
    },
    async readDirectoryAsync(uri: string) {
      events.push('list');
      return [...files.keys()].filter((path) => path.startsWith(uri)).map((path) => path.slice(uri.length));
    },
    async deleteAsync(uri: string, settings: { idempotent: boolean }) {
      assert.equal(settings.idempotent, true);
      deletes.push(uri); files.delete(uri);
    },
    createDownloadResumable(url: string, uri: string, _settings: unknown, onProgress: (progress: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void) {
      events.push('createDownload');
      assert.equal(url, manifest.apk_url);
      downloadedTo = uri;
      return { async downloadAsync() {
        events.push('download'); files.set(uri, payload);
        onProgress({ totalBytesWritten: 0, totalBytesExpectedToWrite: 0 });
        onProgress({ totalBytesWritten: payload.length, totalBytesExpectedToWrite: payload.length });
        return { uri, status: 200 };
      } };
    },
    async getInfoAsync(uri: string) {
      events.push('info');
      const bytes = files.get(uri);
      return bytes ? { exists: true, isDirectory: false, size: bytes.length, uri } : { exists: false, isDirectory: false };
    },
    async readAsStringAsync(uri: string, settings: { encoding: string }) {
      events.push('readBase64');
      assert.equal(settings.encoding, 'base64');
      return Buffer.from(files.get(uri)!).toString('base64');
    },
    async getContentUriAsync(uri: string) {
      events.push('contentUri');
      assert.equal(uri, documents + 'updates/AlbionMarket-v2.0.9.apk');
      if (options.contentUriError) throw options.contentUriError;
      return 'content://com.albion.market.FileSystemFileProvider/expo_files/updates/AlbionMarket-v2.0.9.apk';
    },
  };
  const dependencies = {
    'expo-file-system/legacy': legacy,
    'expo-crypto': {
      CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
      async digest(algorithm: string, input: ArrayBuffer) {
        events.push('hash'); assert.equal(algorithm, 'SHA-256');
        const bytes = createHash('sha256').update(new Uint8Array(input)).digest();
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    },
    'expo-intent-launcher': { async startActivityAsync(action: string, intentOptions: Record<string, unknown>) { intents.push({ action, options: intentOptions }); } },
    'expo-application': application,
    tweetnacl: nacl,
    async fetch() { return { ok: true, async json() { return response; } }; },
  };
  // Only the in-memory test module gets a fixture public key. The production
  // file and trust anchor are never changed; real Ed25519 verification runs.
  const code = options.productionKey ? source : source.replace(productionKey!, Buffer.from(testKeys.publicKey).toString('hex'));
  const updater = execute(code, dependencies) as unknown as typeof Updater;
  return { updater, events, files, deletes, intents, application, setResponse(value: unknown) { response = value; }, get downloadedTo() { return downloadedTo; } };
}

test('the installed SDK root compatibility methods really throw; legacy is its supported export', async () => {
  const warnings = execute(readFileSync('node_modules/expo-file-system/src/legacyWarnings.ts', 'utf8'), {});
  assert.throws(() => (warnings.createDownloadResumable as Function)('https://invalid', 'file:///invalid'), /expo-file-system\/legacy/);
  await assert.rejects((warnings.getContentUriAsync as Function)('file:///invalid'), /expo-file-system\/legacy/);
  const packageJson = JSON.parse(readFileSync('node_modules/expo-file-system/package.json', 'utf8'));
  assert.match(packageJson.exports['./legacy'].default, /\.\/build\/legacy\/index\.js$/);
  assert.equal(packageJson.exports['./legacy']['expo-source'], './src/legacy/index.ts');
});

test('the actual updater downloads to persistent storage, reports progress, and checks size and SHA256', async () => {
  const h = harness();
  const progress: number[] = [];
  const uri = await h.updater.downloadUpdate(manifest, (fraction) => progress.push(fraction));
  assert.equal(uri, documents + 'updates/AlbionMarket-v2.0.9.apk');
  assert.deepEqual(progress, [1]);
  assert.deepEqual(h.events, ['mkdir', 'list', 'createDownload', 'download', 'info', 'readBase64', 'hash']);
  assert.deepEqual(h.deletes, [documents + 'updates/stale.apk']);
  assert.ok(h.files.has(documents + 'updates/notes.txt'), 'unrelated files are preserved');
  assert.ok(h.files.has(uri));
  assert.equal(h.intents.length, 0, 'downloading never installs automatically');
});

test('unavailable document storage fails before touching files or starting a download', async () => {
  const h = harness({ documents: null });
  await assert.rejects(h.updater.downloadUpdate(manifest), /storage is unavailable/);
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.deletes, []);
});

test('a directory permission/storage error is not swallowed or followed by cleanup/download', async () => {
  const h = harness({ directoryError: new Error('permission denied') });
  await assert.rejects(h.updater.downloadUpdate(manifest), /permission denied/);
  assert.deepEqual(h.events, ['mkdir']);
  assert.deepEqual(h.deletes, []);
});

test('a size mismatch removes the invalid download before hashing or installing', async () => {
  const h = harness();
  await assert.rejects(h.updater.downloadUpdate({ ...manifest, size: payload.length + 1 }), /size mismatch/);
  assert.equal(h.files.has(h.downloadedTo), false);
  assert.equal(h.events.includes('hash'), false);
  assert.equal(h.intents.length, 0);
});

test('a SHA256 mismatch removes the invalid download and never launches the installer', async () => {
  const h = harness();
  await assert.rejects(h.updater.downloadUpdate({ ...manifest, sha256: '0'.repeat(64) }), /sha256 mismatch/);
  assert.equal(h.files.has(h.downloadedTo), false);
  assert.equal(h.intents.length, 0);
});

test('installation hands only a content URI and a read grant to the Android installer', async () => {
  const h = harness();
  const uri = await h.updater.downloadUpdate(manifest);
  await h.updater.installUpdate(uri);
  assert.equal(h.intents.length, 1);
  assert.equal(h.intents[0].action, 'android.intent.action.VIEW');
  assert.match(h.intents[0].options.data as string, /^content:\/\//);
  assert.equal(h.intents[0].options.type, 'application/vnd.android.package-archive');
  assert.equal(h.intents[0].options.flags, 0x10000001);
});

test('denied content-URI access never starts an install intent', async () => {
  const h = harness({ contentUriError: new Error('permission denied') });
  await assert.rejects(h.updater.installUpdate(documents + 'updates/AlbionMarket-v2.0.9.apk'), /permission denied/);
  assert.equal(h.intents.length, 0);
});

test('real Ed25519 verification accepts a valid newer fixture manifest and still blocks downgrades', async () => {
  const h = harness();
  assert.equal((await h.updater.checkForUpdate())?.version_code, 18);
  h.application.nativeBuildVersion = '18';
  assert.equal(await h.updater.checkForUpdate(), null);
  h.application.nativeBuildVersion = '19';
  assert.equal(await h.updater.checkForUpdate(), null);
});

test('tampered signed content and an untrusted signing key remain rejected', async () => {
  const h = harness();
  h.setResponse({ ...signed(manifest), apk_url: 'https://attacker.invalid/changed.apk' });
  await assert.rejects(h.updater.checkForUpdate(), /signature invalid/);
  const production = harness({ productionKey: true });
  await assert.rejects(production.updater.checkForUpdate(), /signature invalid/);
  assert.deepEqual(h.events, []);
  assert.deepEqual(production.events, []);
});

test('existing permission and Expo provider declarations require no broader storage grant', () => {
  const appManifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
  const provider = readFileSync('node_modules/expo-file-system/android/src/main/AndroidManifest.xml', 'utf8');
  const paths = readFileSync('node_modules/expo-file-system/android/src/main/res/xml/file_system_provider_paths.xml', 'utf8');
  assert.match(appManifest, /android\.permission\.REQUEST_INSTALL_PACKAGES/);
  assert.match(appManifest, /READ_EXTERNAL_STORAGE" tools:node="remove"/);
  assert.match(provider, /android:exported="false" android:grantUriPermissions="true"/);
  assert.match(paths, /<files-path name="expo_files" path="\."/);
});
