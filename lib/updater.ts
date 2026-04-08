/**
 * In-app updater for AlbionMarket.
 *
 * Flow:
 *   1. checkForUpdate() — fetch /api/version, verify Ed25519 signature on
 *      the manifest, compare the installed versionCode to the published one.
 *   2. downloadUpdate() — download the APK, verify size + SHA256.
 *   3. installUpdate() — hand the APK to Android's package installer via a
 *      FileProvider content:// URI.
 *
 * Security model:
 *   - The manifest is signed with Ed25519. The public key is hardcoded in
 *     PUBLIC_SIGNING_KEY below, so the server can never forge a manifest
 *     without the private key (/data/signing-private.bin on the server).
 *     A compromised server or MITM cannot push arbitrary APKs to clients.
 *   - The APK's SHA256 is verified after download. Any mismatch deletes the
 *     file and throws.
 *   - Downgrades are rejected: publishedCode must be strictly greater than
 *     the installed versionCode.
 *   - Downloads live under documentDirectory (persistent) rather than
 *     cacheDirectory (which Android may purge at any time).
 */

import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Application from 'expo-application';
import nacl from 'tweetnacl';

// ─────────────────────────────────────────────────────────────
// Compile-time constants
// ─────────────────────────────────────────────────────────────

/**
 * Ed25519 public key, hex-encoded (64 chars = 32 bytes).
 *
 * Generated once via `analytics/scripts/generate-signing-key.js`. MUST be
 * replaced with the real public key before shipping a build that ships the
 * updater UI — the all-zeros placeholder will reject every real manifest.
 *
 * Rotating this key is a breaking change: every existing client will stop
 * accepting updates until they install a build with the new key.
 */
export const PUBLIC_SIGNING_KEY =
  '696c75604e00842f94169d077b092dd12b9d832fc34f0b4ff9e16a131dd78ddc';

const MANIFEST_URL = 'https://albion-tool-bellum-aeternum.com/api/version';

/**
 * Downloaded APKs live in documentDirectory, not cacheDirectory — Android
 * can reclaim cacheDirectory under memory pressure, which would break the
 * install flow if it happens between download and install.
 */
const UPDATES_DIR = FileSystem.documentDirectory + 'updates/';

/**
 * The set of fields that make up the signed manifest. This list must match
 * what analytics/scripts/publish.js signs, and what analytics/server.js
 * returns (minus the signature column). Any drift here will cause client
 * verification to fail.
 */
const MANIFEST_KEYS = [
  'version',
  'version_code',
  'apk_url',
  'size',
  'sha256',
  'release_notes_en',
  'release_notes_fr',
  'min_supported_version',
  'release_date',
] as const;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface VersionManifest {
  version: string;
  version_code: number;
  apk_url: string;
  size: number;
  sha256: string;
  release_notes_en: string;
  release_notes_fr: string;
  min_supported_version: string;
  release_date: string;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Deterministic JSON serialization. MUST produce byte-identical output to
 * the canonicalize() in analytics/scripts/publish.js — see the comment
 * there for the rules.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') +
    '}'
  );
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('hex string has odd length');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Decode a base64 string into raw bytes. RN 0.71+ exposes atob on the
 * global scope so we rely on that instead of pulling in a polyfill.
 */
function base64ToBytes(base64: string): Uint8Array {
  const atobFn = (globalThis as any).atob as (s: string) => string;
  if (typeof atobFn !== 'function') {
    throw new Error('atob is not available on this runtime');
  }
  const binary = atobFn(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function utf8Encode(s: string): Uint8Array {
  if (typeof (globalThis as any).TextEncoder !== 'undefined') {
    return new (globalThis as any).TextEncoder().encode(s);
  }
  // Manual UTF-8 encoder fallback. Handles BMP + astral planes via surrogate
  // pair reassembly.
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let code = s.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6));
      out.push(0x80 | (code & 0x3f));
    } else if (code < 0xd800 || code >= 0xe000) {
      out.push(0xe0 | (code >> 12));
      out.push(0x80 | ((code >> 6) & 0x3f));
      out.push(0x80 | (code & 0x3f));
    } else {
      i++;
      code = 0x10000 + (((code & 0x3ff) << 10) | (s.charCodeAt(i) & 0x3ff));
      out.push(0xf0 | (code >> 18));
      out.push(0x80 | ((code >> 12) & 0x3f));
      out.push(0x80 | ((code >> 6) & 0x3f));
      out.push(0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(out);
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Check the server for an available update.
 *
 * Verifies the Ed25519 signature on the manifest before trusting any field.
 * Returns null if the installed version is already at or above the published
 * versionCode. Throws on network error, invalid signature, or malformed
 * response.
 */
export async function checkForUpdate(): Promise<VersionManifest | null> {
  const installedName = Application.nativeApplicationVersion ?? 'unknown';

  const res = await fetch(MANIFEST_URL, {
    headers: {
      'X-Current-Version': installedName,
      'X-Platform': 'android',
    },
  });

  if (!res.ok) {
    throw new Error('update check failed: HTTP ' + res.status);
  }

  const data = (await res.json()) as Record<string, unknown>;

  // Strip the signature out and verify what remains.
  const manifest_signature = data.manifest_signature;
  if (typeof manifest_signature !== 'string' || manifest_signature.length === 0) {
    throw new Error('manifest missing signature');
  }
  const rest: Record<string, unknown> = { ...data };
  delete rest.manifest_signature;

  // The response must contain every field that was signed — no more, no
  // less. "More" would allow a tampered server to sneak in extra data; "less"
  // means the canonicalization won't match.
  for (const k of MANIFEST_KEYS) {
    if (!(k in rest)) {
      throw new Error('manifest missing field: ' + k);
    }
  }
  for (const k of Object.keys(rest)) {
    if (!(MANIFEST_KEYS as readonly string[]).includes(k)) {
      throw new Error('manifest has unexpected field: ' + k);
    }
  }

  const canonicalBytes = utf8Encode(canonicalize(rest));
  const signatureBytes = hexToBytes(manifest_signature);
  const pubKeyBytes = hexToBytes(PUBLIC_SIGNING_KEY);

  if (signatureBytes.length !== 64) {
    throw new Error('manifest signature wrong length');
  }
  if (pubKeyBytes.length !== 32) {
    throw new Error('public key wrong length — was it set correctly?');
  }

  const valid = nacl.sign.detached.verify(
    canonicalBytes,
    signatureBytes,
    pubKeyBytes
  );
  if (!valid) {
    throw new Error('manifest signature invalid');
  }

  const manifest = rest as unknown as VersionManifest;

  // Compare the published versionCode to the installed versionCode. Use
  // nativeBuildVersion (Android versionCode) rather than the name string —
  // it's monotonically increasing per build.
  const installedCode = parseInt(Application.nativeBuildVersion ?? '0', 10);
  const publishedCode = manifest.version_code;

  if (!Number.isFinite(publishedCode) || publishedCode <= 0) {
    throw new Error('manifest has invalid version_code');
  }

  if (publishedCode <= installedCode) {
    return null; // Already up to date (or ahead).
  }

  return manifest;
}

/**
 * Download the APK referenced by a (previously verified) manifest.
 *
 * Verifies the file size and SHA256 after the download completes. If either
 * check fails, the partial file is deleted and an error is thrown.
 *
 * Returns the local file:// URI on success. Caller should pass this URI to
 * installUpdate().
 */
export async function downloadUpdate(
  manifest: VersionManifest,
  onProgress?: (fraction: number) => void
): Promise<string> {
  // Ensure the updates directory exists.
  try {
    await FileSystem.makeDirectoryAsync(UPDATES_DIR, { intermediates: true });
  } catch {
    // Already exists — ignore.
  }

  // Clean up any stale APKs from previous update attempts so we don't
  // accumulate multiple copies on disk.
  try {
    const entries = await FileSystem.readDirectoryAsync(UPDATES_DIR);
    for (const name of entries) {
      if (name.endsWith('.apk')) {
        await FileSystem.deleteAsync(UPDATES_DIR + name, { idempotent: true });
      }
    }
  } catch {
    // Dir might not exist yet — nothing to clean.
  }

  const filename = 'AlbionMarket-v' + manifest.version + '.apk';
  const localPath = UPDATES_DIR + filename;

  const task = FileSystem.createDownloadResumable(
    manifest.apk_url,
    localPath,
    {},
    (progress) => {
      if (onProgress && progress.totalBytesExpectedToWrite > 0) {
        onProgress(
          progress.totalBytesWritten / progress.totalBytesExpectedToWrite
        );
      }
    }
  );

  const result = await task.downloadAsync();
  if (!result || !result.uri) {
    throw new Error('download failed');
  }

  // Verify size.
  const info = await FileSystem.getInfoAsync(result.uri);
  if (!info.exists) {
    throw new Error('downloaded file disappeared');
  }
  // `size` is always present on existing files in practice, but fileType
  // narrowing in expo-file-system doesn't reflect that.
  const actualSize = (info as { size?: number }).size ?? 0;
  if (actualSize !== manifest.size) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true });
    throw new Error(
      'size mismatch: expected ' + manifest.size + ', got ' + actualSize
    );
  }

  // Read the whole APK into memory (~50-100MB is acceptable on a modern
  // phone) and hash it. expo-crypto.digest() takes a BufferSource and runs
  // natively, so the only cost in JS is the base64 decode.
  const base64 = await FileSystem.readAsStringAsync(result.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const fileBytes = base64ToBytes(base64);
  const hashBuffer = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    fileBytes
  );
  const computed = bytesToHex(new Uint8Array(hashBuffer));

  if (computed !== manifest.sha256) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true });
    throw new Error(
      'sha256 mismatch: expected ' + manifest.sha256 + ', got ' + computed
    );
  }

  return result.uri;
}

/**
 * Hand the APK to Android's package installer.
 *
 * After this call, the system installer takes over. If the user confirms,
 * the app's process will be killed and replaced by the new build. Anything
 * the caller needs to persist (analytics events, progress state) must be
 * flushed BEFORE calling this.
 */
export async function installUpdate(localUri: string): Promise<void> {
  // Convert file:// to content:// via the app's FileProvider (configured
  // in AndroidManifest.xml — see android/app/src/main/res/xml/file_paths.xml).
  const contentUri = await FileSystem.getContentUriAsync(localUri);

  // Intent flags:
  //   FLAG_GRANT_READ_URI_PERMISSION = 0x00000001 — lets the installer read
  //     our content:// URI even though we didn't declare it in a manifest.
  //   FLAG_ACTIVITY_NEW_TASK         = 0x10000000 — required when launching
  //     an activity from a non-Activity context.
  const FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;
  const FLAG_ACTIVITY_NEW_TASK = 0x10000000;

  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    flags: FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
    type: 'application/vnd.android.package-archive',
  });
}
