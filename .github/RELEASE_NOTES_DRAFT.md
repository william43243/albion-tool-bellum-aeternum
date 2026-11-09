# Next beta — draft release notes

This draft describes the prepared source tree. It is not a published release or a production-signed APK. The current source version remains `2.0.8-beta.5.11`; choose the intended release version before publishing a new binary rather than replacing an existing release asset.

## Application

- Compare observed market prices and app-calculated flip profits, including fees and same-city/inter-city options.
- Explore a 414-zone interactive map with fullscreen mode, zone search and static route policies.
- Show tool-driven route previews, comparison tables and history charts in AI conversations.
- Use line-chart comparisons, reported item quantities and chronological replay without fabricating missing observations.
- Create city-specific price alerts from explicit threshold conditions, with Android background scheduling and freshness limitations explained.
- Keep local model inference alongside an optional experimental OpenAI OAuth connection.

## Build, security and notices

- Regenerate the ignored map inputs from a pinned source with source and dataset integrity checks.
- Build the maintained Android project directly, with a separate QA package and isolated production signing.
- Access notices for 219 runtime components in Settings; include the third-party source/notice archive alongside released APKs.
- Check runtime dependency coverage and native artifact hashes during CI.
- Keep this repository Android-only: remove standalone website/backend deployment, browser AI and unrelated screenshots.

## Validation

The [validation report](../docs/publication-validation.md) records 458 passing tests, TypeScript and map integrity checks, and a successful Android JavaScript/Hermes bundle after the Android-only cleanup. The earlier clean ARM64 APK build is documented separately; this cleanup was not installed on a phone.

Market observations remain community-sourced and may be missing or stale. The map is static, without verified live kill activity or guaranteed safe transport. Provider/model support varies. Game-data redistribution rights remain an explicitly documented open question; original-code MIT licensing does not relicense third-party material.

For the future release, distribute the signed APK, its checksum, `third-party-sources-notices.zip` and `THIRD_PARTY_SHA256SUMS` together.
