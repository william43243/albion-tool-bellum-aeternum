# Runtime notices and corresponding source

The offline **Settings → Licenses and credits** screen reads `assets/legal/third-party-notices.json`. This corpus contains the actual license/NOTICE texts collected from the JavaScript packages in the Android release bundle, the selected Maven runtime artifacts, the local Expo packages and documented native supplements. Long texts are displayed in chunks; they are not replaced with links or truncated.

`android-runtime-inventory.json` records dependency-input hashes, selected native coordinates and JavaScript package paths. `supplements.json` records upstream sources and SHA-256 hashes for notices missing from the installed artifacts. `npm-inventory.json` is the broader lockfile inventory, including development dependencies; it is not a claim that all these packages ship inside the APK.

## Regenerate and validate

After installing dependencies and preparing the map as described in the main README:

```sh
android/gradlew -p android :app:assembleRelease -PALBION_ALLOW_UNSIGNED_RELEASE=true
android/gradlew -p android :app:exportThirdPartyArtifacts
python3 scripts/generate-notices.py
python3 scripts/generate-notices.py --check-runtime
python3 scripts/package-release-notices.py --output release-notices
```

Use `android\gradlew.bat` and `python` on Windows. Generation uses the actual release source map and resolved artifacts; it does not scan every old version in the Gradle cache. It requires the cached POMs and reviewed supplements. New unresolved components are listed explicitly and cause the check to fail. Review added components and their native internals before adding a supplement. Do not suppress a missing license by assigning MIT to an unknown component.

CI checks the corpus before building and then compares it against the release runtime, including native artifact hashes. The explicit production publication workflow attaches `third-party-sources-notices.zip` and its checksum alongside the APK. The archive includes readable notice texts, the component index and the upstream source archive described below. Building locally does not publish anything.

## Conditions that are not plain MIT

- **desugar_jdk_libs 2.1.5** provides Java API compatibility on older Android versions. Its upstream license is GPL-2.0 with the Classpath Exception, plus additional notices. The exception addresses linking independent modules; it does not erase obligations relating to the library itself. The unmodified upstream source tree and build scripts from commit `73170c345e6a762fc6a1f0301bb15218850023ef`, which prepares version 2.1.5, are retained in [source/desugar-jdk-libs-2.1.5.tar.gz](source/desugar-jdk-libs-2.1.5.tar.gz), with [provenance and checksum](source/manifest.json). Preserve this companion source when redistributing the APK. See the [upstream license](https://github.com/google/desugar_jdk_libs/blob/73170c345e6a762fc6a1f0301bb15218850023ef/LICENSE) and additional notice, both included in the corpus.
- **Play Install Referrer 2.2** declares the [Android SDK License Agreement](https://developer.android.com/studio/terms), not an open-source MIT license. Its use is documented by [Google's integration guide](https://developer.android.com/google/play/installreferrer/library). The terms are preserved separately; this corpus does not relicense the component or the SDK.
- **NDK toolchain notice** is preserved as a supplemental upstream document. It includes licenses for development tools as well as runtime components; its inclusion does not mean all these tools are bundled in the APK. React Native C++ dependency notices and Hermes internal notices are also retained.
- Downloaded model weights are not part of this runtime corpus. Their artifact-specific licenses and the browser fallback distinction are listed in [THIRD_PARTY_LICENSES.md](../../THIRD_PARTY_LICENSES.md).

The collection and checks establish notice provenance and coverage of the declared inputs. They do not constitute a blanket legal certification, and they do not resolve the separate [Albion game-data rights](../data-rights.md).
