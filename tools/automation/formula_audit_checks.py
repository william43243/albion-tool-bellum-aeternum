#!/usr/bin/env python3
"""Audit the current core formulas without downloading dependencies.

Run: python tools/automation/formula_audit_checks.py [--formulas-only]
Requires Python >= 3.9 and Node >= 22.18 (native TypeScript), or an older Node with
the repository's TypeScript compiler already installed in node_modules.

Exit codes: 0 = requested checks passed; 1 = regression/runtime failure;
2 = unavailable runtime or unresolved legacy advisor checks. --formulas-only
explicitly excludes the legacy advisor checks and can return 0 on that scope.
The legacy strings are retained as a separate check, not silently deleted.
Neither their presence nor a formulas-only pass certifies advisor behavior.

Oracles use the existing contract: 2.5% order setup, 4%/8% sales tax, and
ItemValue * stationTax * quantity * 9/8000 crafting cost. This is not an
independent verification of current game rules, UI, native builds, or rates.
Integer crafting checks cover safe products; decimal inputs have fixed
regressions only, not a claim of arbitrary-precision decimal arithmetic.
"""
import argparse
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap

ROOT = Path(__file__).resolve().parents[2]
LANGUAGES = ('fr', 'en', 'es')
LOCALIZED_KEYS = ('useBuyOrder:', 'useSellOrder:', 'upfrontInvestment:')
LEGACY_ADVISOR_MARKERS = (
    'selectCompatibleMarketSignal(',
    'MARKET SIGNAL REJECTED:',
    'OWN ORDER SCENARIOS: not inferred from existing-order prices;',
    'Never recommend BUY/ACHETER/COMPRAR; answer WATCH/SKIP only.',
)

# No production calculator is used to derive expected fees or threshold prices.
NODE_CHECK = textwrap.dedent(r'''
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const loaded = await import(pathToFileURL(process.argv[2]).href);
const calc = loaded.default ?? loaded;
let assertions = 0;
function eq(actual, expected, label) {
  assertions += 1;
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}
function close(actual, expected, label) {
  assertions += 1;
  if (!Number.isFinite(actual) || !Number.isFinite(expected)
      || Math.abs(actual - expected) > 1e-9) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}
function reject(check, label) {
  try { check(); } catch { return; }
  throw new Error(`negative control accepted ${label}`);
}
reject(() => eq(1, 2, 'unequal integers'), 'unequal integers');
reject(() => close(NaN, 0, 'NaN'), 'NaN');
reject(() => close(Infinity, Infinity, 'Infinity'), 'Infinity');

const ceilDiv = (n, d) => Number((n + d - 1n) / d);
const modes = [
  ['instant-instant', false, false], ['order-instant', true, false],
  ['instant-order', false, true], ['order-order', true, true],
];
function oracle(buy, sell, qty, premium, buyOrder, sellOrder) {
  const revenue = BigInt(sell) * BigInt(qty);
  const cost = BigInt(buy) * BigInt(qty);
  const setupFeeBuy = buyOrder ? ceilDiv(cost, 40n) : 0;
  const setupFeeSell = sellOrder ? ceilDiv(revenue, 40n) : 0;
  const salesTax = ceilDiv(revenue * (premium ? 4n : 8n), 100n);
  const totalFees = setupFeeBuy + setupFeeSell + salesTax;
  const netProfit = Number(revenue - cost) - totalFees;
  return { setupFeeBuy, setupFeeSell, salesTax, totalFees, netProfit,
    profitPerItem: qty > 0 ? netProfit / qty : 0,
    feePercentage: revenue > 0n ? totalFees / Number(revenue) * 100 : 0,
    marginPercentage: cost > 0n ? netProfit / Number(cost) * 100 : 0 };
}

let marketCases = 0;
for (const [mode, buyOrder, sellOrder] of modes) {
  eq(calc.strategyFlags(mode).useBuyOrder, buyOrder, `${mode} buy flag`);
  eq(calc.strategyFlags(mode).useSellOrder, sellOrder, `${mode} sell flag`);
  for (const premium of [false, true]) for (const qty of [0, 1, 2, 10, 999]) {
    for (const buy of [0, 1, 9, 25, 40, 101, 1000]) {
      for (const sell of [0, 1, 9, 40, 101, 200, 201, 1500]) {
        const label = `${mode}/${premium}/${qty}/${buy}/${sell}`;
        const expected = oracle(buy, sell, qty, premium, buyOrder, sellOrder);
        const actual = calc.calculateMarketplaceProfit(buy, sell, qty, premium, buyOrder, sellOrder);
        for (const key of ['setupFeeBuy', 'setupFeeSell', 'salesTax', 'totalFees', 'netProfit']) {
          eq(actual[key], expected[key], `${label} ${key}`);
        }
        for (const key of ['profitPerItem', 'feePercentage', 'marginPercentage']) {
          close(actual[key], expected[key], `${label} ${key}`);
        }
        const flip = calc.calculateFlipProfit(buy, sell, qty, premium, buyOrder, sellOrder);
        const upfront = buy * qty + expected.setupFeeBuy;
        eq(flip.upfrontInvestment, upfront, `${label} upfront capital`);
        eq(flip.totalProfit, expected.netProfit, `${label} flip profit`);
        eq(flip.totalFees, expected.totalFees, `${label} flip fees`);
        eq(flip.marketplace.netProfit, expected.netProfit, `${label} nested marketplace`);
        close(flip.roi, upfront > 0 ? expected.netProfit / upfront * 100 : 0, `${label} ROI`);
        eq('crafting' in flip, false, `${label} flip excludes crafting`);
        marketCases += 1;
      }
    }
  }
}
console.log(`PASS marketplace/flip: ${marketCases} independent rational cases`);

// Exhaustive search on independently computed revenue/cost tables, not a
// binary search: rounded sale fees can make the actual profit non-monotone.
let thresholdCases = 0;
for (const [mode, buyOrder, sellOrder] of modes) {
  for (const premium of [false, true]) for (const qty of [1, 2, 7, 999]) {
    const proceeds = Array.from({ length: 601 }, (_, sell) => oracle(0, sell, qty, premium, false, sellOrder).netProfit);
    const costs = Array.from({ length: 241 }, (_, buy) => -oracle(buy, 0, qty, premium, buyOrder, false).netProfit);
    for (const target of [0, 0.5, 5]) for (let amount = 0; amount <= 240; amount += 1) {
      const label = `${mode}/${premium}/${qty}/${target}/${amount}`;
      const expectedSell = proceeds.findIndex((revenue) => revenue - costs[amount] >= target * qty);
      if (expectedSell < 0) throw new Error(`oracle sale range insufficient: ${label}`);
      eq(calc.breakEvenSellPrice(amount, qty, premium, mode, target), expectedSell, `${label} minimum sale`);
      let expectedBuy = 0; // Current API sentinel when even a free purchase fails.
      for (let buy = 0; buy <= amount; buy += 1) {
        if (proceeds[amount] - costs[buy] >= target * qty) expectedBuy = buy;
      }
      eq(calc.maxBuyPriceForTarget(amount, qty, premium, mode, target), expectedBuy, `${label} maximum purchase`);
      thresholdCases += 2;
    }
  }
}
eq(calc.breakEvenSellPrice(182, 1, true, 'order-order'), 200, 'sale rounding dip');
eq(calc.maxBuyPriceForTarget(9, 1, true, 'instant-instant', 5), 3, 'upper midpoint');
eq(calc.breakEvenSellPrice(182.1, 1, true, 'order-order'), 203, 'fractional purchase');
eq(calc.maxBuyPriceForTarget(9.5, 1, true, 'instant-instant', 5), 3, 'fractional sale');
eq(calc.breakEvenSellPrice(Number.MAX_SAFE_INTEGER, 1, true, 'order-order'), Infinity, 'unrepresentable sale sentinel');
console.log(`PASS thresholds: ${thresholdCases} exhaustive independent comparisons`);

const station = calc.calculateCraftingFee(1000, 450, 2);
close(station.nutritionPerItem, 112.5, 'nutrition per item');
close(station.totalNutrition, 225, 'total nutrition');
close(station.feePerItem, 506.25, 'station fee per item');
eq(station.totalFee, 1013, 'station total fee');
eq(calc.calculateCraftingFee(640, 27, 100).totalFee, 1944, 'exact integer crafting total');
eq(calc.calculateCraftingFee(800, 0.07, 1000).totalFee, 63, 'fractional station tax');
eq(calc.calculateCraftingFee(640.000001, 27, 100).totalFee, 1945, 'genuine fractional excess');
const catalog = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const itemValues = [...new Set(catalog.map((item) => item.iv))].filter((iv) => Number.isSafeInteger(iv) && iv > 0);
if (!itemValues.length) throw new Error('catalog has no usable integer item values');
let craftingCases = 0, unsafeCraftingCases = 0;
for (const iv of itemValues) for (let tax = 0; tax <= 1000; tax += 1) {
  for (const qty of [1, 10, 100, 999]) {
    const numerator = BigInt(iv) * BigInt(tax) * BigInt(qty) * 9n;
    if (numerator > BigInt(Number.MAX_SAFE_INTEGER)) { unsafeCraftingCases += 1; continue; }
    eq(calc.calculateCraftingFee(iv, tax, qty).totalFee, ceilDiv(numerator, 8000n), `craft ${iv}/${tax}/${qty}`);
    craftingCases += 1;
  }
}
console.log(`PASS crafting: ${craftingCases} rational cases across ${itemValues.length} catalog values; ${unsafeCraftingCases} unsafe products outside scope`);

for (const invalid of [NaN, Infinity, -1]) {
  const market = calc.calculateMarketplaceProfit(invalid, invalid, invalid, true, true, true);
  for (const [key, value] of Object.entries(market)) eq(value, 0, `invalid market ${key}`);
  const craft = calc.calculateCraftingFee(invalid, invalid, invalid);
  for (const [key, value] of Object.entries(craft)) eq(value, 0, `invalid crafting ${key}`);
  const flip = calc.calculateFlipProfit(invalid, invalid, invalid, true, true, true);
  eq(flip.upfrontInvestment, 0, 'invalid flip capital');
  eq(flip.roi, 0, 'invalid flip ROI');
  eq(calc.breakEvenSellPrice(invalid, invalid, true, 'order-order', invalid), 0, 'invalid sale threshold');
  eq(calc.maxBuyPriceForTarget(invalid, invalid, true, 'order-order', invalid), 0, 'invalid purchase threshold');
}
eq(calc.calculateMarketplaceProfit(100, 200, 1.9, true, false, false).quantity, 1, 'integer marketplace quantity');
eq(calc.calculateCraftingFee(640, 27, 1.9).quantity, 1, 'integer crafting quantity');
console.log(`PASS numeric checks: ${assertions} assertion calls (including 3 expected-rejection controls)`);
''')


def run_numeric_checks(module_path: Path) -> None:
    node = shutil.which('node')
    if not node:
        raise RuntimeError('Node.js is missing; no software was installed.')
    version = subprocess.run([node, '-p', 'process.versions.node'], check=True,
                             capture_output=True, text=True, timeout=30).stdout.strip()
    major, minor, *_ = (int(part) for part in version.split('.'))
    native_typescript = major >= 23 or (major == 22 and minor >= 18)
    with tempfile.TemporaryDirectory(prefix='albion-formula-audit-') as temporary:
        if native_typescript:
            flags = ['--experimental-strip-types']
            print(f'Runner: Node {version} native TypeScript (not a project typecheck)', flush=True)
        else:
            compiler = ROOT / 'node_modules/typescript/bin/tsc'
            if not compiler.is_file():
                raise RuntimeError(f'Node {version} needs the already-installed local TypeScript compiler, '
                                   'or Node >= 22.18. No download was attempted.')
            subprocess.run([node, str(compiler), str(module_path), '--target', 'es2020',
                            '--module', 'commonjs', '--outDir', temporary, '--skipLibCheck',
                            '--esModuleInterop'], cwd=ROOT, check=True, timeout=120)
            module_path = Path(temporary) / 'calculations.js'
            flags = []
            print(f'Runner: Node {version} with local TypeScript compiler', flush=True)
        subprocess.run([node, *flags, '--input-type=module', '-', str(module_path),
                        str(ROOT / 'assets/items-db.json')], cwd=ROOT, input=NODE_CHECK,
                       text=True, encoding='utf-8', check=True, timeout=120)


def locale_blocks(content: str) -> dict[str, tuple[int, int]]:
    starts = {language: content.find(f'  {language}: {{') for language in LANGUAGES}
    if any(position < 0 for position in starts.values()):
        raise AssertionError('missing locale block')
    blocks = {}
    for index, language in enumerate(LANGUAGES):
        start = starts[language]
        end = starts[LANGUAGES[index + 1]] if index + 1 < len(LANGUAGES) else content.find('\n} as const;', start)
        if end <= start:
            raise AssertionError(f'{language}: malformed locale block')
        blocks[language] = (start, end)
    return blocks


def assert_localized_keys(content: str) -> None:
    for language, (start, end) in locale_blocks(content).items():
        for key in LOCALIZED_KEYS:
            if len(re.findall(r'^\s*' + re.escape(key), content[start:end], re.MULTILINE)) != 1:
                raise AssertionError(f'{language}: missing or duplicate localized {key}')


def check_localizations() -> None:
    i18n = (ROOT / 'lib/i18n.ts').read_text(encoding='utf-8')
    assert_localized_keys(i18n)
    for language, (start, end) in locale_blocks(i18n).items():
        for key in LOCALIZED_KEYS:
            mutated = i18n[:start] + i18n[start:end].replace(key, 'missing_' + key, 1) + i18n[end:]
            try:
                assert_localized_keys(mutated)
            except AssertionError:
                continue
            raise AssertionError(f'localization checker accepted missing {language}.{key}')
    print('PASS localized order/ROI labels: FR/EN/ES, including 9 negative controls', flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--formulas-only', action='store_true', help='Exclude unresolved legacy advisor checks explicitly')
    args = parser.parse_args()
    try:
        run_numeric_checks(ROOT / 'lib/calculations.ts')
        check_localizations()
    except RuntimeError as error:
        print(f'UNAVAILABLE: {error}', file=sys.stderr)
        return 2
    except (AssertionError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(f'FAIL: {error}', file=sys.stderr)
        return 1
    print('Scope: core formulas and locale labels only; game rates, UI, Android and project typecheck not verified.', flush=True)
    if args.formulas_only:
        print('NOT CHECKED: legacy advisor admission guards and AI behavior (--formulas-only).', flush=True)
        return 0
    try:
        advisor = (ROOT / 'lib/advisor.ts').read_text(encoding='utf-8')
    except OSError as error:
        print(f'UNVERIFIED legacy advisor checks: {error}', file=sys.stderr)
        return 2
    missing = [marker for marker in LEGACY_ADVISOR_MARKERS if marker not in advisor]
    for marker in LEGACY_ADVISOR_MARKERS:
        status = 'OBSOLETE/UNVERIFIED: missing' if marker in missing else 'PRESENT: static marker only'
        print(f'Legacy advisor {status}: {marker}', flush=True)
    print('AI behavior is NOT VERIFIED by these static markers.', flush=True)
    if missing:
        print(f'PARTIAL: formulas passed; {len(missing)} unresolved legacy advisor checks. Exit 2.', flush=True)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
