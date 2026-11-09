import { CITIES, type City, type Server } from './api';
import type { MarketContext } from './advisor';
import type { Language } from './i18n';
import { parseAodpTimestamp } from './aodpTime';
import { calculateMarketplaceProfit } from './calculations';
import { assessRouteEligibility } from './routes';

// Explicit screening thresholds, not guarantees of execution or live liquidity.
export const ADVISOR_PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const ADVISOR_HISTORY_MAX_AGE_MS = 48 * 60 * 60 * 1000;
export const ADVISOR_MIN_HISTORY_VOLUME = 15;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SILVER = 2_147_483_647;

export type DecisionReason = 'identity' | 'missing-prices' | 'stale-buy' | 'stale-sell' | 'activity-buy' | 'activity-sell' | 'route' | 'non-positive';
interface Observation { city: City; price: number; timestamp: number; }
export interface AdvisorCandidate {
  buy: Observation; sell: Observation; salesTax: number; netProfit: number;
  buyVolume: number | null; sellVolume: number | null;
  reasons: DecisionReason[];
}
export interface AdvisorDecision {
  status: 'unavailable' | 'loss' | 'zero' | 'unconfirmed' | 'positive-observation';
  server: Server; itemId: string; itemName: string; quality: number; isPremium: boolean; assessedAt: number;
  candidate: AdvisorCandidate | null; pairCount: number; eligiblePairCount: number; rejectedRows: number;
  reasons: DecisionReason[];
}

function timestamp(raw: unknown, now: number): number | null {
  if (typeof raw !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/i.exec(raw);
  if (!match || Number(match[1]) < 2000) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day
    || hour > 23 || minute > 59 || second > 59) return null;
  const parsed = parseAodpTimestamp(raw);
  return Number.isFinite(parsed) && parsed <= now ? parsed : null;
}

function validSilver(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_SILVER;
}

function activity(ctx: MarketContext, city: City, now: number): { volume: number | null; eligible: boolean } {
  const points: { time: number; count: number }[] = [];
  for (const history of Array.isArray(ctx.history7d) ? ctx.history7d : []) {
    if (!history || history.item_id !== ctx.item.id || history.quality !== ctx.quality || history.location !== city || !Array.isArray(history.data)) continue;
    for (const point of history.data) {
      if (!point) continue;
      const time = timestamp(point.timestamp, now);
      if (time === null || now - time > WEEK_MS
        || !Number.isSafeInteger(point.item_count) || point.item_count < 0 || point.item_count > MAX_SILVER
        || !Number.isFinite(point.avg_price) || point.avg_price < 0 || point.avg_price > MAX_SILVER
        || (point.item_count > 0 && point.avg_price === 0)) continue;
      points.push({ time, count: point.item_count });
    }
  }
  const counts = new Map<number, number>();
  for (const point of points) counts.set(point.time, (counts.get(point.time) ?? 0) + 1);
  // Ambiguous duplicate buckets must not inflate activity, even across rows.
  const unique = points.filter((point) => counts.get(point.time) === 1);
  if (!unique.length) return { volume: null, eligible: false };
  const volume = unique.reduce((sum, point) => sum + point.count, 0);
  const latest = Math.max(...unique.map((point) => point.time));
  return { volume, eligible: Number.isSafeInteger(volume) && volume >= ADVISOR_MIN_HISTORY_VOLUME && now - latest <= ADVISOR_HISTORY_MAX_AGE_MS };
}

export function evaluateAdvisorDecision(ctx: MarketContext, server: Server, isPremium: boolean, now = Date.now()): AdvisorDecision {
  const result: AdvisorDecision = {
    status: 'unavailable', server, itemId: ctx.item.id, itemName: ctx.item.n, quality: ctx.quality,
    isPremium, assessedAt: now, candidate: null, pairCount: 0, eligiblePairCount: 0, rejectedRows: 0, reasons: [],
  };
  if (ctx.server !== server || !Number.isFinite(now) || !ctx.item.id || ![1, 2, 3, 4, 5].includes(ctx.quality)) {
    result.reasons = ['identity']; return result;
  }
  const rawRows = Array.isArray(ctx.prices) ? ctx.prices : [];
  const rows = rawRows.filter((row) => row && row.item_id === ctx.item.id && row.quality === ctx.quality && CITIES.includes(row.city as City));
  result.rejectedRows = rawRows.length - rows.length;
  const cityCounts = new Map<string, number>();
  for (const row of rows) cityCounts.set(row.city, (cityCounts.get(row.city) ?? 0) + 1);
  const purchases: Observation[] = []; const sales: Observation[] = [];
  for (const row of rows) {
    if (cityCounts.get(row.city) !== 1) { result.rejectedRows += 1; continue; }
    const purchaseTime = timestamp(row.sell_price_min_date, now);
    const saleTime = timestamp(row.buy_price_max_date, now);
    const purchase = validSilver(row.sell_price_min) && purchaseTime !== null;
    const sale = validSilver(row.buy_price_max) && saleTime !== null;
    if (purchase) purchases.push({ city: row.city as City, price: row.sell_price_min, timestamp: purchaseTime });
    if (sale) sales.push({ city: row.city as City, price: row.buy_price_max, timestamp: saleTime });
    if (!purchase && !sale) result.rejectedRows += 1;
  }
  const candidates: AdvisorCandidate[] = [];
  for (const buy of purchases) for (const sell of sales) {
    const calculation = calculateMarketplaceProfit(buy.price, sell.price, 1, isPremium, false, false);
    const buyActivity = activity(ctx, buy.city, now); const sellActivity = activity(ctx, sell.city, now);
    const reasons: DecisionReason[] = [];
    if (calculation.netProfit <= 0) reasons.push('non-positive');
    if (now - buy.timestamp > ADVISOR_PRICE_MAX_AGE_MS) reasons.push('stale-buy');
    if (now - sell.timestamp > ADVISOR_PRICE_MAX_AGE_MS) reasons.push('stale-sell');
    if (!buyActivity.eligible) reasons.push('activity-buy');
    if (!sellActivity.eligible) reasons.push('activity-sell');
    if (!assessRouteEligibility(buy.city, sell.city).eligible) reasons.push('route');
    candidates.push({ buy, sell, salesTax: calculation.salesTax, netProfit: calculation.netProfit,
      buyVolume: buyActivity.volume, sellVolume: sellActivity.volume, reasons });
  }
  const rank = (a: AdvisorCandidate, b: AdvisorCandidate) => b.netProfit - a.netProfit || a.buy.city.localeCompare(b.buy.city) || a.sell.city.localeCompare(b.sell.city);
  const eligible = candidates.filter((candidate) => candidate.reasons.length === 0).sort(rank);
  result.pairCount = candidates.length; result.eligiblePairCount = eligible.length;
  result.candidate = eligible[0] ?? candidates.sort(rank)[0] ?? null;
  if (!result.candidate) { result.reasons = ['missing-prices']; return result; }
  result.reasons = result.candidate.reasons;
  result.status = eligible.length ? 'positive-observation'
    : result.candidate.netProfit < 0 ? 'loss'
    : result.candidate.netProfit === 0 ? 'zero' : 'unconfirmed';
  return result;
}

export function formatAdvisorDecision(result: AdvisorDecision, lang: Language): string {
  const fr = lang === 'fr'; const es = lang === 'es';
  const labels = {
    title: fr ? "Bilan calculé par l’app, non généré par l’IA." : es ? 'Informe calculado por la app, no generado por IA.' : 'App-calculated report, not AI-generated.',
    notice: fr ? "Les recommandations libres de l’IA sont suspendues pour l’analyse d’item après des contradictions observées." : es ? 'Las recomendaciones libres de IA están suspendidas para el análisis de objetos tras contradicciones observadas.' : 'Free-form AI recommendations are suspended for item analysis after observed contradictions.',
    unavailable: fr ? 'Données insuffisantes ou identité non vérifiée. Aucun signal positif.' : es ? 'Datos insuficientes o identidad no verificada. Sin señal positiva.' : 'Insufficient data or unverified identity. No positive signal.',
    loss: fr ? 'Perte calculée sur la meilleure paire observée. Aucun signal positif.' : es ? 'Pérdida calculada en el mejor par observado. Sin señal positiva.' : 'Calculated loss on the best observed pair. No positive signal.',
    zero: fr ? 'Profit nul sur la meilleure paire observée. Aucun signal positif.' : es ? 'Beneficio cero en el mejor par observado. Sin señal positiva.' : 'Zero profit on the best observed pair. No positive signal.',
    unconfirmed: fr ? 'Marge théorique positive, mais critères non satisfaits. Aucun signal positif.' : es ? 'Margen teórico positivo, pero criterios no cumplidos. Sin señal positiva.' : 'Positive theoretical margin, but screening criteria failed. No positive signal.',
    positive: fr ? 'Marge positive observée répondant aux critères ci-dessous. Ce n’est pas une recommandation d’achat.' : es ? 'Margen positivo observado que cumple los criterios siguientes. No es una recomendación de compra.' : 'Observed positive margin meeting the checks below. This is not a buy recommendation.',
  };
  const reasonText: Record<DecisionReason, string> = fr ? {
    identity: 'serveur/item/qualité non vérifiés', 'missing-prices': 'prix valides et horodatés manquants',
    'stale-buy': 'prix d’achat de plus de 24 h', 'stale-sell': 'prix de vente de plus de 24 h',
    'activity-buy': 'activité d’achat insuffisante, absente ou ancienne', 'activity-sell': 'activité de vente insuffisante, absente ou ancienne',
    route: 'route rouge, absente ou incohérente', 'non-positive': 'profit après taxe inférieur ou égal à zéro',
  } : es ? {
    identity: 'servidor/objeto/calidad sin verificar', 'missing-prices': 'faltan precios válidos con fecha',
    'stale-buy': 'precio de compra de más de 24 h', 'stale-sell': 'precio de venta de más de 24 h',
    'activity-buy': 'actividad de compra insuficiente, ausente o antigua', 'activity-sell': 'actividad de venta insuficiente, ausente o antigua',
    route: 'ruta roja, desconocida o incoherente', 'non-positive': 'beneficio después de impuestos menor o igual a cero',
  } : {
    identity: 'unverified server/item/quality', 'missing-prices': 'missing valid timestamped prices',
    'stale-buy': 'purchase price older than 24 hours', 'stale-sell': 'sale price older than 24 hours',
    'activity-buy': 'purchase-city activity insufficient, missing or old', 'activity-sell': 'sale-city activity insufficient, missing or old',
    route: 'red-zone, missing or inconsistent route', 'non-positive': 'profit after tax is zero or negative',
  };
  const heading = result.status === 'positive-observation' ? labels.positive : labels[result.status];
  const lines = [labels.title, labels.notice, `${result.itemName} (${result.itemId}) | ${result.server} | Q${result.quality} | ${result.isPremium ? 'Premium' : 'Non-Premium'}`, heading];
  if (Number.isFinite(result.assessedAt)) lines.push(`${fr ? 'Bilan établi' : es ? 'Informe calculado' : 'Report calculated'}: ${new Date(result.assessedAt).toISOString()}.`);
  const candidate = result.candidate;
  if (candidate) {
    lines.push(`${fr ? 'Achat instantané' : es ? 'Compra instantánea' : 'Instant purchase'}: ${candidate.buy.city} ${candidate.buy.price} silver (${new Date(candidate.buy.timestamp).toISOString()}).`);
    lines.push(`${fr ? 'Vente instantanée' : es ? 'Venta instantánea' : 'Instant sale'}: ${candidate.sell.city} ${candidate.sell.price} silver (${new Date(candidate.sell.timestamp).toISOString()}).`);
    lines.push(`${fr ? 'Quantité' : es ? 'Cantidad' : 'Quantity'}: 1. ${fr ? 'Taxe de vente' : es ? 'Impuesto de venta' : 'Sales tax'}: ${candidate.salesTax}. ${fr ? 'Frais de création d’ordre' : es ? 'Tarifa de creación de orden' : 'Order setup fees'}: 0.`);
    lines.push(`${fr ? 'Profit calculé' : es ? 'Beneficio calculado' : 'Calculated profit'} = ${candidate.sell.price} − ${candidate.buy.price} − ${candidate.salesTax} = ${candidate.netProfit} silver.`);
    lines.push(`${fr ? 'Volume historique observé sur 7 j' : es ? 'Volumen histórico observado en 7 días' : 'Observed 7-day history volume'}: ${candidate.buy.city}=${candidate.buyVolume ?? '?'}, ${candidate.sell.city}=${candidate.sellVolume ?? '?'}.`);
  }
  if (result.reasons.length) lines.push(`${fr ? 'Limites' : es ? 'Límites' : 'Limits'}: ${result.reasons.map((reason) => reasonText[reason]).join('; ')}.`);
  lines.push(fr
    ? `Critères : prix ≤24 h, volume historique ≥15 par ville sur 7 j avec une observation ≤48 h, route connue sans zone rouge. ${result.pairCount} paires calculables, ${result.eligiblePairCount} répondent aux critères; ${result.rejectedRows} lignes écartées.`
    : es ? `Criterios: precios ≤24 h, volumen histórico ≥15 por ciudad en 7 días con observación ≤48 h, ruta conocida sin zona roja. ${result.pairCount} pares calculables, ${result.eligiblePairCount} cumplen; ${result.rejectedRows} filas descartadas.`
    : `Checks: prices ≤24h, historical volume ≥15 per city over 7 days with an observation ≤48h, known route without red zones. ${result.pairCount} calculable pairs, ${result.eligiblePairCount} pass; ${result.rejectedRows} rows discarded.`);
  lines.push(fr ? 'Sources : observations AODP (cache possible 30 min), calculateur et routes intégrés. Profondeur des ordres, remplissage et coûts de transport non vérifiés. Les volumes passés ne garantissent aucune exécution.'
    : es ? 'Fuentes: observaciones AODP (caché posible de 30 min), calculadora y rutas integradas. Profundidad, ejecución y transporte no verificados. El volumen pasado no garantiza ejecución.'
    : 'Sources: AODP observations (possible 30-minute cache), built-in calculator and routes. Order depth, fills and transport costs are unverified. Past volume does not guarantee execution.');
  lines.push(fr ? 'Comparaison des villes observées, sans trajet ni coût depuis votre position actuelle.'
    : es ? 'Comparación de las ciudades observadas, sin trayecto ni coste desde tu posición actual.'
    : 'Compares observed cities; travel and costs from your current location are not included.');
  return lines.join('\n\n');
}
