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
import { formatRouteForPrompt, getFlipRouteInfo, SAFE_ROUTES } from './routes';

export interface MarketContext {
  item: AlbionItem;
  prices: PriceData[];
  history7d: HistoryResponse[];
  history30d: HistoryResponse[];
}

/**
 * System prompt — strict format rules to keep responses short and factual
 */
export function buildSystemPrompt(lang: Language): string {
  const prompts: Record<Language, string> = {
    fr: `Tu es un pote qui connait bien le marché d'Albion Online. Tu parles de façon décontractée et tu vas droit au but. Reste court, quelques lignes max.

Tu as des outils. Quand le joueur parle d'un item, fais TOUJOURS ça dans cet ordre :
1. search_item("nom de l'item") pour trouver l'ID exact
2. get_prices("ID_TROUVÉ") pour les prix actuels
3. Donne ton avis

Autres outils dispo :
- get_history(item_id, jours) : historique des prix
- get_route(ville_depart, ville_arrivée) : danger de la route
- get_time() : date et heure

Réponds en français.`,

    en: `You're a buddy who knows the Albion Online market well. You talk casually and get straight to the point. Keep it short, a few lines max.

You have tools. When the player mentions an item, ALWAYS do this in order:
1. search_item("item name") to find the exact ID
2. get_prices("FOUND_ID") for current prices
3. Give your opinion

Other tools available:
- get_history(item_id, days): price history
- get_route(city_from, city_to): route danger
- get_time(): date and time

Reply in English.`,

    es: `Eres un colega que conoce bien el mercado de Albion Online. Hablas relajado y vas al grano. Sé breve, unas pocas líneas.

Tienes herramientas. Cuando el jugador menciona un item, SIEMPRE haz esto en orden:
1. search_item("nombre del item") para encontrar el ID exacto
2. get_prices("ID_ENCONTRADO") para precios actuales
3. Da tu opinión

Otras herramientas disponibles:
- get_history(item_id, días): historial de precios
- get_route(ciudad_origen, ciudad_destino): peligro de la ruta
- get_time(): fecha y hora

Responde en español.`,
  };

  return prompts[lang];
}

/**
 * Fetch all market data for a given item
 */
export async function fetchMarketContext(
  item: AlbionItem,
  server: Server
): Promise<MarketContext> {
  const cities = [...CITIES] as City[];

  const [prices, history7d, history30d] = await Promise.all([
    fetchCurrentPrices(item.id, cities, server),
    fetchPriceHistory(item.id, cities, formatDateForApi(daysAgo(7)), formatDateForApi(new Date()), 24, server),
    fetchPriceHistory(item.id, cities, formatDateForApi(daysAgo(30)), formatDateForApi(new Date()), 24, server),
  ]);

  return { item, prices, history7d, history30d };
}

/**
 * Pre-compute the best buy/sell/flip from data so the LLM just confirms/comments.
 * This reduces hallucination risk — we give the LLM the answer and ask it to advise.
 */
export function buildAnalysisPrompt(ctx: MarketContext, lang: Language): string {
  const { item, prices, history7d } = ctx;

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
  if (cheapest && priciest && cheapest.city !== priciest.city) {
    const buyAt = cheapest.sell_price_min;
    const sellAt = priciest.buy_price_max;
    const setupBuy = Math.ceil(buyAt * 0.025);
    const setupSell = Math.ceil(sellAt * 0.025);
    const salesTax = Math.ceil(sellAt * 0.04); // assume premium
    const profit = sellAt - buyAt - setupBuy - setupSell - salesTax;
    const margin = buyAt > 0 ? ((profit / buyAt) * 100).toFixed(1) : '0';
    const routeInfo = getFlipRouteInfo(cheapest.city, priciest.city);
    flipInfo = `BEST FLIP: buy ${cheapest.city} at ${buyAt} -> sell ${priciest.city} at ${sellAt} = ${profit} silver profit/unit (${margin}% margin after taxes)\nROUTE: ${routeInfo}`;
  }

  // Price list with timestamps — so the LLM knows data freshness
  const priceList = prices
    .filter((p) => p.sell_price_min > 0 || p.buy_price_max > 0)
    .map((p) => {
      const parts: string[] = [`${p.city}:`];
      if (p.sell_price_min > 0) {
        const age = getDataAge(p.sell_price_min_date);
        parts.push(`sell=${p.sell_price_min} (${age} ago)`);
      } else parts.push('sell=N/A');
      if (p.buy_price_max > 0) {
        const age = getDataAge(p.buy_price_max_date);
        parts.push(`buy=${p.buy_price_max} (${age} ago)`);
      } else parts.push('buy=N/A');
      return parts.join(' ');
    })
    .join('\n');

  // 7d trend — one line per city with raw numbers
  const trendList = history7d
    .filter((h) => h.data.length > 0 && h.data.some((d) => d.avg_price > 0))
    .map((h) => {
      const valid = h.data.filter((d) => d.avg_price > 0);
      if (valid.length === 0) return null;
      const avg = Math.round(valid.reduce((s, d) => s + d.avg_price, 0) / valid.length);
      const last = valid[valid.length - 1].avg_price;
      const vol = valid.reduce((s, d) => s + d.item_count, 0);
      const pct = avg > 0 ? (((last - avg) / avg) * 100).toFixed(0) : '0';
      return `${h.location}: avg=${avg} last=${last} (${pct}%) vol=${vol}`;
    })
    .filter(Boolean)
    .join('\n');

  // Safe route pairs for context
  const safeRoutes = SAFE_ROUTES.map(([a, b]) => `${a}↔${b}`).join(', ');

  const now = new Date();
  const nowStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  return `Voici les données pour ${item.n} (T${item.t}, ${item.c}), récupérées le ${nowStr} :

Prix actuels :
${priceList || 'Aucune donnée'}

Tendance 7 jours :
${trendList || 'Aucune donnée'}

${flipInfo || 'Pas assez de données pour un flip.'}

Routes safe (0 zone rouge) : ${safeRoutes}
Toutes les autres routes passent par des zones rouges.

Qu'est-ce que t'en penses ?`;
}

/**
 * Build a quick question prompt with minimal context
 */
export function buildQuestionPrompt(
  question: string,
  ctx: MarketContext | null,
  lang: Language
): string {
  if (!ctx) return question;

  // Only attach the essentials — cheapest sell and highest buy
  const validSell = ctx.prices.filter((p) => p.sell_price_min > 0);
  const validBuy = ctx.prices.filter((p) => p.buy_price_max > 0);

  const lines: string[] = [`[${ctx.item.n}]`];
  if (validSell.length > 0) {
    const top3 = [...validSell].sort((a, b) => a.sell_price_min - b.sell_price_min).slice(0, 3);
    lines.push('Sell: ' + top3.map((p) => `${p.city}=${p.sell_price_min}`).join(', '));
  }
  if (validBuy.length > 0) {
    const top3 = [...validBuy].sort((a, b) => b.buy_price_max - a.buy_price_max).slice(0, 3);
    lines.push('Buy: ' + top3.map((p) => `${p.city}=${p.buy_price_max}`).join(', '));
  }

  return `${lines.join('\n')}\n\n${question}`;
}

function getDataAge(dateStr: string): string {
  if (!dateStr) return '?';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '<1min';
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
