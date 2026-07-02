#!/usr/bin/env python3
from pathlib import Path
import subprocess, json

ROOT = Path(__file__).resolve().parents[2]
OUT = Path('/tmp/albion-server-filter-audit')
OUT.mkdir(parents=True, exist_ok=True)

subprocess.run([
    'npx', 'tsc', 'lib/api.ts', 'lib/advisor.ts',
    '--target', 'es2020', '--module', 'commonjs', '--outDir', str(OUT),
    '--skipLibCheck', '--esModuleInterop', '--moduleResolution', 'node', '--resolveJsonModule'
], cwd=ROOT, check=True)

api_path = json.dumps(str(OUT / 'api.js'))
advisor_path = json.dumps(str(OUT / 'advisor.js'))
node_check = OUT / 'check_server_filter.js'
node_check.write_text(f"""
const api = require({api_path});
const advisor = require({advisor_path});
const calls = [];
global.fetch = async (url) => {{
  calls.push(String(url));
  return {{ ok: true, json: async () => [] }};
}};
(async () => {{
  for (const server of ['americas','europe','asia']) {{
    await api.fetchCurrentPrices('T4_BAG', ['Caerleon'], server);
    await api.fetchPriceHistory('T4_BAG', ['Caerleon'], '7-1-2026', '7-2-2026', 24, server);
    await advisor.fetchMarketContext({{ id: 'T4_BAG', n: 'Adept Bag', t: 4, c: 'bag', iv: 0 }}, server);
  }}
  const expected = {{
    americas: 'https://west.albion-online-data.com/api/v2/stats',
    europe: 'https://europe.albion-online-data.com/api/v2/stats',
    asia: 'https://east.albion-online-data.com/api/v2/stats',
  }};
  for (const [server, base] of Object.entries(expected)) {{
    const matching = calls.filter(u => u.startsWith(base));
    if (matching.length !== 5) throw new Error(server + ' expected 5 calls to ' + base + ', got ' + matching.length + '\\n' + calls.join('\\n'));
  }}
  if (calls.some(u => u.includes('undefined') || u.includes('[object Object]'))) throw new Error('bad URL generated: ' + calls.join('\\n'));
  console.log(JSON.stringify({{ ok: true, calls }}, null, 2));
}})().catch(err => {{ console.error(err.stack || err); process.exit(1); }});
""")
result = subprocess.run(['node', str(node_check)], cwd=ROOT, check=True, text=True, capture_output=True)
print(result.stdout)
print('server filter URL construction checks passed')
