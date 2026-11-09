# S22: Qwen3.5 startup and Android low-memory termination

Date: 2026-11-05. Scope: Android QA package `com.albion.market.qa`, Samsung SM-S901W (Qualcomm), LiteRT-LM Android 0.17.0. This investigation read phone logs/state and tested local source. It did not reinstall, relaunch, change settings, delete caches, download weights, or run inference on the phone.

## What was observed

Times below are the device log timestamps, not an asserted UTC conversion.

- PID 4927 compiled OpenCL prefill graphs of lengths 1024, 256, 64, 16, 4 and 1 between 07:51:36 and 07:52:42, followed by decode.
- 07:52:45.292: `Engine initialized WITH vision (GPU)`.
- 07:52:51.254: `Engine ready: Qwen3.5-0.8B-VL_int8.litertlm, vision=true, tools=5`.
- 07:53:24.682: LMKD reclaimed `com.albion.market.qa` PID 4927, `oom_score_adj 0`, state 2, reporting 2,060,688 kB RSS and 1,744,080 kB swap, with low-swap/thrashing reason (302%).
- `dumpsys activity exit-info com.albion.market.qa` independently records PID 4927, reason 3 `LOW_MEMORY`, importance 100, RSS 2.0 GB and timestamp 07:53:27.680. ActivityManager also records foreground/TOP process death.
- The parent operating the phone reported the question was not sent; the keyboard had opened. This is not a measured long-prompt or generation failure.
- Other LMKD reclamations occurred before this engine was ready. The original non-QA app's reported footprint was small, not evidence of a second loaded model.

RSS plus swapped pages is about 3.63 GiB, but is **not** unique PSS, pure physical RAM or a complete GPU allocation measurement. The vendor LMKD message contains an inconsistent numeric comparison (`5187872kB < 4781504kB`); do not infer an exact exhausted-swap threshold from it. `LOW_MEMORY` and thrashing are independently supported.

A subsequent read of `/proc/meminfo` found MemTotal 7,394,220 kB, MemAvailable 4,096,684 kB, SwapTotal 8,388,604 kB and SwapFree 7,293,728 kB. Those are post-kill values, not free memory at startup or at the kill. A Java GC line reported a relatively small managed heap (12 MB / 37 MB), consistent with native/GPU allocations being important, but not a native allocation profile.

Reproducible read-only sources: `adb logcat -d -v threadtime`, filtering the relevant PID and `LiteRTModule`/`lmkd`/`ActivityManager` records; `adb shell dumpsys activity exit-info com.albion.market.qa`; `adb shell cat /proc/meminfo`; `adb shell getprop ro.product.model` and `ro.hardware`.

## Supported explanation and uncertainty

The engine did initialize. Android killed a foreground process under system memory pressure about 33 seconds after readiness. This is separate from the earlier 10-second startup timeout and the mutable-download integrity failure. There is no evidence here of a Java exception, a malformed question, a proven leak, two concurrent engines, or the keyboard alone being the cause.

The exact model artifact's immutable [manifest](https://huggingface.co/litert-community/Qwen3.5-0.8B/resolve/10243c0a01d24e6b122a0e814f8c4d984c9c92d6/litertlm_manifest.json) and [model card](https://huggingface.co/litert-community/Qwen3.5-0.8B/resolve/10243c0a01d24e6b122a0e814f8c4d984c9c92d6/README.md) explain why a 1.30 GB file can have a much larger runtime footprint:

- The artifact uses int8 dynamic quantization for major decoder/embedding sections, but float operations remain. GPU activations are declared fp32.
- It contains a vision encoder and adapter, and multiple compiled prefill signatures.
- The manifest supports both CPU and GPU and says text-only prompts work with this VL file, a superset of the text build.
- On one Galaxy S26 (SM-S942Q, Qualcomm SM8850, runtime 0.16.0, two cold runs per backend), upstream reports GPU peak 3,772 MB and load 74.4 s versus CPU peak 1,780 MB and load 17.3 s. Decode rates were 34.77 and 32.63 tokens/s. These are upstream measurements on **another phone and runtime**, not S22 predictions or acceptance criteria. CPU and GPU outputs also differed in length/quality in that report.
- A smaller text-only sibling is not an automatic fix: upstream reports a 5,376 MB GPU peak for it on the S26. File size is not runtime memory. Changing to it also changes the template/capabilities and requires another download.

The actual cached 0.17.0 AAR was inspected with `javap`. `EngineConfig` supports `Backend.CPU()`, nullable `visionBackend`, and nullable `maxNumTokens`. Setting `maxNumImages=0` is invalid. The application's JavaScript `MAX_TOKENS=4096` is an estimate for conversation reset, **not** a native allocation limit. Native `maxNumTokens` remains unspecified and the artifact describes a 4096-token context. A lower value is not established as a fix for these compiled GPU graphs, so it is not changed speculatively.

## Minimal source change

1. Qwen3.5's downloaded model card offers a separate **Start CPU · text only** button. Normal Start keeps the existing automatic GPU/vision/fallback behavior. No universal forced CPU policy or device blacklist was introduced.
2. The explicit choice passes through both TypeScript bridges to a native Boolean. CPU/text mode skips construction of the GPU backend and both GPU tiers, creates `Backend.CPU()` with no vision backend, and reports `backendUsed=cpu`, `hasVision=false`. It keeps the exact downloaded file, hash, tool list and conversation parameters. Reset reuses the selected engine.
3. The UI explains that memory savings are not guaranteed and images are disabled in this mode. It shows the actual returned backend/capabilities, including when initialization overlaps a server change. Camera/image buttons and callbacks are gated by actual `hasVision`, not the artifact's potential capability. A stale picker cannot send to a replacement model.
4. The old Qwen3.5 `~2 GB` RAM claim is replaced with a variable CPU/GPU indication. The general Android explanation no longer promises GPU for every mode.
5. Independent review found two older cleanup defects in the initialization guard. In 0.17, `Engine.initialize()` assigns its handle only after native creation returns; `close()` throws before JNI if not initialized. Calling it after a pre-handle failure caused a false quarantine that blocked GPU-to-CPU fallback. Cleanup now checks `isInitialized()`. After successfully closing the vision candidate before fallback, `newEngine` is cleared so a later fallback failure cannot close that old handle twice. Genuine close failures still quarantine. Timeout/interrupt late-worker ownership and the 300-second per-engine-attempt bound are unchanged.

The CPU-mode patch initially preserved the tool list; that did not establish tool compatibility. A later inspection of this exact installed VL artifact found no tool schema/call/result support in its chat template. Qwen's native tool flag is now disabled for both backend modes; other models are unchanged. See [the item-analysis audit](advisor-analysis-audit.md). App-side market data fetching remains available.

## Local validation and remaining device work

- TypeScript typecheck passed.
- 64 targeted tests passed: 26 Advisor callback/state tests, 5 CPU/text bridge and source-contract tests, 4 model registry checks, 4 initialization timeout checks, and 25 existing native lifecycle source checks. These are not real inference tests.
- Android Gradle `:app:testDebugUnitTest` completed successfully in 6m42, including Kotlin compilation and the Android JS bundle dependency, without an APK/install task. `NativeInitializationGateTest` XML at 2026-11-05T13:14:21.239Z records 10 tests, zero failures/errors/skips, including 200 start/cancel races.
- Independent review reran all 64 targeted tests and executed the actual `createInitializedEngine` body with the real gate and a simulated Engine following the AAR's handle contract. All four cases passed: pre-handle failure permits fallback without close; live-handle failure closes then permits fallback; actual close failure quarantines and prevents a new Engine; success keeps the engine alive. This harness does not execute JNI.
- The final source also passes `git diff --check`. Device layout/rendering and real CPU inference remain untested by this worker.
- Direct JVM execution of the AAR cannot run under this workspace's Java 17 because its classes target Java 21. Bytecode inspection is valid independently; no direct AAR JVM test is claimed. Android Kotlin/D8 compilation is a separate check.

The installed APK is unchanged by this work. A coordinated build/install and one CPU/text trial on the S22 remain necessary. Use the already downloaded Qwen3.5 artifact and the explicit new button; record backend/vision logs, readiness time, `dumpsys meminfo`/system pressure before and after readiness, open the keyboard, send a short question, then check a market query and conversation reset. Stop on low-memory kill or instability rather than automatically retrying. Compare cold/warm runs only when safe and under similar background load, without deleting caches or changing RAM Plus/LMKD settings as part of this patch. Confirm UI labels and image-button visibility on the device.

Reasonable alternatives if the CPU trial still fails are a separately verified smaller/compatible model or a lighter runtime/export, each with explicit download/capability tradeoffs and new measurement. Closing unused apps manually may improve headroom for a controlled trial, but is not a product fix. More swap, a larger Java heap, a longer timeout, or suppressing Android's low-memory killer would not establish safe capacity.

### Subsequent CPU trial

Later coordinated S22 QA did start the CPU engine and receive generated text, but the answers gave an incorrect Premium tax rate and repeated an earlier answer. A free follow-up subsequently repeated headings until the existing native inference timeout; the app remained alive. This establishes some CPU execution, not correct analysis, validated tools or measured memory savings. See [the Advisor fee/generation audit](advisor-fee-audit.md) for those separate defects and remaining device checks.
