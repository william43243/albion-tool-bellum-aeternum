# Publication preparation — 2026-11-08

> Historical validation of commit `8c2e6a9`, before the Android-only repository cleanup. Website/backend checks and their dependency installation described below apply to that earlier snapshot, not the current source layout.

## Clean source reconstruction

A separate copy of the prospective Git files was created without `node_modules`, either local map JSON, a local Android SDK configuration, a debug keystore or prior build output. Dependencies were installed from the lockfiles and `npm run prepare:data` regenerated both map inputs from the pinned, SHA-256-verified source. All 414 zones matched the reviewed snapshot.

The Windows ARM64 unsigned release build completed successfully: **505 tasks executed**, without reusing project build outputs. Shared package/Gradle download caches and the installed Android SDK were available. This is a clean source/build verification, not a claim of a fully offline or bit-for-bit reproducible toolchain.

## Checks completed

- 469/469 TypeScript/Node tests in the clean copy; TypeScript type checking passed.
- 14/14 web security regression checks.
- 11/11 release configuration tests after the final workflow updates.
- The backend integration test passed again after updating `body-parser` to 1.20.9 and `qs` to 6.16.2; npm reported zero remaining advisories for the analytics dependency tree. See the upstream [body-parser advisory](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828) and [qs advisory](https://github.com/ljharb/qs/security/advisories/GHSA-6pq8-jhm2-2vcw). These are dependency findings, not a claim that both were exploitable through this application's configuration.
- Release build and its vital lint gate passed.
- The notice check matched the actual release source map and resolved native artifact hashes: **220 components, 58 preserved notice texts**, no unresolved coverage entries.
- APK ZIP integrity passed; the embedded Android map equals the JavaScript map. The bundle contains all 220 component identifiers and 58 notice-text hashes. No `.ttf` or `.otf` files were packaged.
- Companion source/notice ZIP integrity passed: 65 entries, including the upstream desugar JDK 2.1.5 source archive and build scripts.
- Gitleaks checked 379 prospective source files. Its sole finding was the previously reviewed public updater verification key; no credential was confirmed. This is bounded scanner evidence, not a guarantee that no possible secret exists.

## Validation artifact

`app-release-unsigned.apk`, ARM64 only, 63,493,336 bytes.

SHA-256: `ee7ed907cc0a037f462a5452ad5991fb5e10eaef5080423a1be456fc24862b4c`

This candidate is unsigned and was not installed on the phone. The new notices screen was type-checked and bundled, but not visually tested on the device in this pass. The GitHub workflow was updated and source-tested; it was not executed remotely. The fresh native build covered ARM64, not x86_64. No commit, push or deployment was performed.

## Remaining distinction

The build prerequisite and runtime-notice gaps are addressed. The separate [game-data redistribution question](data-rights.md) remains documented; widespread use is not treated as a license grant. See [runtime notice maintenance](licenses/README.md) for regeneration and companion-source distribution.

## Android-only cleanup validation

The later Android-only cleanup removes the standalone website, backend/deployment files, browser AI and unrelated screenshots from the current tree. A fresh `npm ci --legacy-peer-deps` succeeded with no reported vulnerabilities; 21 lockfile packages were removed without upgrading retained packages.

- 458/458 retained Android/client tests passed (two test workers), with TypeScript and both 414-zone map inputs verified. Website/server-specific tests were removed with their sources.
- `:app:createBundleReleaseJsAndAssets` and `:app:exportThirdPartyArtifacts` succeeded: 871 Metro modules and 179 selected native artifacts. Runtime notices were regenerated and checked against those actual build outputs.
- The candidate source scan detected only the previously reviewed public updater verification key, not a private credential.

This pass rebuilt the Android JavaScript/Hermes bundle, not a complete APK, and did not install anything on a phone or deploy any server. The website remains in earlier Git history; the cleanup does not rewrite that history.
