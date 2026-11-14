# Local model validation

The device tests below were performed in a combined QA working tree that also contained separate, not-yet-published `/plan` changes. This branch contains only local-model changes; the planner is not part of this commit, and its device scenarios are not reproducible from this branch alone.

The local chat uses a per-model requested context budget. The automatic setting requests 4,000 tokens; it is not a measured model or device limit. Manual requests range from 2,000 to 32,000, subject to verified model limits. The native KV-cache count does not include pending input or guarantee remaining capacity. Automatic compaction may lose details, and tool results and model prose are not interchangeable sources of truth.

## LiteRT-LM version trial

The project retains Android LiteRT-LM **0.17.0**. A QA build with **0.19.1** compiled successfully and its resolved license corpus had zero unresolved entries. On the connected Samsung SM-S901W, Gemma 4 E2B started on GPU with an 8,000-token request, called `plan_gathering`, and answered a follow-up using context. The same session later ignored a T7.1 enchantment constraint and gave incorrect quantities. Another request after compaction used the wrong zone identifier and was rejected by the deterministic planner. The logs recorded parameter types and statuses, not parameter values or conversation text. These observations do not establish whether the model or runtime caused the misinterpretations; they prevent declaring the tool scenarios fully validated. In accordance with the conditional upgrade policy, 0.19.1 was not retained.

With the 0.19.1 QA build and a 4,000-token request, automatic summarization triggered after a multi-turn conversation, explicitly warned that details could be lost, and the model subsequently recalled the test city. An explicit later tool request reached the planner, although its arguments were invalid. Qwen 3.5 0.8B started on CPU and answered a simple greeting. These tests cover one device and do not establish the limits or performance of other phones.

The implementation does not retry a tool automatically during compaction or recovery. A previous conversation is quarantined after a secondary-conversation attempt if rebuilding the replacement fails, because an [upstream report](https://github.com/google-ai-edge/LiteRT-LM/issues/2807) describes possible cache loss in an earlier runtime version. This precaution is not evidence that the same defect occurs on every backend or version.

## Retained 0.17.0 QA build

The ARM64 QA build succeeded and was installed with `adb install -r` using the existing QA signing certificate. Its resolved notices passed the runtime check (219 components and 57 texts). A sequential run of the complete TypeScript suite passed 506/506 tests; an earlier run had a timing-sensitive analytics failure that also passed independently after the build. TypeScript checking and the focused JVM tests for native option validation, compaction fallback and quarantine logic passed.

On the connected SM-S901W, Gemma 4 E2B initialized on GPU with a 4,000-token request and invoked `plan_gathering` once successfully. In a later T7.1 request, it asked what the notation meant instead of applying the filter. After several synthetic turns, automatic summary compaction occurred and the chat accepted further messages. The model did not recall the test city before or after compaction, and subsequent requests did not produce another observed planner invocation. Thus neither perfect recall nor post-compaction tool execution is established for this run. Qwen 3.5 0.8B initialized in CPU text mode and answered a greeting. The QA screen still showed the previously installed model files and selected city after the update; this is not a claim about every stored setting. No fatal AndroidRuntime error was found in the inspected log excerpt.

Model output may still omit filters, invent numbers, or decline to call an available tool; use deterministic application results when exact data matters. Test coverage cannot establish full reliability for every model, backend, device, context size, image or error path.
