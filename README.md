# Albion Tool — Bellum Aeternum

An Android companion for Albion Online: compare market prices, calculate net flip profits, explore price history and plan routes with an interactive map and an optional AI assistant.

**Beta · Android first · English / Français / Español**

[Français](README.fr.md) · [Releases](https://github.com/william43243/albion-tool-bellum-aeternum/releases) · [Licenses and credits](THIRD_PARTY_LICENSES.md) · [Validation report](docs/publication-validation.md)

## What you can do

| Feature | Available behavior |
| --- | --- |
| Market | Look up observed buy/sell prices by item, quality, city and server; check timestamps and fees. |
| Crafting | Calculate station fees and nutrition costs using item values. |
| Flipping | Calculate net profit and ROI for instant trades or hypothetical order fills. The assistant can compare same-city and inter-city candidates using app-side arithmetic. |
| History and charts | Compare cities and items. Chat charts include line plots, reported item quantities, date inspection, fullscreen viewing and historical replay. Missing observations remain gaps. |
| World map | Search and select 414 mapped zones, zoom, open fullscreen and calculate routes from static zone connections. Route policies minimize transitions or lethal-zone exposure. |
| AI chat | Ask for prices, history, comparisons and routes. Supported tool results produce tables, charts and interactive map previews in the conversation. |
| Favorites and alerts | Save tracked items and create city-specific price alerts with at-or-below, at-or-above or exact-price conditions. Background checks target 20 minutes, subject to Android scheduling. |
| Settings | Choose Americas, Europe or Asia, manage preferences and view bundled third-party notices offline. |

The assistant obtains observations through tools and uses the app's comparison calculations. A route preview shows zone transitions and static red/black-zone exposure; it is not a travel-time or safety prediction.

## Optional AI providers

**Local inference:** Android uses LiteRT-LM with separately downloaded models. GPU support, memory needs, vision and tool calling depend on the selected model and device. Some model configurations remain experimental. See the [model registry](lib/models.ts) and [model validation notes](docs/model-download-audit.md).

**OpenAI sign-in:** an optional, experimental OAuth connection is available alongside local inference. Access and available models depend on the account and provider authorization. This is an independent integration, not an OpenAI endorsement or a promise of access under every plan. See [connection behavior, privacy and limitations](docs/siwc-integration.md).

Local inference runs on the device, but market lookups still contact external data services. Using the OpenAI provider sends the relevant conversation context and tool results to that provider. Model weights and user credentials are not included in the repository or APK.

Example requests, subject to the selected provider's capabilities and available observations:

- “Compare the last 30 days of prices for travertine blocks across all cities.”
- “Find a flip for this item starting from Martlock; include fees and show the route.”
- “Notify me when the lowest sell price for this item in Fort Sterling is at or below 500 silver.”

These examples describe intended workflows, not guaranteed profitable outcomes or completed live-service tests.

## Understand the data

Prices and history come from the **community-run [Albion Online Data Project](https://www.albion-online-data.com/)**. Coverage depends on observations uploaded by participating players and can be incomplete or stale. It is not an official, complete market feed.

- History `item_count` is the quantity of items represented in reported observations, not a count of trades/orders, silver turnover or order-book depth.
- Historical replay reveals available observations in time order. It does not reconstruct missing transactions or invent OHLC candles.
- The world map is a pinned snapshot with simplified original artwork. It has no verified live kill-activity feed, exact terrain or within-zone walking paths.
- Alerts require an observation from today in the device timezone. Android may delay background work, notification permission is required, and a threshold can be missed between checks.
- Order fills, available liquidity, transport losses and profit are not guaranteed.

Source attribution is recorded in [the data-rights review](docs/data-rights.md). Redistribution permission for the game dumps remains unconfirmed; widespread use and attribution are not treated as a license grant.

## Build from source

Requirements: **Node.js 22, Python 3.9+, JDK 17 or 21**, and Android SDK platform **37**, build-tools **37.0.0**, NDK **27.1.12297006**, CMake **3.22.1**. Configure `JAVA_HOME` and `ANDROID_HOME` for your machine.

The Android project contains maintained custom native modules. Build the checked-in project directly; `expo prebuild` is not required.

```sh
npm ci --legacy-peer-deps
npm run prepare:data
npm run check:data
python3 scripts/generate-notices.py --check
npm test
npm run typecheck
chmod +x android/gradlew
android/gradlew -p android :app:assembleDebug -PALBION_QA=true --max-workers=1
```

On Windows, use `python` instead of `python3`, omit `chmod`, and run `android\gradlew.bat`. The standalone debug APK is written to `android/app/build/outputs/apk/debug/`. The `.qa` package suffix keeps it separate from the production application; no production signing credentials are required.

`prepare:data` retrieves a fixed upstream `world.json`, verifies its SHA-256 and generates the same 414-zone dataset for JavaScript and Android. Generated map JSON files remain excluded from Git. CI run this preparation too. For an offline source file with the exact expected checksum:

```sh
npm run prepare:data -- --source /path/to/world.json
```

The initial build needs network access for dependencies and data. This preparation solves a build prerequisite; it does not establish redistribution rights.

To build the **unsigned ARM64 release candidate** used for clean-source verification:

```sh
android/gradlew -p android :app:assembleRelease -PALBION_ALLOW_UNSIGNED_RELEASE=true -PreactNativeArchitectures=arm64-v8a --max-workers=1
```

An unsigned candidate is not an installable production release. Production signing is isolated in the protected GitHub workflow; signing credentials must never be passed to Gradle. The default Android configuration also targets x86_64, which was not part of the latest clean ARM64 build verification.


This repository contains the Android app, its build tools, tests and required notices. The standalone website, backend, deployment configuration and browser AI are maintained outside this repository. The app still calls external market and update services; removing their server source here does not disable those deployed services.

## Verification and releases

The [2026-11-08 validation report](docs/publication-validation.md) records 458 passing tests, TypeScript and map integrity checks, and a successful Android JavaScript/Hermes bundle after the Android-only cleanup. The earlier clean-source ARM64 APK build is documented separately. This remains a tested beta; the cleanup was not installed on a phone.

CI checks data integrity and notices, tests the source, builds an unsigned candidate and runs Android checks. Production signing and publication require the separate protected manual workflow. Releases prepared by that workflow include `third-party-sources-notices.zip` alongside the APK.

Keep that companion archive with redistributed binaries. It contains readable notices and the upstream source archive for the Java compatibility library. See [notice maintenance and source obligations](docs/licenses/README.md).

## Project layout

| Path | Purpose |
| --- | --- |
| `screens/`, `components/`, `hooks/` | React Native UI, charts, map previews and state handling |
| `lib/` | Calculations, API access, history, routing and assistant bridges |
| `android/app/src/main/java/` | Kotlin/Java inference, authentication, tool execution and alerts |
| `scripts/` | Pinned map preparation and license/source packaging |
| `tests/`, `docs/` | Automated checks, technical evidence and integration limitations |

The app uses React Native 0.88.1, Expo 58, TypeScript, Kotlin/Java and LiteRT-LM. Dependency versions are recorded in the lockfiles and Gradle configuration.

## Report a problem

Use [GitHub Issues](https://github.com/william43243/albion-tool-bellum-aeternum/issues) and include the app version, Android/device version, selected server, provider/model, reproduction steps and observation timestamps when relevant. Remove private chat content from screenshots. Never attach access tokens, API keys, passwords or signing keys.

## License and credits

Original project code is under the [MIT license](LICENSE). Third-party data, models, software and trademarks retain their own terms. See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md), the [runtime notices](docs/licenses/README.md) and the [data-rights review](docs/data-rights.md).

Sources include [AODP](https://www.albion-online-data.com/), [ao-data/ao-bin-dumps](https://github.com/ao-data/ao-bin-dumps), [LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM), [LiteRT Community](https://huggingface.co/litert-community), the [Albion Online Wiki](https://wiki.albiononline.com/) and the credited [map visual reference](https://allthingsalbion.com/en/zones/map).

Albion Online is a trademark of Sandbox Interactive GmbH. This project is not affiliated with, sponsored by or endorsed by Sandbox Interactive or OpenAI.

## Support

If the tool helps you, you can support development:

**BTC** : `bc1qcptkrekh335wvffcxnrzqkj5nqf72r538vey4x`
