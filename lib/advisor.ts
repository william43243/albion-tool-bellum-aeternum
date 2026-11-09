// AI Market Advisor — Prompt builder for LiteRT-LM
// Formats Albion Online API data into structured prompts for on-device LLM

import {
  fetchCurrentPrices,
  fetchPriceHistory,
  formatDateForApi,
  daysAgo,
  CITIES,
  type City,
  type Server,
  type PriceData,
  type HistoryResponse,
  type Quality,
} from './api';
import type { AlbionItem } from './items';
import type { Language } from './i18n';
import { parseAodpTimestamp, weightedAverage } from './aodpTime';
import { formatRouteForPrompt, getFlipRouteInfo, SAFE_ROUTES } from './routes';
import { buildMarketplaceFeeFacts, MARKETPLACE_FEE_FACTS } from './advisorFees';

export interface MarketContext {
  /** Provenance attached by the API request, never inferred from the prices. */
  server?: Server;
  item: AlbionItem;
  prices: PriceData[];
  history7d: HistoryResponse[];
  history30d: HistoryResponse[];
  quality: Quality;
}

function formatServerName(server?: string): string {
  const serverNames: Record<string, string> = {
    americas: 'Americas (US West)',
    europe: 'Europe',
    asia: 'Asia',
  };
  return server ? serverNames[server] || server : 'unknown';
}

function getFreshnessHours(dateStr: string): number | null {
  if (!dateStr) return null;
  const time = parseAodpTimestamp(dateStr);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, (Date.now() - time) / 3600000);
}

function getFreshnessLabel(dateStr: string): string {
  const hours = getFreshnessHours(dateStr);
  if (hours === null) return 'unknown';
  if (hours < 1) return 'fresh:<1h';
  if (hours <= 6) return `fresh:${hours.toFixed(1)}h`;
  if (hours <= 24) return `aging:${hours.toFixed(1)}h`;
  return `stale:${(hours / 24).toFixed(1)}d old`;
}

function classifyLiquidity(volume7d: number): string {
  if (volume7d >= 50) return 'high';
  if (volume7d >= 15) return 'medium';
  if (volume7d >= 5) return 'low';
  return 'very-low';
}

function getTrendStats(history7d: HistoryResponse[]) {
  const stats: Record<string, { avg: number | null; last: number; pct: string | null; volume: number; liquidity: string }> = {};
  for (const h of history7d) {
    const valid = h.data.filter((d) => d.avg_price > 0);
    if (valid.length === 0) continue;
    const avg = weightedAverage(valid);
    const last = valid[valid.length - 1].avg_price;
    const volume = valid.reduce((sum, d) => sum + d.item_count, 0);
    const pct = avg !== null ? (((last - avg) / avg) * 100).toFixed(0) : null;
    stats[h.location] = { avg, last, pct, volume, liquidity: classifyLiquidity(volume) };
  }
  return stats;
}

/**
 * Shared conversation guidance. Item-analysis formats belong to that turn only.
 */
export function buildSystemPrompt(lang: Language, server?: string): string {
  const language = { fr: 'French', en: 'English', es: 'Spanish' }[lang];
  return `You help with Albion Online. Reply in ${language}.
Respond to the current message naturally and briefly. For greetings or ordinary conversation, do not add unsolicited market advice, numbers or analysis.
Use an item-analysis output format only when the app supplies AI_DECISION_INPUT and its format in the current message. Otherwise use normal prose, usually 1-3 short sentences.
If a follow-up has no clear antecedent, ask one clarifying question. Do not repeat an unrelated earlier answer.
For market questions, use only observations supplied by the app or returned by available tools. Never invent prices, volumes, fees or tool results. Say when information is missing.
Treat AODP as a third-party community project, not an official Albion Online service. Its client uploads market observations captured while participating players browse markets; the API does not identify the contributor behind each returned observation. Describe values as reported by AODP, not as complete market truth. Price and history coverage may be incomplete and does not cover all transactions. In daily history, item_count is the aggregated quantity of items represented in reported observations, not the number of trades or orders and not a silver value.
Respect the requested item and city; obtain missing relevant observations or state they are missing. Flag stale data, low liquidity and route risk rather than making unsupported trade recommendations.
For a live item request without supplied observations, use available tools: search_item first, then get_prices/get_history; get_route for routes. If those tools are unavailable, say which data is missing rather than claiming a tool call.
Respect the app's calculator rules and precomputed results when supplied; raw tool prices are not precomputed net profits. Do not substitute remembered rates.
Active server: ${formatServerName(server)}. Never mix servers.`;
}

function buildItemAnalysisFormat(lang: Language): string {
  const formats: Record<Language, string> = {
    fr: 'VERDICT: ACHETER / ÉVITER / SURVEILLER\nCONFIANCE: haute / moyenne / basse\nSERVEUR: serveur actif\nMODE: Premium ou Non-Premium selon les données\nDIRECT FLIP: profit, villes, taxe, fraîcheur\nRISQUES: route, fraîcheur, liquidité, spread\nRAISON: 1-2 phrases\nACTION: prix cible ou prochaine vérification',
    en: 'VERDICT: BUY / SKIP / WATCH\nCONFIDENCE: high / medium / low\nSERVER: active server\nMODE: Premium or Non-Premium from the data\nDIRECT FLIP: profit, cities, tax, freshness\nRISKS: route, freshness, liquidity, spread\nREASON: 1-2 sentences\nACTION: target price or next check',
    es: 'VEREDICTO: COMPRAR / EVITAR / VIGILAR\nCONFIANZA: alta / media / baja\nSERVIDOR: servidor activo\nMODO: Premium o Non-Premium según los datos\nFLIP DIRECTO: ganancia, ciudades, impuesto, frescura\nRIESGOS: ruta, frescura, liquidez, spread\nRAZÓN: 1-2 frases\nACCIÓN: precio objetivo o próxima revisión',
  };
  return `For this item analysis only, use each requested field once. Keep it concise; do not repeat sections.\n${formats[lang]}`;
}

function isSocialMessage(question: string): boolean {
  const text = question.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF\uFE0F\u200D]/gu, ' ')
    .replace(/[?!.,¿¡]/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(?:(?:hello|hi|hey|bonjour|salut|bonsoir|hola)(?: (?:there|mon ami|amigo|amiga))?(?: (?:how are you|comment ca va|como estas))?|good morning|good afternoon|good evening|how are you|comment ca va|como estas|merci|thanks|thank you|gracias|buenos dias|buenas tardes)$/.test(text);
}

function needsMarketplaceFeeFacts(question: string): boolean {
  const text = question.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const marketCharges = /\b(?:marketplace|market|marche|mercado)\b/.test(text)
    && /\b(?:percentage|percent|commission|commissions|charges?|listing|takes?|pourcentage|pourcent|preleve|prend|porcentaje|cobra|cobran)\b/.test(text);
  if (marketCharges || /\blisting charges?\b/.test(text)) return true;
  return /\b(?:tax|taxes|fee|fees|premium|profit|margin|order|orders|sell|selling|buy|buying|flip|taxe|frais|impot|impots|benefice|marge|ordre|ordres|acheter|achat|vendre|vente|impuesto|impuestos|tarifa|tarifas|comision|beneficio|margen|orden|ordenes|comprar|compra|vender|venta)\b/.test(text);
}

/**
 * Fetch all market data for a given item
 */
export async function fetchMarketContext(
  item: AlbionItem,
  server: Server,
  quality: Quality = 1
): Promise<MarketContext> {
  const cities = [...CITIES] as City[];

  const [prices, history7d, history30d] = await Promise.all([
    fetchCurrentPrices(item.id, cities, server, quality),
    fetchPriceHistory(item.id, cities, formatDateForApi(daysAgo(7)), formatDateForApi(new Date()), 24, server, quality),
    fetchPriceHistory(item.id, cities, formatDateForApi(daysAgo(30)), formatDateForApi(new Date()), 24, server, quality),
  ]);

  return { server, item, prices, history7d, history30d, quality };
}

/**
 * Pre-compute the best buy/sell/flip from data so the LLM just confirms/comments.
 * This reduces hallucination risk — we give the LLM the answer and ask it to advise.
 */
export function buildAnalysisPrompt(
  ctx: MarketContext,
  lang: Language,
  isPremium: boolean,
  playerCity: City | null = null
): string {
  const { item, prices, history7d } = ctx;
  const serverMode = 'server already selected by app/API layer';
  const taxPercent = isPremium ? MARKETPLACE_FEE_FACTS.premiumSalesTax : MARKETPLACE_FEE_FACTS.standardSalesTax;
  const taxRate = Number(taxPercent) / 100;
  const taxMode = `${isPremium ? 'Premium' : 'Non-Premium'} sales tax ${taxPercent}%`;

  const trendStats = getTrendStats(history7d);

  // Find best buy (lowest sell_price_min) and best sell (highest buy_price_max)
  const validSell = prices.filter((p) => p.sell_price_min > 0);
  const validBuy = prices.filter((p) => p.buy_price_max > 0);

  const cheapest = validSell.length > 0
    ? validSell.reduce((a, b) => (a.sell_price_min < b.sell_price_min ? a : b))
    : null;
  const priciest = validBuy.length > 0
    ? validBuy.reduce((a, b) => (a.buy_price_max > b.buy_price_max ? a : b))
    : null;

  // Compute flip margin if both exist
  let flipInfo = '';
  if (cheapest && priciest) {
    const buyAt = cheapest.sell_price_min;
    const sellAt = priciest.buy_price_max;
    const salesTax = Math.ceil(sellAt * taxRate);
    const directProfit = sellAt - buyAt - salesTax;
    const directMargin = buyAt > 0 ? ((directProfit / buyAt) * 100).toFixed(1) : 0;
    const setupBuy = Math.ceil(buyAt * (Number(MARKETPLACE_FEE_FACTS.buyOrderSetup) / 100));
    const setupSell = Math.ceil(sellAt * (Number(MARKETPLACE_FEE_FACTS.sellOrderSetup) / 100));
    const orderProfit = sellAt - buyAt - setupBuy - setupSell - salesTax;
    const orderMargin = buyAt > 0 ? ((orderProfit / buyAt) * 100).toFixed(1) : 0;
    const routeInfo = getFlipRouteInfo(cheapest.city, priciest.city);
    const buyFreshness = getFreshnessLabel(cheapest.sell_price_min_date);
    const sellFreshness = getFreshnessLabel(priciest.buy_price_max_date);
    const buyLiquidity = trendStats[cheapest.city]?.liquidity || 'unknown';
    const sellLiquidity = trendStats[priciest.city]?.liquidity || 'unknown';
    const spread = sellAt - buyAt;
    flipInfo = `BEST DIRECT FLIP (${taxMode}): buy ${cheapest.city} sell order at ${buyAt} -> sell ${priciest.city} buy order at ${sellAt} = ${directProfit} silver profit/unit (${directMargin}% margin after sales tax; no setup fee because no order is created; spread=${spread}; buy freshness=${buyFreshness}; sell freshness=${sellFreshness}; buy liquidity=${buyLiquidity}; sell liquidity=${sellLiquidity})\nORDER SCENARIO: if you create buy/sell orders at these prices, setup fees apply too: ${orderProfit} silver profit/unit (${orderMargin}% margin)\nROUTE: ${routeInfo}`;
  }

  // Price list with timestamps — so the LLM knows data freshness
  const priceList = prices
    .filter((p) => p.sell_price_min > 0 || p.buy_price_max > 0)
    .map((p) => {
      const parts: string[] = [`${p.city}:`];
      if (p.sell_price_min > 0) {
        const age = getDataAge(p.sell_price_min_date);
        const freshness = getFreshnessLabel(p.sell_price_min_date);
        parts.push(`sell=${p.sell_price_min} (${age} ago; ${freshness})`);
      } else parts.push('sell=N/A');
      if (p.buy_price_max > 0) {
        const age = getDataAge(p.buy_price_max_date);
        const freshness = getFreshnessLabel(p.buy_price_max_date);
        parts.push(`buy=${p.buy_price_max} (${age} ago; ${freshness})`);
      } else parts.push('buy=N/A');
      return parts.join(' ');
    })
    .join('\n');

  // 7d trend — one line per city with raw numbers and liquidity classification
  const trendList = Object.entries(trendStats)
    .map(([city, stats]) => `${city}: avg=${stats.avg?.toFixed(2) ?? 'unknown'} last=${stats.last} (${stats.pct === null ? 'unknown trend' : `${stats.pct}%`}) vol=${stats.volume} liquidity=${stats.liquidity}`)
    .join('\n');

  // Safe route pairs for context
  const safeRoutes = SAFE_ROUTES.map(([a, b]) => `${a}↔${b}`).join(', ');

  const now = new Date();
  const nowStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  const templates: Record<Language, {
    header: string; prices: string; trend: string; noData: string;
    noFlip: string; safe: string; allRed: string; opinion: string;
  }> = {
    fr: {
      header: `Voici les données pour ${item.n} (T${item.t}, ${item.c}), récupérées le ${nowStr} :`,
      prices: 'Prix actuels :', trend: 'Tendance 7 jours :', noData: 'Aucune donnée',
      noFlip: 'Pas assez de données pour un flip.',
      safe: 'Routes safe (0 zone rouge)', allRed: 'Toutes les autres routes passent par des zones rouges.',
      opinion: "Qu'est-ce que t'en penses ?",
    },
    en: {
      header: `Here is the data for ${item.n} (T${item.t}, ${item.c}), retrieved on ${nowStr}:`,
      prices: 'Current prices:', trend: '7-day trend:', noData: 'No data',
      noFlip: 'Not enough data for a flip.',
      safe: 'Safe routes (0 red zones)', allRed: 'All other routes pass through red zones.',
      opinion: 'What do you think?',
    },
    es: {
      header: `Aquí están los datos para ${item.n} (T${item.t}, ${item.c}), obtenidos el ${nowStr}:`,
      prices: 'Precios actuales:', trend: 'Tendencia 7 días:', noData: 'Sin datos',
      noFlip: 'No hay suficientes datos para un flip.',
      safe: 'Rutas seguras (0 zonas rojas)', allRed: 'Todas las otras rutas pasan por zonas rojas.',
      opinion: '¿Qué opinas?',
    },
  };
  const tpl = templates[lang];

  return `AI_DECISION_INPUT
${buildItemAnalysisFormat(lang)}

${buildMarketplaceFeeFacts(isPremium)}

Server mode: ${serverMode}
Quality: ${ctx.quality} (never mix with enchantment/tier)
Player current city: ${playerCity || 'unknown — do not assume location'}
Tax mode: ${taxMode}
Precomputed values below. Do not recalculate; use them for verdict only.
Verdict rules: BUY only if direct profit is clearly positive, data freshness is not stale, liquidity is medium/high, and route risk is acceptable. WATCH if data is stale/low-volume or spread is thin. SKIP if profit is negative after taxes/fees or route/liquidity risk dominates.
Freshness guardrail: stale/old prices (>24h) reduce confidence to low and usually mean WATCH.
Liquidity guardrail: very-low/low volume means risk of not filling; prefer WATCH/SKIP unless margin is exceptional.

${tpl.header}

${tpl.prices}
${priceList || tpl.noData}

${tpl.trend}
${trendList || tpl.noData}

${flipInfo || tpl.noFlip}

${tpl.safe} : ${safeRoutes}
${tpl.allRed}

${tpl.opinion}`;
}

/**
 * Build a quick question prompt with minimal context
 */
export function buildQuestionPrompt(
  question: string,
  ctx: MarketContext | null,
  lang: Language,
  playerCity: City | null = null,
  isPremium?: boolean
): string {
  const directReply = 'Answer the current question directly in short normal prose. Do not create an item analysis unless requested. Ask a brief clarification if the question is ambiguous.';
  // This only changes context selection; the model still generates the reply.
  if (isSocialMessage(question)) return `${directReply}\n\nUser question: ${question}`;
  const feeFacts = ctx || needsMarketplaceFeeFacts(question) ? `Use the following rules ONLY if relevant to marketplace fees or profit. They do not answer Premium subscription pricing, crafting fees or unrelated questions.\n${buildMarketplaceFeeFacts(isPremium)}` : '';
  if (!ctx) return `${directReply}\n${feeFacts}\n\nUser question: ${question}`;

  // Attach compact current context so follow-up answers stay grounded.
  const validSell = ctx.prices.filter((p) => p.sell_price_min > 0);
  const validBuy = ctx.prices.filter((p) => p.buy_price_max > 0);
  const trendStats = getTrendStats(ctx.history7d);

  const lines: string[] = [
    directReply,
    feeFacts,
    `Player current city: ${playerCity || 'unknown — do not assume location'}`,
    `Current context: ${ctx.item.n}`,
    'Known prices:',
  ];
  if (validSell.length > 0) {
    const top3 = [...validSell].sort((a, b) => a.sell_price_min - b.sell_price_min).slice(0, 3);
    lines.push('Lowest sell: ' + top3.map((p) => `${p.city}=${p.sell_price_min} freshness=${getFreshnessLabel(p.sell_price_min_date)}`).join(', '));
  }
  if (validBuy.length > 0) {
    const top3 = [...validBuy].sort((a, b) => b.buy_price_max - a.buy_price_max).slice(0, 3);
    lines.push('Highest buy: ' + top3.map((p) => `${p.city}=${p.buy_price_max} freshness=${getFreshnessLabel(p.buy_price_max_date)}`).join(', '));
  }
  const liquidity = Object.entries(trendStats)
    .slice(0, 5)
    .map(([city, stats]) => `${city}:${stats.liquidity}/vol=${stats.volume}`)
    .join(', ');
  lines.push(`Data freshness and liquidity summary: ${liquidity || 'unknown'}`);
  lines.push('Use relevant supplied observations only. If requested information is missing, say so or ask one clarification; do not invent an analysis verdict.');

  return `${lines.join('\n')}\n\nUser question: ${question}`;
}

function getDataAge(dateStr: string): string {
  if (!dateStr) return '?';
  const timestamp = parseAodpTimestamp(dateStr);
  if (!Number.isFinite(timestamp)) return '?';
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '<1min';
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
