# Optional ChatGPT provider for Albion Tool

The on-device provider is retained. `lib/siwc.ts` is the React Native facade; credentials never cross its bridge. Android 8+ is required for SIWC. Native classes live in `android/app/src/main/java/com/albion/market/siwc`.

## Authorization and privacy

Connection is user-initiated and has a native confirmation before the official browser flow. A public existing `oaiapp_` client ID may be entered; tokens cannot be imported. Each installation owns a stable host ID. New registrations require an explicit confirmation and the official consent flow. This implementation currently retains one registration, not an account picker.

The listener binds only 127.0.0.1 on an ephemeral port with the exact `/auth/callback` path, starts and passes a local health check before browser launch, and is owned by a bounded non-exported foreground service. State, nonce, S256 PKCE, replay guards, host/path validation, expiry, and a process-local generation fence protect the callback. RSA signature, issuer, audience, azp, timestamps, subject and nonce are validated. Only signed identity and atomically encrypted credentials can make a session active. Identity without plan permission is retained with `planEnabled=false`; inference fails closed.

Android Keystore AES-GCM protects the token envelope; backups are disabled. Refreshes are serialized and preserve the client/identity mapping. JWKS is fetched before token rotation; an unusable post-rotation result cannot trigger blind reuse of the old refresh token. Temporary failures before rotation preserve credentials. A corrupt vault is reported and may be reset only after the user confirms reconnecting. Cancellation is serialized with credential commits.

**Disconnect currently clears local tokens only. Remote revocation is not confirmed.** The UI directs users to disconnect the application in ChatGPT Settings to revoke remote access. The public client mapping and host ID remain for reauthorization.

## Inference and tools

Only `auth.openai.com` and the public `https://api.openai.com/v1` routes are used. The account catalog comes from `models[]`, preserves server order and filters `visibility=list`; no guessed model list. Every request uses `store=false`, `stream=true`; the entire structured output, including encrypted reasoning and function calls, is replayed with matching function-call outputs. There is no HTTP `previous_response_id`.

SSE data parsing is bounded and handles multiline events. Only `response.completed` establishes success. A partial result, failure, incomplete response, network interruption or cancellation never becomes a completed answer. Structured error code/parameter/status/request ID/body-shape metadata is returned without raw credentials or untrusted diagnostic bodies. No automatic paid/billing fallback or request retry is performed.

Albion tools are explicit functions in an `albion` namespace. Arguments and complete tool calls are validated before execution. `call_id` is claimed once, with limits of 8 response rounds and 16 tool calls. Public market reads use fixed server endpoints, strict item/city/quality/integer data, bounded responses, timestamps and cancellation. A zero-volume history has no invented average. Static route estimates are explicitly unverified and do not guarantee safety. Existing audited UI calculators are unchanged; the cloud chat has no general arithmetic tool and must not invent exact computed results.

## Fast experiment

Normal requests omit `service_tier`; the catalog does not claim Fast support. Explicit `fast=true` plus `experimentalFast=true` opts one conversation request into `service_tier=fast`. This follows the general Responses API contract but SIWC/account eligibility is unverified. The final event includes requested/effective tiers and `fastConfirmed`; all response rounds must report `fast` or `priority`. A text answer alone, default/unknown tier, or unsupported-capability error is not Fast success. No authenticated experiment was run during implementation.

## Local verification

- `node node_modules/typescript/bin/tsc --noEmit`
- Node 22: `node --import tsx --test --test-concurrency=2 tests/*.test.ts` (the existing analytics SQLite binary is ABI-specific).
- `tests/run-siwc.ps1 -Jdk <JDK17 directory>` after Gradle resolves Nimbus 10.10.
- Android: `gradlew.bat -p android :app:assembleDebug --max-workers=2` with Android SDK/JDK configured.

The standalone Java tests cover the production JWT validator, SSE parser, generation/cancellation/commit guards, terminal/call limits and numeric/refresh policies, plus inherited PKCE callback fixtures. They do not replace an end-to-end test of the actual Android Keystore, browser lifecycle, token refresh, Responses tool loop or Fast admission. A freshly bundled APK and separately authorized device test are required before claiming connected validation. No GitHub publication, token transfer or device authorization is part of these tests.

## Official references

- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/api/docs/guides/fast-mode

## QA package and release signature

Use `:app:assembleDebug -PALBION_QA=true` to package `com.albion.market.qa`, label **Albion Tool QA**, with the existing debug signing configuration. Verify the installed QA certificate before `adb install -r`; never uninstall or clear app/model data. The signed production `com.albion.market` cannot be updated with a debug certificate. Its protected release-signing path is deliberately unchanged.

## Verified local delivery (2026-11-05)

- Final QA assemble: successful, 36 seconds after the complete native/bundle build.
- Node 22 full suite: 411/411 passed (31.6 seconds), following an earlier concurrent-build analytics timeout that also passed in isolation.
- TypeScript typecheck: passed. Standalone Java test groups: all passed. Release packaging guards: 11/11 passed.
- Final artifact: `android/app/build/outputs/apk/debug/albion-siwc-qa-final.apk`.
- Package: `com.albion.market.qa`; version code 17; version name `2.0.8-beta.5.11`; label `Albion Tool QA`.
- APK SHA-256: `AA969895E08F5E75A527FFA9CE2522204D871AD928C8F0CED5F33FE8B00A70ED`.
- Verified signing certificate SHA-256: `a8102d831ece13ed0989cea1ba297a59f93699abb6f2f2a9219bd9983095e417` (the existing QA debug key, not the release key).
- The parent independently installed the earlier same-UI QA preview with `install -r` and observed the local Qwen model and preferences still present. Final OAuth, refresh, tool execution and Fast behavior remain untested on device until separately authorized.

## Device follow-up and teardown correction

The parent observed a persisted Connected session, a real GPT-6.1 Terra catalog entry and a real model response after the authorized QA sign-in. At 21:34:21 UTC, foreground service completion hit `NetworkOnMainThreadException` through TLS socket close in `OfficialClient.cancel -> connectionPool.evictAll`. Session persistence had already completed.

The correction keeps cancellation fences synchronous but dispatches OkHttp call cancellation, pool eviction, loopback listener/socket closure and Albion HTTP disconnection to `NetworkCleanup` background workers. It does not change, migrate, import or clear stored credentials and does not require another OAuth flow. `NetworkCleanupTest` verifies off-caller-thread execution, nonblocking dispatch even when closure waits, and worker recovery after a synthetic cleanup failure. Real Android teardown and keyboard retesting require the coordinated corrective QA installation.

## Stream final-item assembly correction (pending device verification)

The previous engine counted but discarded `response.output_item.done`. This is a demonstrated local omission, not yet a demonstrated explanation of the observed device failure. The official Responses streaming reference describes this event as carrying the finalized output item; the official Node SDK explicitly recommends the corresponding done item rather than the added item for subsequent request input.

The engine now retains bounded final items by output index and ID, waits for `response.completed`, and uses these items when terminal output is absent or empty. A nonempty terminal output is reconciled with final stream items, rejecting identity or execution-content conflicts while retaining omitted fields such as encrypted reasoning. Identical repeated final items do not execute twice. Incomplete argument deltas never execute. Failed/incomplete terminal events and EOF without completion still fail. Final message text can render without deltas; conflicting partial text fails rather than being silently duplicated. Refusals retain their distinct error classification.

Tests exercise the production generic collector, ordering, bounds, duplicate/conflict handling, completion requirement and replay-field merge. They do not establish successful Kotlin engine integration or real OAuth/tool execution on Android. A coordinated connected test remains required. No APK containing this correction has yet been installed or uploaded.

Sources:
- https://developers.openai.com/api/reference/resources/responses/streaming-events
- https://github.com/openai/openai-node/blob/main/src/resources/responses/responses.ts

## Public history boundary reproduction (2026-11-05)

A public request at 23:13:14 UTC for T4_ROCK, Caerleon, quality 1, Americas, date=09-06-2026, end_date=11-05-2026, time-scale=24 returned 45 observations, starting with 2026-09-05T00:00:00. This reproduces the previous strict lower-bound failure. Only the first two and last two printed observations were retained in tests/fixtures/aodp-history-t4-rock-caerleon-public-excerpt.json; the complete response was not saved, so no full-period average has been verified. A second 90-day request returned HTTP 429; Retry-After was not captured and no further requests were made.

The history screen uses the same endpoint but local dates and no equivalent range rejection. The native tool now uses the last 7/30/60/90 complete UTC days, excludes adjacent out-of-window daily buckets explicitly, and retains rejection of distant, duplicate, invalid and future observations. Sixty days is not claimed to equal two calendar months. HistoryAggregate computes checked integer weighted sums of reported daily average prices, and returns null when no usable positive-volume buckets exist. Daily timestamp anchoring is not assumed: non-midnight observations remain valid, and coverage counts distinct UTC dates rather than points. Reported averages are not original transaction-level prices; coverage metadata and precision limitations accompany the result. Missing days are never interpreted as zero-price days.

Ten standalone Java groups passed after extracting the production window and aggregation helpers. Tests include the retained public excerpt, boundaries, gaps, zero volume, duplicates, overflow and UTC/DST behavior. This is not a connected Android verification. A v4 build requires final review before packaging.

## v4 device validation completed (2026-11-05 follow-up)

The previously completed v4 build was verified and installed with `adb install -r` on the authorized SM-S901W. Local and installed APK SHA-256 both equal `1A4896354A5267B8401312A03E11D43F2C0D924AC6B2788B0A1F007E5D28D00E`; package `com.albion.market.qa`, versionCode 17, existing QA certificate unchanged. OAuth session, installed local Qwen model and watchlist survived. No registration, credential export, uninstall, remote publication or source-code change was needed for this follow-up.

The 425 Node 22 tests, TypeScript check and ten standalone Java groups were rerun successfully. A public AODP request independently returned 45 points for T4_ROCK/Q1/Caerleon/west, with one adjacent point excluded. The 44 usable days have weighted sum 1191786 and total volume 170460, yielding 6.9915874692 before the existing integer-floor output of 6.

On-device GPT-6.1 Terra passed a fresh greeting, travertine price lookup and the follow-up two-month-average question. The actual expanded get_history result matches those sums, reports 44/60 usable days, 16 missing days and one excluded boundary point. The final answer states September 6 through November 4, complete UTC days, partial coverage, quantity weighting and integer-floor rounding. Sol had also passed the same history scenario during the owner's preceding test.

Cancellation of a long response retained partial text and displayed Incomplete response; a new message then returned reprise OK. Brief Wi-Fi interruption produced a readable network error and preserved the message. Wi-Fi was restored and reconnection verified; manual resubmission returned reseau OK without OAuth. The QA process remained alive, with no FATAL EXCEPTION or NetworkOnMainThreadException found in its AndroidRuntime logs at the check.

An explicitly enabled experimental Fast request with Terra returned HTTP_400, no effective tier, and Fast not confirmed. The precise rejection reason is not established by that code alone. No automatic normal-tier retry occurred. Manual normal-tier retry succeeded with test termine. Fast support must not be advertised as verified.

Artifacts and detailed evidence: `C:/Users/willi/Documents/Codex/2026-11-05/files-pasted-by-the-user-tu/outputs/` (`Albion-Tool-QA-history-v4-arm64.apk`, `validation-v4.txt`, `Terra-history-tool.json`, `S22-validation-Terra.txt`). Updater installation, faithful world map, durable alerts and exhaustive keyboard/tool-cancellation lifecycle tests remain outside this completed test sequence.
