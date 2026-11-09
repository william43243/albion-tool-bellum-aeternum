# Android model download failure audit

Date: 2026-11-05 UTC. App: 2.0.8-beta.5.11, versionCode 17. Device: Galaxy S22 (SM-S901W).

## Confirmed failure

The UI reported a failed Qwen3.5 0.8B download after the last observed progress was 90.7%. Read-only ADB inspection established that the transfer actually completed, then the app correctly rejected an artifact that did not match its registry.

Device logcat (device-local timestamps):

```text
11-04 21:42:06.209 I LiteRTModule: Download enqueued: qwen35-08b (id=62)
11-04 21:45:57.767 D DownloadManager: [62] Finished with status SUCCESS
11-04 21:45:57.967 E LiteRTModule: Downloaded model failed integrity verification
11-04 21:45:57.967 E LiteRTModule: java.lang.IllegalStateException: Downloaded model size mismatch
11-04 21:45:57.967 E LiteRTModule: at com.albion.market.litert.ModelArtifactVerifier.importAndPromote(ModelArtifactVerifier.kt:36)
```

`dumpsys activity provider com.android.providers.downloads/.DownloadProvider` retained Download #62 with `status=200`, `numfailed=0`, `total_bytes=1303671472`, `current_bytes=1303671472`, and `errorMsg=null`. The URL was the Qwen3.5 `/resolve/main/` URL. Disk inspection showed about 210 GB available. The shown 90.7% was not a terminal network status.

The registry expected **1,302,262,448 bytes** and SHA-256 **e3360b658c929ff35ab740a21f5e4b688096a72e351b8d347e26ccda314121b7**. Hugging Face now serves **1,303,671,472 bytes** and SHA-256 **1ab56460263fe94fde5fec160363d3aacbae9c5ee3638121c11feb51e483e29d** from `main`. Those two artifacts cannot pass the same verification.

Root cause: a mutable download URL combined with fixed expected size and SHA-256. The integrity check is necessary and must not be weakened. The generic UI error conceals the distinction between a transfer failure and an integrity failure.

## Upstream evidence

- [Current Qwen3.5 file metadata](https://huggingface.co/api/models/litert-community/Qwen3.5-0.8B?blobs=true)
- [Qwen3.5 revision history](https://huggingface.co/api/models/litert-community/Qwen3.5-0.8B/commits/main)
- Upstream changed the Qwen3.5 artifact on October 12 and October 16, 2026. The November 2 current repository revision includes later documentation changes; it is not the date the artifact changed.
- The other Qwen model has the same latent failure: Qwen2.5 `main` currently serves 1,597,922,856 bytes / `c4a9b7289365ab80fe599b844b77ad253eb3c53fb0e5d963d699146a6f01255e`, while this app expects 1,597,931,520 bytes / `faa60663b333290c1496c499828b21d3e3254a788cacd8cce917ce0f761a2dc9`.
- [Qwen2.5 revision history](https://huggingface.co/api/models/litert-community/Qwen2.5-1.5B-Instruct/commits/main) identifies an October 11 metadata/template update for runtime 0.18.0. This app declares LiteRT-LM 0.17.0.

## Fix and verification

All five Android URLs now use immutable repository commits. Existing sizes, hashes, filenames and intended model versions are preserved. HEAD requests to every final pinned URL returned matching `X-Repo-Commit`, `X-Linked-Size` and `X-Linked-ETag` on 2026-11-05:

| Model | Pinned commit | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Qwen3.5 0.8B | 10243c0a01d24e6b122a0e814f8c4d984c9c92d6 | 1302262448 | e3360b658c929ff35ab740a21f5e4b688096a72e351b8d347e26ccda314121b7 |
| Qwen2.5 1.5B | 19edb84c69a0212f29a6ef17ba0d6f278b6a1614 | 1597931520 | faa60663b333290c1496c499828b21d3e3254a788cacd8cce917ce0f761a2dc9 |
| DeepSeek R1 1.5B | 9fd875541bb0f277e4b3cefe7d9622c4c1de2fb5 | 1833451520 | 69b35f01759eed765641ab4af589bbe98131fd2825662a086d9037409b8c1295 |
| Gemma 4 E2B | c658da437244f072bf2f1cabc916b60d66d97663 | 2588147712 | 181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c |
| Gemma 4 E4B | e6a3892a8c22cf87ff99583996149cf3cb32452b | 3659530240 | 0b2a8980ce155fd97673d8e820b4d29d9c7d99b8fa6806f425d969b145bd52e0 |

The Qwen3.5 SHA-256 and size were also cross-checked against the versioned Hugging Face API. A CDN/Xet object's ETag is not necessarily the file SHA-256; use the origin's `X-Linked-ETag` or API `lfs.sha256` instead.

Regression tests enforce immutable Android URLs, filename consistency and the exact preserved Qwen artifact tuples. The old test called Qwen3.5 immutable but checked only filename and size, allowing `/main` to slip through.

## Limits and next validation

- No download was restarted, no phone data was changed, no build was installed and no model payload was fetched during this diagnosis. Network checks used HEAD or small public JSON metadata responses.
- Metadata checks prove URL/size/hash consistency; they do not prove an end-to-end install or inference run on the S22. The app's full-file integrity check remains authoritative.
- Retaining the original intended Qwen3.5 artifact is a conservative compatibility fix, not an upgrade. Upstream notes that newer artifacts fix quantization/arithmetic and tokenizer issues. Updating to a newer model should be a separate explicit runtime/inference validation, including numerical/tool-use behavior.
- The UI should eventually distinguish integrity failure from network failure and retain expected/actual sizes for diagnostics. This patch does not change the download lifecycle or UI.

## Follow-up: cold engine initialization on the S22 QA build

The parent QA run subsequently downloaded and verified the pinned Qwen3.5 model in `com.albion.market.qa`. Logcat confirms `Download verified and promoted` at 23:41:05 on November 4 (device-local time), with exactly 1,302,262,448 bytes.

Starting that model then failed for a separate reason: the four engine initialization calls inherited the generic **10,000 ms** lifecycle timeout. The native cold startup was still doing useful GPU work when the wrapper rejected it:

- 23:42:15: the JNI library loads and LiteRT starts creating the environment.
- 23:42:24: OpenCL initializes and delegates the first `prefill_1024` graph.
- 23:42:25: the app rejects `engine initialization timed out after 10000ms`.
- 23:42:50 through 23:43:32: the same native thread continues compiling further prefill graphs and the decode graph.
- The parent subsequently observed accelerator destruction at about 23:43:39, consistent with late-result cleanup. That is not evidence of a successful chat or inference.

The timeout fix gives all four engine-initialization paths a separate bounded **300,000 ms** cold-start budget. It does not change the 10-second close/cancel defaults, conversation deadlines, or backend choice. The observed work lasted over a minute, so treating it like a short lifecycle operation was incorrect. Five minutes is a conservative bound per engine attempt, not a measured promise of successful startup or a global bound over multiple non-timeout fallback attempts. Reset/destroy can still wait for the lifecycle mutex during initialization; this is not immediate native cancellation.

A process-wide initialization gate also addresses the demonstrated retry hazard. JNI can ignore the interrupt issued by `Future.cancel(true)`, so a cancelled Future is not evidence that native work ended. An initialization lease now remains held until its coroutine and all actual workers (including late resource cleanup) have finished. A retry is rejected immediately with a wait/restart message while that ownership remains unresolved. Cancelling an unstarted worker or rejecting executor submission retires only that reservation; cancelling an already-started worker cannot release it. Failed native cleanup quarantines the lease until process restart, and subsequent fallback engine construction is also prohibited. An interrupted caller follows the same fail-closed path as a timeout rather than launching a fallback alongside its old JNI job. Late conversation-creation failure now closes its candidate engine once the native operation really ends.

Diagnosis used read-only logs only. No new model download, inference, UI action, installation or phone data change was performed by the diagnosis worker. Source regression tests check all four budgets and retained timeout safeguards. Pure JVM tests exercise the gate with real threads, cancellation, ignored interrupts and delayed/failed cleanup; they do not execute LiteRT or JNI. The corrected APK still needs a separate on-device start and inference validation.

### Subsequent on-device result

The parent later observed successful engine readiness with that APK, followed by an Android low-memory kill before sending a question. See [the S22 memory audit](s22-memory-audit.md) for separate evidence, the explicit CPU/text option, cleanup corrections found during review, and the remaining device validation. Successful initialization is not yet successful inference.
