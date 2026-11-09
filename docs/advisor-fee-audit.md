# Advisor: Premium sales tax confusion

Date: 2026-11-05. On-device QA tested Qwen3.5 CPU on the S22: `What is the Premium sales tax` produced 6.5%; `What is the non-premium sales tax` then repeated that answer. This source investigation did not run inference or modify the installed app.

## Evidence and cause

- `calculateMarketplaceProfit` applies sales tax of 4% with Premium or 8% without Premium. Buy-order and sell-order setup fees are separate, each 2.5% on that order's amount. Each fee rounds up separately.
- Before this patch, `buildSystemPrompt` did not provide these rates. `buildQuestionPrompt` returned the raw question when no item context existed; with context it supplied prices, not the fee rules or current Premium setting.
- The native tools are `search_item`, `get_prices`, `get_history`, `get_route`, and `get_time`. None provides fees. An instruction to use only tools/data did not supply the missing facts or enforce factual output.
- 6.5% equals nominal Premium sales tax plus sell-order setup, but conflation is a plausible explanation, not a proven account of the model's internal reasoning. Repetition of the previous answer is another observed model failure.

## Change

`lib/advisorFees.ts` derives the rates from the application's existing calculator using a 10,000-silver basis, where all current fees are integral. Item-analysis and relevant free-question prompts receive the fee rules, rounding distinction and instruction to override contradictory earlier answers. The initial patch also included them globally; the prompt-isolation follow-up below removes that over-broad injection. Analysis rates use those derived values instead of their previous duplicate literals. No calculator formulas were changed.

Simple fee questions use a narrow deterministic FAQ path, explicitly labeled as app calculator rules and **not AI-generated**. The two exact S22 questions produce distinct Premium 4% and Non-Premium 8% answers. Queries without a mode cite both rates. The explanation distinguishes setup fees and nominal totals from sales tax: at a sale price of 100 silver, Premium sell-order fees are 4 + 3 = 7 silver, not 6.5 silver.

Recognition is bounded to simple FR/EN/ES rate questions and a few direct percentage misconceptions. Amount calculations, multi-intent questions, live market requests, crafting fees and real-world tax questions are not intercepted. The normal readiness, active-stream and request/session guards run before this local response. Local answers neither invoke native inference nor inflate its token count.

The current Premium setting is read when a market fetch finishes and when a question is submitted, so a pending fetch or old callback cannot silently use a pre-toggle setting. The initial prompt token estimate now reflects the actual system prompt length instead of a fixed 250-token estimate; it remains approximate and does not count all native/tool formatting.

## Limits

This fixes a missing source of facts and makes recognized fee FAQs deterministic. It does not guarantee all model output. Other answers are still streamed without a universal factual validator. Complex fee calculations and paraphrases outside the recognizer still rely on the model, with the calculator facts attached.

The local FAQ exchange is displayed in the app but is not added to native conversation history. Relevant subsequent questions receive the fee rules again; ambiguous follow-ups such as `why?` still need evaluation. A recognized FAQ passing on-device is an application-rule test, not proof that the model can reason correctly about taxes or invoke tools.

The rates are the current **app calculator rules**, not a claim of newly verified live game policy. A future game-rate change should update and retest the calculator.

Source checks and callback tests cover the exact questions, FR/EN/ES, false positives, rounding, current Premium settings, delayed fetches, and no inference on recognized FAQs. No APK was rebuilt or installed for this patch; an Android bundle/build and coordinated S22 checks remain separate validation.

Validation: TypeScript typecheck and 62 targeted tests passed (advisorFees, advisorSession, calculations, historyChart and nativeCpuTextMode). Independent review reran the fee/session tests and additional recognition cases; no blocking finding remained for the observed S22 questions. Recognition is deliberately not general: other phrasings may use inference.

## Follow-up: repetitive generation and controlled interruption

On-device QA then tried `And with Premium` after the two local FAQ answers. The generated response repeated REASON/RISKS headings for over a minute and ultimately reported `Native inference timed out`; the app remained alive. This is a failed generated answer, not successful inference established by the earlier FAQ. The ambiguous antecedent was not in native conversation history. That missing history, model limitations or artifact/runtime behavior could contribute; the precise cause of the repetition is not proven.

The code previously supplied no explicit output token limit, relied on the 120-second native inference deadline, offered no Stop button, and discarded partial output on error while leaving the UI marked ready. The following changes address control and recovery, not general answer correctness:

- Both native ConversationConfig instances now set `maxOutputToken=256` (initialization including fallback, and reset). The installed 0.17 AAR's bytecode confirms this value is passed to `nativeCreateConversation`; null previously became -1. No unsupported repetition-penalty parameter was invented. The independent 120-second deadline remains.
- The chat shows the configured output limit and warns that output can be truncated. A token cap does not establish an exact latency, a total bound across all automatic tool calls, or a complete/correct answer.
- A visible Stop button cancels the current stream. Its identity is captured separately from the session so an old Stop callback cannot cancel a newer stream in the same session. Latest partial text comes from a live ref, not an old rendered buffer.
- Stop and stream errors invalidate callbacks before cleanup, preserve partial text with an interruption/incompleteness notice, and attempt one conversation reset before allowing another send. A timeout, cancellation failure or quarantined engine that prevents reset leaves the UI in error. No generated question is retried automatically. Messages, market context and the user's draft remain visible; the model conversation itself is reset.
- Simple questions now explicitly request ordinary short prose rather than item-analysis headings; an unclear follow-up should elicit a clarification. This prompt is guidance, not an enforced factual guarantee.

Validation before device testing: TypeScript typecheck and 77 targeted source/callback tests passed, including latest-token preservation, double Stop, stale Stop, late error during cancellation, failed-reset admission, synchronous send failure, image cancellation and the two native output limits. Android Gradle completed successfully in 5 minutes with the Android JS bundle and Kotlin compilation; NativeInitializationGateTest XML at 2026-11-05T14:39:15.428Z records 10 tests, zero failures/errors/skips. No APK/install task ran. The changes have not yet demonstrated correct inference, actual token termination or successful Stop/reuse on the S22. A coordinated trial must check those outcomes separately and stop if native recovery fails.

## Follow-up: isolate ordinary conversation from item-analysis instructions

Subsequent S22 QA reported that Stop preserved partial output and native generation resumed afterward. The output cap appeared to end generation, but no exact generated-token measurement was supplied. `Hello` still produced repetitive trading verdicts/risks and tax numbers. Those observations validate some interruption/reuse behavior, not model answer quality.

Two concrete sources of irrelevant prompting were present: the global system prompt still contained all the mandatory trading headings, and every free question received the entire fee table. Even with a sentence saying to use ordinary prose, the small model was repeatedly exposed to the unwanted output pattern. This is evidence of inappropriate context, not proof that prompt content is the only cause of the model's behavior.

The system prompt is now ordinary-conversation guidance without a fee table or verdict headings. It retains language, server, requested-item/city scope, freshness/liquidity/risk, factuality and conditional access to live market tools. It explicitly distinguishes raw tool prices from precomputed net profits. Only `buildAnalysisPrompt` includes the item-analysis fields alongside `AI_DECISION_INPUT`.

Free questions use short prose. Fee rules are attached for selected market context or relevant fee/profit/Premium language, including marketplace-percentage paraphrases, with an explicit relevance warning for subscription pricing and crafting fees. Recognized greetings omit even a selected item's prices/taxes. Emoji greetings and mixed greetings plus real market requests are tested separately. Recognition remains lexical and bounded, not a general intent classifier.

`Hello` is still sent to the model; no canned greeting was added. For a fresh English/Americas conversation, the measured system text is 1,320 characters and the `Hello` message is 186 characters. Neither contains a tax rate or a trading output template. Character counts are not exact native token counts.

Local validation: typecheck and 70 targeted tests passed; prompt-mode cases cover FR/EN/ES, social messages with/without selected context, mixed market requests, native-inference admission for Hello, explicit Non-Premium questions, current status and retained item-analysis format. No native runtime setting changed in this prompt-only follow-up.

Device acceptance remains separate: load the new system by restarting/resetting the conversation, then test Hello as actual generation, item analysis, Hello again after analysis, a mixed greeting/market question, and an unrecognized fee question. Expect a short natural greeting without unsolicited tax/verdict text, and a structured analysis only for the item request. Prior native history can still bias later answers, and the 0.8B model may still fail despite correctly scoped prompts. Do not count the deterministic FAQ as passing that inference evaluation.

The subsequent S22 run did produce a greeting for Hello, but item selection returned `Hello.`; after reset, item selection returned `What do you think?`. Item analysis therefore still failed. The [item-analysis diagnostic report](advisor-analysis-audit.md) records transport tests, a separate tool-template capability mismatch, and debug-only traces for the next controlled device check. No generated answer is replaced with local generic analysis.
