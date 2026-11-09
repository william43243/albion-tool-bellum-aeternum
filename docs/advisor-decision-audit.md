# Qwen item recommendations: calculated guardrail

Date: 2026-11-05. The diagnostic S22 run reported `tools=0`, matching JS/native SHA-256 input fingerprints, `analysis=true`, and a 503-character output. It used a Bridgewatch purchase of 3,796 and Thetford sale of 2,993, computed negative profit, then concluded `The verdict is clear: BUY.` Transport and tool configuration therefore do not establish coherent inference. A correct arithmetic sentence does not make the recommendation correct.

## Reproduced calculation

The existing canonical `calculateMarketplaceProfit(3796, 2993, 1, true, false, false)` gives Premium sales tax `ceil(2993 × 4%) = 120`, no setup fees for two instant actions, and `2993 − 3796 − 120 = −923` silver. Non-Premium tax is 240 and profit is −1,043. The built-in Bridgewatch/Thetford direct route also fails the zero-red-zone screening rule. None of these observations supports a positive trade signal.

## Explicitly limited change

Only registry model `qwen35-08b` now has `itemAnalysisMode: calculator-only`. Its description, chat banner and each report explain that selecting an item produces an app-calculated report, not generated analysis. The same restriction applies to the existing item-query shortcut because it calls the same item-selection path. All other models retain their existing generated item-analysis flow; their reliability has not been established by this change.

The Qwen item path does not start inference, expose generated fragments, ask the model to choose a verdict, filter recommendation words, or silently rewrite BUY into SKIP. It publishes a deterministic report from observations and the existing calculator. There is no fabricated AI success, and local reports do not increase the native token estimate. The report explicitly says free-form item recommendations are suspended after observed contradictions.

Free Qwen chat and image messages remain model-generated and may still give incorrect or contradictory recommendations. They have a persistent warning plus a warning on displayed model messages and streaming output. A follow-up such as `What about this item?` is outside the calculated-report guarantee. This is a scoped mitigation, not a general safety or accuracy guarantee for the Advisor. Local reports are not inserted into native conversation history; current market context continues to accompany normal questions as before.

## Deterministic evidence checks

`lib/advisorDecision.ts` uses the existing calculator after validating inputs, rather than relying on its sanitizer: otherwise an infinite purchase price could be sanitized to zero and create a false profit. It handles one unit with instant purchase from an existing sell order and instant sale into an existing buy order. It does not model new-order strategies or execution depth.

- `fetchMarketContext` explicitly attaches the requested server. A missing/mismatched server, wrong item or quality, unknown city, or ambiguous duplicate price row cannot create an eligible candidate. Price values must be positive whole silver within the supported integer range.
- Dates must be valid calendar timestamps, not sentinel, missing, malformed or future values. Offset-free AODP dates are UTC. Both price observations must be at most 24 hours old to pass screening. This horizon is an explicit screening policy, not a claim that a 24-hour-old quote is executable.
- Activity is assessed separately in both cities using valid matching history within seven days. Positive historical averages may be fractional. Valid zero-volume buckets remain zero rather than unknown. Invalid/future/duplicated buckets do not inflate activity. Screening requires at least 15 observed units per city and a valid observation within 48 hours. This is an activity proxy, not current order depth or a guarantee of filling.
- `assessRouteEligibility` supplies the existing deterministic route checks: same-city or known internally consistent route with zero red zones. Unknown, inconsistent, red-zone and Brecilien routes do not pass. No safe alternative route is invented.
- Every calculable pair is assessed before selection. An inadmissible stale extreme cannot hide a lower-margin pair that satisfies the checks. The highest-profit eligible pair is selected, otherwise the highest-profit calculable pair is shown with blocking reasons. A loss, zero profit, missing data and a positive margin with failed checks are distinct states.
- Even an eligible positive margin is described as an observed theoretical margin, explicitly not a buy recommendation. The report includes item/server/quality/Premium mode, calculation time, source quote timestamps, exact tax/profit, activity, rejection reasons and pair counts. Transport costs from the player's current position, order depth and fills remain unverified. AODP's possible 30-minute app cache is disclosed.

## Validation and remaining work

Tests cover the exact −923/−1043 counterexample, zero versus missing data, non-finite inputs, invalid/future dates, freshness boundaries, server/item/quality mismatches, duplicate cities, missing/invalid/zero/fractional-average activity, risky routes and stale extreme selection. Production callback tests verify that Qwen selection cannot call the model or leak generated recommendation fragments, uses the latest Premium setting after a delayed fetch, labels calculator provenance and leaves token count unchanged. A real other-model branch still sends the full analysis to the mocked native bridge, and free Qwen chat remains native output with a warning.

These are data/control/UI-source tests, not S22 UI or inference validation. A local calculated report passing does not demonstrate that Qwen has learned to analyze markets. The installed app is unchanged until a coordinated build/install. Verify the visible restriction and source labels, the real negative report, current mode/timestamps, stale/missing data and free-chat warnings on-device before calling this mitigation delivered there.

Local validation at the final code freeze: TypeScript typecheck and 92 targeted tests passed; `git diff --check` was clean apart from line-ending notices. No Kotlin/runtime setting changed in this lot, and no Gradle/APK/install task was run for it. Independent numerical review compared 1,200 generated datasets (58,800 city pairs) to a BigInt fee oracle with zero discrepancies, plus boundary/adversarial cases for timestamps, activity, duplicates and routes. These results establish deterministic behavior on the checked inputs, not live market execution or general AI reliability.

Final independent review reran 62 tests, 25 additional numerical/boundary cases and nine additional UI callback scenarios, including stale results after server/back/reset/unmount/model changes, newest-selection wins and API failure. It found no remaining blocker in the Qwen-only scope. The production-file hashes remained unchanged through that review.
