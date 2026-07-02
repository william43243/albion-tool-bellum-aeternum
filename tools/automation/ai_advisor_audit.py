#!/usr/bin/env python3
from pathlib import Path
import subprocess, json

ROOT = Path(__file__).resolve().parents[2]
OUT = Path('/tmp/albion-ai-advisor-audit')
OUT.mkdir(parents=True, exist_ok=True)

subprocess.run([
    'npx', 'tsc', 'lib/advisor.ts',
    '--target', 'es2020', '--module', 'commonjs', '--outDir', str(OUT),
    '--skipLibCheck', '--esModuleInterop', '--moduleResolution', 'node', '--resolveJsonModule'
], cwd=ROOT, check=True)

node_check = OUT / 'check_ai_advisor.js'
node_check.write_text(f"""
const advisor = require({json.dumps(str(OUT / 'lib/advisor.js'))});
const now = Date.now();
function isoHoursAgo(h) {{ return new Date(now - h * 3600 * 1000).toISOString(); }}
function assertHas(text, needle, label) {{
  if (!text.includes(needle)) throw new Error(label + ' missing: ' + needle + '\\n--- prompt ---\\n' + text);
}}
function assertRegex(text, rx, label) {{
  if (!rx.test(text)) throw new Error(label + ' missing pattern: ' + rx + '\\n--- prompt ---\\n' + text);
}}
const ctx = {{
  item: {{ id: 'T4_BAG', n: 'Adept Bag', t: 4, c: 'bag', iv: 0 }},
  prices: [
    {{ item_id:'T4_BAG', city:'Caerleon', quality:1, sell_price_min:1000, sell_price_min_date:isoHoursAgo(2), sell_price_max:1000, sell_price_max_date:isoHoursAgo(2), buy_price_min:1, buy_price_min_date:isoHoursAgo(2), buy_price_max:1200, buy_price_max_date:isoHoursAgo(2) }},
    {{ item_id:'T4_BAG', city:'Bridgewatch', quality:1, sell_price_min:900, sell_price_min_date:isoHoursAgo(30), sell_price_max:900, sell_price_max_date:isoHoursAgo(30), buy_price_min:1, buy_price_min_date:isoHoursAgo(1), buy_price_max:1500, buy_price_max_date:isoHoursAgo(1) }},
    {{ item_id:'T4_BAG', city:'Lymhurst', quality:1, sell_price_min:0, sell_price_min_date:'', sell_price_max:0, sell_price_max_date:'', buy_price_min:0, buy_price_min_date:'', buy_price_max:0, buy_price_max_date:'' }},
  ],
  history7d: [
    {{ location:'Caerleon', item_id:'T4_BAG', quality:1, data:[{{ avg_price: 1000, item_count: 2, timestamp: isoHoursAgo(48) }}, {{ avg_price: 1100, item_count: 3, timestamp: isoHoursAgo(24) }}] }},
    {{ location:'Bridgewatch', item_id:'T4_BAG', quality:1, data:[{{ avg_price: 1400, item_count: 1, timestamp: isoHoursAgo(24) }}] }},
  ],
  history30d: []
}};
for (const lang of ['fr','en','es']) {{
  const sys = advisor.buildSystemPrompt(lang, 'europe');
  assertHas(sys, 'Europe', 'system server');
  assertRegex(sys, /VERDICT|Verdict|Veredicto/i, 'system structured verdict');
  assertRegex(sys, /BUY|SKIP|WATCH|ACHETER|ÉVITER|SURVEILLER|COMPRAR|EVITAR|VIGILAR/i, 'system allowed decisions');
  assertRegex(sys, /do not invent|n'invente|no inventes/i, 'system anti-hallucination');
}}
const prompt = advisor.buildAnalysisPrompt(ctx, 'en', true);
assertHas(prompt, 'AI_DECISION_INPUT', 'analysis machine-readable block');
assertHas(prompt, 'Server mode:', 'analysis server/mode context');
assertHas(prompt, 'Premium sales tax 4%', 'analysis premium tax');
assertHas(prompt, 'BEST DIRECT FLIP', 'analysis direct flip');
assertHas(prompt, 'ORDER SCENARIO', 'analysis order scenario');
assertRegex(prompt, /Verdict rules/i, 'analysis verdict rules');
assertRegex(prompt, /stale|freshness|old/i, 'analysis freshness guardrail');
assertRegex(prompt, /liquidity|volume/i, 'analysis liquidity guardrail');
assertRegex(prompt, /Do not recalculate|precomputed/i, 'analysis no recalculation instruction');
const q = advisor.buildQuestionPrompt('Should I buy?', ctx, 'en');
assertRegex(q, /Current context|Server|Premium|Known prices|Data freshness/i, 'question prompt richer context');
console.log('ai advisor prompt checks passed');
""")
subprocess.run(['node', str(node_check)], cwd=ROOT, check=True)
