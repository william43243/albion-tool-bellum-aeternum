import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchMarketContext, buildAnalysisPrompt } from '../lib/advisor';
import type { AlbionItem } from '../lib/items';

// Exercise the actual API/context/prompt path, with HTTP responses simulated.
// These tests establish data flow, not LiteRT tokenization or model accuracy.
const bag: AlbionItem = { id: 'T4_BAG', n: "Adept's Bag", t: '4', c: 'equipment', sc: '', ss: '', iv: 0 };

test('analysis context uses item/server/quality-filtered API observations and builds a distinct item turn', async () => {
  const original = globalThis.fetch;
  const urls: URL[] = [];
  const now = new Date().toISOString();
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input)); urls.push(url);
    if (url.pathname.includes('/prices/')) return new Response(JSON.stringify([
      { item_id: bag.id, city: 'Martlock', quality: 1, sell_price_min: 12345, buy_price_max: 12000, sell_price_min_date: now, buy_price_max_date: now },
      { item_id: bag.id, city: 'Martlock', quality: 5, sell_price_min: 99999 },
      { item_id: 'T4_ROCK', city: 'Martlock', quality: 1, sell_price_min: 77777 },
    ]));
    return new Response(JSON.stringify([
      { item_id: bag.id, location: 'Martlock', quality: 1, data: [{ avg_price: 12500, item_count: 60, timestamp: now }] },
      { item_id: bag.id, location: 'Martlock', quality: 5, data: [{ avg_price: 99999, item_count: 60, timestamp: now }] },
    ]));
  }) as typeof fetch;
  try {
    const ctx = await fetchMarketContext(bag, 'americas');
    assert.equal(urls.length, 3, 'current prices plus 7-day and 30-day history');
    for (const url of urls) {
      assert.equal(url.host, 'west.albion-online-data.com');
      assert.match(url.pathname, /T4_BAG\.json$/);
      assert.equal(url.searchParams.get('qualities'), '1');
    }
    assert.equal(ctx.prices.length, 1);
    assert.equal(ctx.history7d.length, 1);
    assert.equal(ctx.history30d.length, 1);
    const prompt = buildAnalysisPrompt(ctx, 'en', false);
    assert.match(prompt, /^AI_DECISION_INPUT/);
    assert.match(prompt, /Adept's Bag/);
    assert.match(prompt, /Martlock: sell=12345/);
    assert.match(prompt, /avg=12500\.00/);
    assert.match(prompt, /Tax mode: Non-Premium sales tax 8%/);
    assert.doesNotMatch(prompt, /99999|77777|User question: Hello|Greetings/);
  } finally { globalThis.fetch = original; }
});

test('empty API results remain explicit missing data, not a greeting or fabricated prices', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response('[]')) as typeof fetch;
  try {
    const ctx = await fetchMarketContext(bag, 'europe');
    const prompt = buildAnalysisPrompt(ctx, 'en', true);
    assert.match(prompt, /^AI_DECISION_INPUT/);
    assert.match(prompt, /Current prices:\s*No data/);
    assert.match(prompt, /7-day trend:\s*No data/);
    assert.match(prompt, /Not enough data for a flip/);
    assert.doesNotMatch(prompt, /BEST DIRECT FLIP|Hello|Greetings/);
  } finally { globalThis.fetch = original; }
});

test('failed API response rejects the analysis context instead of creating a fallback answer', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
  try { await assert.rejects(fetchMarketContext(bag, 'asia'), /API error: 503/); }
  finally { globalThis.fetch = original; }
});
