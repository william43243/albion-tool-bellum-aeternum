# Android updater: Expo SDK 55 compatibility

Verified against the installed official `expo-file-system` package, version `55.0.26`, on 2026-11-05.

## Confirmed defect

`lib/updater.ts` imported the root `expo-file-system` namespace and suppressed type checking of constants with `as any`. In SDK 55, the old functions exported at the root come from `src/legacyWarnings.ts`. They deliberately throw instead of invoking the native filesystem. This includes `makeDirectoryAsync`, `createDownloadResumable`, `getInfoAsync`, `readAsStringAsync`, and `getContentUriAsync`. The root also does not expose the legacy `documentDirectory` constant used to form the download path.

The installed package's exports explicitly provide `expo-file-system/legacy`, backed by `src/legacy/index.ts`. Its typed API supplies the constants and native methods used by this updater. Official reference: [Expo FileSystem legacy API](https://docs.expo.dev/versions/v55.0.0/sdk/filesystem-legacy/).

## Local correction

- Import the supported `/legacy` API and remove the untyped compatibility cast.
- Resolve the persistent `documentDirectory/updates/` path when a download starts. An unavailable directory fails before any cleanup or download rather than producing an `undefinedupdates/` path.
- Propagate directory permission/storage failures. The installed Android implementation in `FileSystemLegacyModule.kt` explicitly accepts an already-existing directory with `intermediates: true`, so a catch-all is unnecessary and hid real failures.
- Correct the FileProvider comment: the provider and its paths are supplied by Expo's dependency manifest, not a nonexistent application `file_paths.xml`.

The patch does not alter the signing key, signed manifest fields, downgrade check, APK size/SHA256 verification, stored version state, cleanup scope, or UI confirmation flow.

## Permissions and installation boundary

The app already declares `REQUEST_INSTALL_PACKAGES`. Expo supplies a non-exported `FileSystemFileProvider` with URI grants enabled and an internal `files-path`. The updater converts the verified file URI to a content URI and sends the Android installer a read grant plus `NEW_TASK`, preserving the existing MIME type. No storage permission, unknown-sources setting, provider exposure, or automatic installation is added. Android still controls any required per-source installation permission and the final installation confirmation.

## Validation and limits

`tests/updater.test.ts` executes the actual updater source after TypeScript transpilation, replacing filesystem, network, and installer effects with in-memory fakes. It also executes the installed root compatibility stubs to reproduce their thrown errors. Tests cover persistent paths, progress, missing storage, denied directory access, size mismatch cleanup, SHA256 mismatch cleanup, content-URI handoff, denied URI access, real Ed25519 verification, tampering, and downgrade rejection. The fixture signing key is substituted only inside the isolated test module; the production trust anchor is unchanged.

Eleven tests pass, along with TypeScript checking and `git diff --check`. No APK was downloaded or installed, no device permission was changed, and no user file was deleted during these tests. Native on-device package installation remains untested. Existing whole-file Base64 hashing can still have a significant memory cost for large APKs; this compatibility patch does not redesign hashing.
