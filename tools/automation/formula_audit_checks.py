#!/usr/bin/env python3
"""Executable regression checks for Albion market and crafting formulas."""
from pathlib import Path
import subprocess
import textwrap

ROOT = Path(__file__).resolve().parents[2]
OUT = Path('/tmp/albion-formula-audit')
OUT.mkdir(parents=True, exist_ok=True)

subprocess.run([
    'npx', 'tsc', 'lib/calculations.ts', '--target', 'es2020',
    '--module', 'commonjs', '--outDir', str(OUT), '--skipLibCheck',
    '--esModuleInterop',
], cwd=ROOT, check=True)

node_check = OUT / 'check.js'
node_check.write_text(textwrap.dedent(f'''
const calc = require({str((OUT / 'calculations.js')).__repr__()});
function eq(actual, expected, label) {{
  if (actual !== expected) throw new Error(`${{label}}: expected ${{expected}}, got ${{actual}}`);
}}
function close(actual, expected, label) {{
  if (Math.abs(actual - expected) > 1e-9) throw new Error(`${{label}}: expected ${{expected}}, got ${{actual}}`);
}}

// Four independent transaction modes. Fees are rounded once on each whole order.
let direct = calc.calculateMarketplaceProfit(1000, 1500, 10, true, false, false);
eq(direct.setupFeeBuy, 0, 'direct buy setup fee');
eq(direct.setupFeeSell, 0, 'direct sell setup fee');
eq(direct.salesTax, 600, 'direct sales tax');
eq(direct.netProfit, 4400, 'direct profit');
eq(direct.upfrontInvestment, 10000, 'direct upfront investment');

let sellOrder = calc.calculateMarketplaceProfit(1000, 1500, 10, true, false, true);
eq(sellOrder.netProfit, 4025, 'instant buy plus sell order');
eq(sellOrder.upfrontInvestment, 10000, 'sell fee is not upfront capital');

let buyOrder = calc.calculateMarketplaceProfit(1000, 1500, 10, true, true, false);
eq(buyOrder.netProfit, 4150, 'buy order plus instant sale');
eq(buyOrder.upfrontInvestment, 10250, 'buy fee is upfront capital');

let bothOrders = calc.calculateMarketplaceProfit(1000, 1500, 10, true, true, true);
eq(bothOrders.netProfit, 3775, 'buy and sell orders');
eq(bothOrders.upfrontInvestment, 10250, 'both-order upfront capital');

let lot = calc.calculateMarketplaceProfit(101, 101, 10, true, true, true);
eq(lot.setupFeeBuy, 26, 'buy fee rounded on lot');
eq(lot.setupFeeSell, 26, 'sell fee rounded on lot');
eq(lot.salesTax, 41, 'sales tax rounded on lot');

// Station formula remains ItemValue*0.1125*stationTax/100, rounded on total.
let station = calc.calculateCraftingFee(1000, 450, 2);
close(station.nutritionPerItem, 112.5, 'nutrition per item');
close(station.feePerItem, 506.25, 'station fee per item');
eq(station.totalFee, 1013, 'station total fee');

// Recipe sums every ingredient and applies an explicit resource return rate.
let craft = calc.calculateFlippingProfit(
  [
    {{ unitPrice: 100, requiredQuantity: 2, useBuyOrder: true }},
    {{ unitPrice: 50, requiredQuantity: 3, useBuyOrder: false }},
  ],
  1000, 100, 0, 10, true, true, 0.20
);
eq(craft.grossMaterialCost, 3500, 'gross recipe purchase cost before returns');
eq(craft.returnedMaterialValue, 700, 'returned resources valued at purchase cost');
eq(craft.materialCost, 2800, 'economic net material cost after returns');
eq(craft.buyOrderFees, 50, 'buy-order fee charged on gross ingredient order');
eq(craft.marketplace.setupFeeSell, 250, 'finished-product sell order fee');
eq(craft.marketplace.salesTax, 400, 'finished-product sales tax');
eq(craft.totalProfit, 6500, 'craft net profit');
eq(craft.upfrontInvestment, 3550, 'craft upfront investment uses gross purchase capital');
close(craft.roi, (6500 / 3550) * 100, 'craft ROI on upfront capital');

// Inputs fail closed.
craft = calc.calculateFlippingProfit(
  [{{ unitPrice: 100, requiredQuantity: 2, useBuyOrder: false }}],
  1000, 100, 0, 1, true, false, 2
);
eq(craft.resourceReturnRate, 1, 'resource return is clamped to 100%');
eq(craft.materialCost, 0, '100% return consumes no material economically');
console.log('formula numeric checks passed');
'''))
subprocess.run(['node', str(node_check)], cwd=ROOT, check=True)

# UI labels for independent order choices and ROI denominator must be present in
# each locale block; a file-wide occurrence count could conceal a missing locale.
def assert_localized_keys(content: str) -> None:
    languages = ('fr', 'en', 'es')
    expected_keys = ('useBuyOrder:', 'useSellOrder:', 'upfrontInvestment:')
    starts = {language: content.find(f'  {language}: {{') for language in languages}
    if any(position < 0 for position in starts.values()):
        raise AssertionError('missing locale block')
    for index, language in enumerate(languages):
        start = starts[language]
        end = starts[languages[index + 1]] if index + 1 < len(languages) else content.find('\n  },\n} as const;', start)
        if end < 0:
            raise AssertionError(f'{language}: malformed locale block')
        block = content[start:end]
        for key in expected_keys:
            if block.count(key) != 1:
                raise AssertionError(f'{language}: missing localized {key}')

i18n = (ROOT / 'lib' / 'i18n.ts').read_text()
# Negative controls: prove every required key is rejected in every locale block.
for language in ('fr', 'en', 'es'):
    start = i18n.find(f'  {language}: {{')
    next_languages = {'fr': 'en', 'en': 'es'}
    end = i18n.find(f'  {next_languages[language]}: {{', start) if language in next_languages else i18n.find('\n  },\n} as const;', start)
    for key in ('useBuyOrder:', 'useSellOrder:', 'upfrontInvestment:'):
        block = i18n[start:end]
        mutated = i18n[:start] + block.replace(key, f'missing{key[0].upper()}{key[1:]}', 1) + i18n[end:]
        try:
            assert_localized_keys(mutated)
        except AssertionError:
            pass
        else:
            raise AssertionError(f'localization checker accepted missing {language}.{key}')
assert_localized_keys(i18n)

# Advisor regression guard: deterministic market admission must keep authority
# over the language model and must not infer order fees from existing orders.
advisor = (ROOT / 'lib' / 'advisor.ts').read_text()
for needle in (
    'selectCompatibleMarketSignal(',
    'MARKET SIGNAL REJECTED:',
    'OWN ORDER SCENARIOS: not inferred from existing-order prices;',
    'Never recommend BUY/ACHETER/COMPRAR; answer WATCH/SKIP only.',
):
    if needle not in advisor:
        raise AssertionError(f'missing advisor guardrail: {needle}')

print('all formula audit checks passed')
