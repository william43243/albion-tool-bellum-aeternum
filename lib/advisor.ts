// AI Market Advisor — Prompt builder for LiteRT-LM
// Formats Albion Online API data into structured prompts for on-device LLM

import {
  fetchCurrentPrices,
  fetchPriceHistory,
  formatDateForApi,
  daysAgo,
  CITIES,
  City,
  Server,
  PriceData,
  HistoryResponse,
} from './api';
import { AlbionItem } from './items';
import { Language } from './i18n';
import { assessRouteEligibility, getFlipRouteInfo, SAFE_ROUTES } from './routes';
import { parseAodpTimestamp } from './aodpTime';
import {
  MarketGuardrails,
  selectCompatibleMarketSignal,
} from './marketOpportunity';

export interface MarketContext {
  item: AlbionItem;
  server: Server;
  prices: PriceData[];
  history7d: HistoryResponse[];
  history30d: HistoryResponse[];
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
  if (time === null) return null;
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
  const stats: Record<string, { avg: number; last: number; pct: string; volume: number; liquidity: string }> = {};
  for (const h of history7d) {
    const valid = h.data.filter((d) => d.avg_price > 0);
    if (valid.length === 0) continue;
    const avg = Math.round(valid.reduce((sum, d) => sum + d.avg_price, 0) / valid.length);
    const last = valid[valid.length - 1].avg_price;
    const volume = valid.reduce((sum, d) => sum + d.item_count, 0);
    const pct = avg > 0 ? (((last - avg) / avg) * 100).toFixed(0) : '0';
    stats[h.location] = { avg, last, pct, volume, liquidity: classifyLiquidity(volume) };
  }
  return stats;
}

/**
 * System prompt — strict format rules to keep responses short and factual
 */
export function buildSystemPrompt(lang: Language, server?: string): string {
  const serverInfo = formatServerName(server);

  const common = `
Hard rules:
- Use ONLY the market data in the prompt. Do not invent prices, cities, volumes, fees, or server data.
- The active server is ${serverInfo}. Never mix data from another server.
- The code precomputes taxes, direct-flip profit, freshness, liquidity, quality compatibility, and route admission. Do not recalculate or override them; quote them and reason from them.
- If data is stale, missing, low-volume, quality-incompatible, or the route gate rejects it, the verdict MUST be WATCH/SKIP; never BUY/ACHETER/COMPRAR.
- A MARKET SIGNAL REJECTED block is a deterministic code decision and cannot be overridden.
- Keep answers short, concrete, and actionable. No hype.
- Output the requested structure exactly when AI_DECISION_INPUT is present.`;

  const prompts: Record<Language, string> = {
    fr: `Tu es un conseiller marché Albion Online prudent et factuel.${common}

Format obligatoire pour une analyse d'item :
VERDICT: ACHETER / ÉVITER / SURVEILLER
CONFIANCE: haute / moyenne / basse
SERVEUR: ${serverInfo}
MODE: Premium ou Non-Premium, selon les données
DIRECT FLIP: profit, villes, taxe, fraîcheur
RISQUES: route, fraîcheur, liquidité, spread
RAISON: 1-2 phrases max
ACTION: prix cible ou prochaine vérification

N'invente jamais un chiffre absent. Si les données ne suffisent pas, dis SURVEILLER ou ÉVITER. Réponds en français.`,

    en: `You are a cautious, factual Albion Online market advisor.${common}

Mandatory format for item analysis:
VERDICT: BUY / SKIP / WATCH
CONFIDENCE: high / medium / low
SERVER: ${serverInfo}
MODE: Premium or Non-Premium from the data
DIRECT FLIP: profit, cities, tax, freshness
RISKS: route, freshness, liquidity, spread
REASON: 1-2 short sentences
ACTION: target price or next check

Do not invent any missing number. If data is insufficient, choose WATCH or SKIP. Reply in English.`,

    es: `Eres un asesor prudente y factual del mercado de Albion Online.${common}

Formato obligatorio para analizar un item:
VEREDICTO: COMPRAR / EVITAR / VIGILAR
CONFIANZA: alta / media / baja
SERVIDOR: ${serverInfo}
MODO: Premium o Non-Premium segun los datos
FLIP DIRECTO: ganancia, ciudades, impuesto, frescura
RIESGOS: ruta, frescura, liquidez, spread
RAZON: 1-2 frases cortas
ACCION: precio objetivo o proxima revision

No inventes ningun numero ausente. Si faltan datos, elige VIGILAR o EVITAR. Responde en español.`,
  };

  return prompts[lang];
}

/**
 * Fetch all market data for a given item
 */
export async function fetchMarketContext(
  item: AlbionItem,
  server: Server,
  signal?: AbortSignal
): Promise<MarketContext> {
  const cities = [...CITIES] as City[];

  const [prices, history7d, history30d] = await Promise.all([
    fetchCurrentPrices(item.id, cities, server, 1, { signal }),
    fetchPriceHistory(item.id, cities, formatDateForApi(daysAgo(7)), formatDateForApi(new Date()), 24, server, 1, { signal }),
    fetchPriceHistory(item.id, cities, formatDateForApi(daysAgo(30)), formatDateForApi(new Date()), 24, server, 1, { signal }),
  ]);

  return { item, server, prices, history7d, history30d };
}

/**
 * Pre-compute the best buy/sell/flip from data so the LLM just confirms/comments.
 * This reduces hallucination risk — we give the LLM the answer and ask it to advise.
 */
export function buildAnalysisPrompt(
  ctx: MarketContext,
  lang: Language,
  isPremium: boolean,
  guardrails: MarketGuardrails = { maxAgeHours: 24, minVolume7d: 15 }
): string {
  const { item, prices, history7d, server } = ctx;
  const serverMode = formatServerName(server);
  const taxRate = isPremium ? 0.04 : 0.08;
  const taxMode = isPremium ? 'Premium sales tax 4%' : 'Non-Premium sales tax 8%';

  const trendStats = getTrendStats(history7d);

  const assessment = selectCompatibleMarketSignal(
    prices,
    history7d,
    taxRate,
    Date.now(),
    guardrails
  );

  // AODP observations can support a signal, never guaranteed execution.
  let flipInfo = '';
  if (assessment.status === 'eligible-signal') {
    const routeAssessment = assessRouteEligibility(
      assessment.buyCity || '',
      assessment.sellCity || ''
    );
    if (!routeAssessment.eligible) {
      flipInfo = `MARKET SIGNAL REJECTED: transport gate failed (${routeAssessment.reason}).\nLIMITATIONS: ${assessment.limitations.join(' ')}`;
    } else {
    const buyRecord = prices.find((p) => p.city === assessment.buyCity && p.quality === assessment.quality);
    const sellRecord = prices.find((p) => p.city === assessment.sellCity && p.quality === assessment.quality);
    const directMargin = assessment.buyPrice && assessment.directProfit !== null
      ? ((assessment.directProfit / assessment.buyPrice) * 100).toFixed(1)
      : '0.0';
    const routeInfo = getFlipRouteInfo(assessment.buyCity || '', assessment.sellCity || '');
    flipInfo = `ELIGIBLE MARKET SIGNAL — NOT GUARANTEED EXECUTABLE (${taxMode}): quality=${assessment.quality}; buy ${assessment.buyCity} existing sell order at ${assessment.buyPrice} -> sell ${assessment.sellCity} existing buy order at ${assessment.sellPrice}; profit=${assessment.directProfit} silver/unit; margin=${directMargin}%; sales tax=${assessment.salesTax}; buy freshness=${getFreshnessLabel(buyRecord?.sell_price_min_date || '')}; sell freshness=${getFreshnessLabel(sellRecord?.buy_price_max_date || '')}; observed 7d volumes=${assessment.buyVolume7d}/${assessment.sellVolume7d}.\nOWN ORDER SCENARIOS: not inferred from existing-order prices; use the calculator's independent buy-order and sell-order controls.\nROUTE: ${routeInfo}\nLIMITATIONS: ${assessment.limitations.join(' ')}`;
    }
  } else {
    flipInfo = `MARKET SIGNAL REJECTED: ${assessment.reasons.join('; ') || 'insufficient compatible observations'}.\nLIMITATIONS: ${assessment.limitations.join(' ')}`;
  }

  // Price list with timestamps — so the LLM knows data freshness
  const priceList = prices
    .filter((p) => p.sell_price_min > 0 || p.buy_price_max > 0)
    .map((p) => {
      const parts: string[] = [`${p.city} quality=${p.quality}:`];
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
    .map(([city, stats]) => `${city}: avg=${stats.avg} last=${stats.last} (${stats.pct}%) vol=${stats.volume} liquidity=${stats.liquidity}`)
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
Server mode: ${serverMode}
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
  isPremium: boolean,
  guardrails: MarketGuardrails = { maxAgeHours: 24, minVolume7d: 15 }
): string {
  if (!ctx) return question;

  const taxRate = isPremium ? 0.04 : 0.08;
  const assessment = selectCompatibleMarketSignal(
    ctx.prices,
    ctx.history7d,
    taxRate,
    Date.now(),
    guardrails
  );
  const routeAssessment = assessment.status === 'eligible-signal'
    ? assessRouteEligibility(assessment.buyCity || '', assessment.sellCity || '')
    : { eligible: false, reason: 'market compatibility gate rejected', route: null };
  const eligible = assessment.status === 'eligible-signal' && routeAssessment.eligible;
  const statusLine = eligible
    ? 'FOLLOWUP MARKET STATUS: ELIGIBLE — this remains an observational signal, not guaranteed execution.'
    : `FOLLOWUP MARKET STATUS: REJECTED — ${assessment.reasons.join('; ') || routeAssessment.reason}. Never recommend BUY/ACHETER/COMPRAR; answer WATCH/SKIP only.`;

  const validSell = ctx.prices.filter((p) => p.sell_price_min > 0);
  const validBuy = ctx.prices.filter((p) => p.buy_price_max > 0);
  const trendStats = getTrendStats(ctx.history7d);
  const lines: string[] = [
    statusLine,
    `Current context: ${ctx.item.n}`,
    `Server: ${formatServerName(ctx.server)}`,
    `Premium: ${isPremium ? 'yes' : 'no'}`,
    'Known prices:',
  ];
  if (validSell.length > 0) {
    const top3 = [...validSell].sort((a, b) => a.sell_price_min - b.sell_price_min).slice(0, 3);
    lines.push('Lowest sell: ' + top3.map((p) => `${p.city}/q${p.quality}=${p.sell_price_min} freshness=${getFreshnessLabel(p.sell_price_min_date)}`).join(', '));
  }
  if (validBuy.length > 0) {
    const top3 = [...validBuy].sort((a, b) => b.buy_price_max - a.buy_price_max).slice(0, 3);
    lines.push('Highest buy: ' + top3.map((p) => `${p.city}/q${p.quality}=${p.buy_price_max} freshness=${getFreshnessLabel(p.buy_price_max_date)}`).join(', '));
  }
  const liquidity = Object.entries(trendStats)
    .slice(0, 5)
    .map(([city, stats]) => `${city}:${stats.liquidity}/vol=${stats.volume}`)
    .join(', ');
  lines.push(`Data freshness and liquidity summary: ${liquidity || 'unknown'}`);
  lines.push('The deterministic status above has authority over the language model.');

  return `${lines.join('\n')}\n\nUser question: ${question}`;
}

function getDataAge(dateStr: string): string {
  if (!dateStr) return '?';
  const timestamp = parseAodpTimestamp(dateStr);
  if (timestamp === null) return '?';
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '<1min';
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
