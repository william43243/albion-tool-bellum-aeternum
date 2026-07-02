#!/usr/bin/env python3
"""Formula audit checks for Albion marketplace/crafting math.

Sources checked by search snippets/pages:
- Albion Online Wiki / Marketplace: setup fee 2.5%, transaction tax 8%, Premium 4%.
- Albion Online Wiki / Building: usage fee = ((Item Value * 0.1125) * Tax Fee) / 100; nutrition = Item Value * 0.1125.
"""
from pathlib import Path
import subprocess
import textwrap

ROOT = Path(__file__).resolve().parents[2]
OUT = Path('/tmp/albion-formula-audit')
OUT.mkdir(parents=True, exist_ok=True)

subprocess.run([
    'npx', 'tsc', 'lib/calculations.ts',
    '--target', 'es2020',
    '--module', 'commonjs',
    '--outDir', str(OUT),
    '--skipLibCheck',
    '--esModuleInterop',
], cwd=ROOT, check=True)

node_check = OUT / 'check.js'
node_check.write_text(textwrap.dedent(f'''
const calc = require({str((OUT / 'calculations.js')).__repr__()});
function assertEq(actual, expected, label) {{
  if (actual !== expected) {{
    throw new Error(`${{label}}: expected ${{expected}}, got ${{actual}}`);
  }}
}}
function assertClose(actual, expected, label) {{
  if (Math.abs(actual - expected) > 1e-9) {{
    throw new Error(`${{label}}: expected ${{expected}}, got ${{actual}}`);
  }}
}}

// Official current marketplace constants: setup=2.5%, sales tax=8% or Premium 4%.
let r = calc.calculateMarketplaceProfit(1500, 2500, 1, false, true);
assertEq(r.setupFeeBuy, 38, 'nonpremium/order setup buy ceil(1500*2.5%)');
assertEq(r.setupFeeSell, 63, 'nonpremium/order setup sell ceil(2500*2.5%)');
assertEq(r.salesTax, 200, 'nonpremium/order sales tax ceil(2500*8%)');
assertEq(r.netProfit, 699, 'nonpremium/order net profit');

r = calc.calculateMarketplaceProfit(1500, 2500, 1, true, true);
assertEq(r.salesTax, 100, 'premium/order sales tax ceil(2500*4%)');
assertEq(r.netProfit, 799, 'premium/order net profit');

r = calc.calculateMarketplaceProfit(1500, 2500, 1, false, false);
assertEq(r.setupFeeBuy, 0, 'direct setup buy');
assertEq(r.setupFeeSell, 0, 'direct setup sell');
assertEq(r.salesTax, 200, 'direct nonpremium sales tax still applies to sale');
assertEq(r.netProfit, 800, 'direct nonpremium net profit');

// Per-item fee rounding: setup fee is displayed/charged per item; code rounds per unit then multiplies.
r = calc.calculateMarketplaceProfit(101, 199, 3, true, true);
assertEq(r.setupFeeBuy, 9, 'qty setup buy per-item ceil');
assertEq(r.setupFeeSell, 15, 'qty setup sell per-item ceil');
assertEq(r.salesTax, 24, 'qty sales tax per-item ceil');
assertEq(r.netProfit, 246, 'qty net profit');

// Building/crafting official formula: nutrition = IV*0.1125; fee = nutrition*TaxFee/100.
r = calc.calculateCraftingFee(1000, 450, 2);
assertClose(r.nutritionPerItem, 112.5, 'craft nutrition per item');
assertClose(r.feePerItem, 506.25, 'craft fee per item');
assertEq(r.totalNutrition, 225, 'craft total nutrition');
assertEq(r.totalFee, 1013, 'craft total fee ceil total');

r = calc.calculateFlippingProfit(1500, 2500, 1000, 450, 1, true, true);
assertEq(r.marketplace.netProfit, 799, 'flipping marketplace component');
assertEq(r.crafting.totalFee, 507, 'flipping crafting component');
assertEq(r.totalProfit, 292, 'flipping total profit after crafting');
assertEq(r.totalFees, 708, 'flipping total fees');
console.log('formula numeric checks passed');
'''))
subprocess.run(['node', str(node_check)], cwd=ROOT, check=True)

advisor = (ROOT / 'lib/advisor.ts').read_text()
required = [
    'const taxRate = isPremium ? 0.04 : 0.08;',
    'const salesTax = Math.ceil(sellAt * taxRate);',
    'const directProfit = sellAt - buyAt - salesTax;',
    'const setupBuy = Math.ceil(buyAt * 0.025);',
    'const setupSell = Math.ceil(sellAt * 0.025);',
    'const orderProfit = sellAt - buyAt - setupBuy - setupSell - salesTax;',
]
for needle in required:
    if needle not in advisor:
        raise AssertionError(f'missing advisor formula pattern: {needle}')
if 'BEST DIRECT FLIP' not in advisor or 'ORDER SCENARIO' not in advisor:
    raise AssertionError('advisor must distinguish direct API flip from order scenario')

print('advisor formula checks passed')
print('all formula audit checks passed')
