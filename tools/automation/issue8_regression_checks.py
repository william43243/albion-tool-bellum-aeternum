#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]

def read(rel):
    return (ROOT / rel).read_text(encoding='utf-8')

def assert_true(cond, msg):
    if not cond:
        raise AssertionError(msg)

advisor = read('lib/advisor.ts')
llm = read('lib/llm.ts')
webllm = read('lib/webllm.ts')
api = read('lib/api.ts')
server = read('analytics/server.js')
app = read('App.tsx')
advisor_screen = read('screens/AdvisorScreen.tsx')
flipping = read('screens/FlippingScreen.tsx')
marketplace = read('screens/MarketplaceScreen.tsx')
history = read('screens/HistoryScreen.tsx')

assert_true("admin auth not configured" in server, "admin auth missing fail-closed response")
missing_token_block = re.search(r"if \(!ADMIN_TOKEN\) \{(?P<body>.*?)\n\s*\}", server, re.S)
assert_true(missing_token_block and "return next()" not in missing_token_block.group('body'), "ADMIN_TOKEN missing still returns next()")
assert_true("authorization" in server.lower() and "bearer" in server.lower(), "admin auth should accept Authorization: Bearer token")

assert_true("assume premium" not in advisor, "advisor still documents hardcoded premium assumption")
assert_true(re.search(r"buildAnalysisPrompt\([^)]*isPremium", advisor, re.S), "buildAnalysisPrompt must accept isPremium")
assert_true("0.08" in advisor and "Non-Premium" in advisor, "advisor must include non-premium tax path/context")
assert_true("buildAnalysisPrompt(ctx, lang, isPremium)" in advisor_screen, "AdvisorScreen must pass isPremium to buildAnalysisPrompt")

assert_true("const [isPremium, setIsPremium]" in app, "App must own premium state")
assert_true("isPremium={isPremium}" in app and "onPremiumChange={setIsPremium}" in app, "App must pass premium state/change handlers")
assert_true("const [isPremium, setIsPremium]" not in marketplace, "MarketplaceScreen should not own local premium state")
assert_true("const [isPremium, setIsPremium]" not in flipping, "FlippingScreen should not own local premium state")

assert_true("type CancelToken" in llm, "llm.ts must use cancellation token")
assert_true("callbacks.onError" in llm and ".catch" in llm, "llm.ts web async import failures must call callbacks.onError")
assert_true("interruptGenerate" in webllm, "webllm cleanup should try engine.interruptGenerate()")

assert_true("MAX_CACHE_ENTRIES" in api and "pruneCache" in api, "api cache must be bounded and pruned")
assert_true("delete cache[key]" in api, "api cache must delete expired/old entries")

assert_true("sampled.push(sampled[sampled.length - 1]" not in history, "history chart still flatlines missing data by repeating last sample")
assert_true("hasTruncatedSeries" in history or "truncated" in history.lower(), "history chart should expose truncation/missing-data handling")

assert_true("isPremium" in advisor_screen.split("interface Props",1)[1].split("}",1)[0], "AdvisorScreen Props must include isPremium")
assert_true("previousServerRef" in advisor_screen or "prevServer" in advisor_screen, "AdvisorScreen should guard/reset on server changes")
assert_true(re.search(r"handleStartModel[\s\S]*\[[^\]]*server", advisor_screen), "handleStartModel dependencies must include server")
assert_true(re.search(r"handleItemSelect[\s\S]*\[[^\]]*sendToLLM", advisor_screen), "handleItemSelect dependencies must include sendToLLM")

print("issue8 regression checks passed")
