import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSystemPrompt, buildQuestionPrompt, buildAnalysisPrompt, type MarketContext } from '../lib/advisor';
import type { Language } from '../lib/i18n';

const ctx: MarketContext = {
  item: { id: 'T4_ROCK', n: 'Travertine', t: '4', c: 'resource', sc: '', ss: '', iv: 0 },
  prices: [], history7d: [], history30d: [], quality: 1,
};

test('global prompt has no verdict template or fee table in any supported language', () => {
  for (const lang of ['fr', 'en', 'es'] as Language[]) {
    const prompt = buildSystemPrompt(lang, 'europe');
    assert.doesNotMatch(prompt, /VERDICT:|VEREDICTO:|RISKS:|RISQUES:|RIESGOS:|REASON:|4%|8%|6\.5%|WATCH\/SKIP/);
    assert.match(prompt, /normal prose/);
    assert.match(prompt, /Active server: Europe/);
    assert.match(prompt, /search_item.*get_prices\/get_history.*get_route/);
    assert.match(prompt, /If those tools are unavailable/);
    assert.match(prompt, /raw tool prices are not precomputed net profits/);
    assert.match(prompt, /Respect the requested item and city/);
    assert.match(prompt, /Flag stale data, low liquidity and route risk/);
    assert.match(prompt, /third-party community project, not an official Albion Online service/);
    assert.match(prompt, /API does not identify the contributor behind each returned observation/);
    assert.match(prompt, /coverage may be incomplete and does not cover all transactions/);
    assert.match(prompt, /item_count is the aggregated quantity.*not the number of trades or orders and not a silver value/);
  }
});

test('greetings do not receive fees, prices or an unrelated selected item', () => {
  for (const question of ['Hello', 'Hello 👋', 'Hey there', 'Good morning', 'Salut mon ami', 'Hola amigo', 'Hello, how are you?', 'Bonjour !', 'Salut', 'Hola', 'Gracias', 'Merci', 'Thanks!']) {
    for (const context of [null, ctx]) {
      const prompt = buildQuestionPrompt(question, context, 'en', 'Caerleon', true);
      assert.match(prompt, /short normal prose/);
      assert.ok(prompt.endsWith(`User question: ${question}`));
      assert.doesNotMatch(prompt, /APP MARKETPLACE|sales tax|4%|8%|Travertine|Caerleon|Known prices|AI_DECISION_INPUT|VERDICT:|RISKS:/);
    }
  }
});

test('a greeting prefix does not swallow a real market request', () => {
  for (const question of ['Hello, what is the price of T4 rock?', 'Hello 👋, find T4 bags', 'Bonjour, quelle est la meilleure vente ?', 'Hola, compare profits']) {
    const prompt = buildQuestionPrompt(question, ctx, 'en', null, false);
    assert.match(prompt, /Current context: Travertine/);
    assert.ok(prompt.endsWith(`User question: ${question}`));
  }
});

test('only app item analysis carries the requested trading format', () => {
  for (const lang of ['fr', 'en', 'es'] as Language[]) {
    const prompt = buildAnalysisPrompt(ctx, lang, true);
    assert.ok(prompt.startsWith('AI_DECISION_INPUT'));
    assert.match(prompt, /For this item analysis only/);
    assert.match(prompt, /VERDICT:|VEREDICTO:/);
    assert.match(prompt, /RISKS:|RISQUES:|RIESGOS:/);
    assert.match(prompt, /Premium sales tax alone: 4%/);
    assert.match(prompt, /Tax mode: Premium sales tax 4%/);
    assert.match(prompt, /Precomputed values below/);
  }
});

test('free market follow-ups preserve fees/status without forcing verdict headings', () => {
  for (const question of ['And with Premium?', 'What is the non-premium sales tax?', 'Calculate profit after fees',
    'What percentage does the marketplace take?', 'Combien prend le marché ?', 'Qué porcentaje cobra el mercado?', 'What are the listing charges?']) {
    const prompt = buildQuestionPrompt(question, null, 'en', null, false);
    assert.match(prompt, /sales tax alone: 4%/);
    assert.match(prompt, /Non-Premium sales tax alone: 8%/);
    assert.match(prompt, /Current player setting: Non-Premium/);
    assert.match(prompt, /explicitly requested mode takes precedence/);
    assert.doesNotMatch(prompt, /AI_DECISION_INPUT|VERDICT:|RISKS:|WATCH\/SKIP/);
  }
  assert.doesNotMatch(buildQuestionPrompt('Who are you?', null, 'en'), /sales tax|VERDICT:|RISKS:/);
  assert.match(buildQuestionPrompt('How much does Premium cost?', null, 'en'), /do not answer Premium subscription pricing/);
  assert.match(buildQuestionPrompt('What is my crafting station fee?', null, 'en'), /do not answer Premium subscription pricing, crafting fees/);
});
