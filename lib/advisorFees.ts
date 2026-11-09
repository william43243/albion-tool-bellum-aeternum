import { calculateMarketplaceProfit } from './calculations';
import type { Language } from './i18n';

// Derive the rates from the application's actual calculator, without giving an
// LLM responsibility for either arithmetic or choosing the applicable formula.
// 10,000 silver makes all current percentage fees integral before rounding.
const basis = 10_000;
const premium = calculateMarketplaceProfit(basis, basis, 1, true, true, true);
const standard = calculateMarketplaceProfit(basis, basis, 1, false, true, true);
const percent = (amount: number) => Number((amount / basis * 100).toFixed(4)).toString();
export const MARKETPLACE_FEE_FACTS = Object.freeze({
  premiumSalesTax: percent(premium.salesTax),
  standardSalesTax: percent(standard.salesTax),
  buyOrderSetup: percent(premium.setupFeeBuy),
  sellOrderSetup: percent(premium.setupFeeSell),
  premiumSellOrderTotal: percent(premium.salesTax + premium.setupFeeSell),
  standardSellOrderTotal: percent(standard.salesTax + standard.setupFeeSell),
});

export function buildMarketplaceFeeFacts(isPremium?: boolean): string {
  const f = MARKETPLACE_FEE_FACTS;
  return `APP MARKETPLACE RULES (from the app calculator, not live API data):
Premium sales tax alone: ${f.premiumSalesTax}% of sale revenue. Non-Premium sales tax alone: ${f.standardSalesTax}%.
Creating a buy order adds a separate ${f.buyOrderSetup}% setup fee on the buy order amount; creating a sell order adds a separate ${f.sellOrderSetup}% setup fee on the sell order amount.
Instant transactions create no order and have no setup fee. Premium instant sale: ${f.premiumSalesTax}% sales tax. Premium sell order: ${f.premiumSalesTax}% sales tax + ${f.sellOrderSetup}% setup = ${f.premiumSellOrderTotal}% before silver rounding. ${f.premiumSellOrderTotal}% is NOT the Premium sales tax rate.
Each applicable fee is rounded up separately on the total order amount. A buy-order fee is additional and has its own purchase-price basis.
${isPremium === undefined ? 'Player Premium status: unknown; do not assume it.' : `Current player setting: ${isPremium ? 'Premium' : 'Non-Premium'}. An explicitly requested mode takes precedence for a hypothetical question.`}
These are marketplace fees, not crafting/refining station fees. These rules override conflicting earlier assistant answers. Do not repeat a mistaken earlier rate or substitute remembered or guessed rates.`;
}

/** Narrow FAQ intent only. Complex calculations, item queries and other taxes
 * still go through their normal flow, with the calculator facts attached. */
export function getMarketplaceFeeAnswer(question: string, lang: Language): string | null {
  let normalized = question.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[’']/g, ' ').replace(/[-]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^[¿¡]/, '').replace(/[?!.]+$/, '').trim();
  normalized = normalized.replace(/^what s /, 'what is ')
    .replace(/^(?:what is|what are|how much is|tell me|explain|quelle est|quelles sont|quel est|quels sont|combien est|cual es|cuales son) /, '')
    .replace(/^(?:the|la|le|les|el|los|las|l) /, '')
    .replace(/ (?:in|dans|en) albion(?: online)?$/, '');
  const isFeeQuestion = [
    /^(?:(?:premium|non premium) )?(?:sales tax(?: rate)?|marketplace tax(?: rate)?|setup fees?|marketplace fees|selling fees)(?: (?:premium|non premium|with premium|without premium|for premium))?$/,
    /^(?:taxe de vente|taxe sur les ventes|taux de taxe de vente|frais de mise en vente|frais de creation d ordre)(?: (?:premium|non premium|avec premium|sans premium))?$/,
    /^(?:impuesto de venta|impuesto sobre las ventas|tasa de venta|tarifa de publicacion)(?: (?:premium|no premium|con premium|sin premium))?$/,
    /^is (?:the )?(?:premium|non premium) sales tax(?: rate)? (?:really )?\d{1,2}(?:[.,]\d+)?\s*%$/,
    /^(?:taxe premium|taxe non premium|taxe de vente premium|taxe de vente non premium) est elle (?:de )?\d{1,2}(?:[.,]\d+)?\s*%$/,
  ].some((pattern) => pattern.test(normalized));
  if (!isFeeQuestion) return null;

  const f = MARKETPLACE_FEE_FACTS;
  const nonPremium = /\b(?:non premium|no premium|without premium|sans premium|sin premium)\b/.test(normalized);
  const explicitMode = /\bpremium\b/.test(normalized);
  const mode = nonPremium ? 'Non-Premium' : 'Premium';
  const tax = nonPremium ? f.standardSalesTax : f.premiumSalesTax;
  const total = nonPremium ? f.standardSellOrderTotal : f.premiumSellOrderTotal;
  if (lang === 'fr') return `Règles du calculateur de l’app (réponse non générée par l’IA) : ${explicitMode ? `taxe de vente ${mode} ${tax} %. ` : ''}Les taux sont ${f.premiumSalesTax} % avec Premium et ${f.standardSalesTax} % sans Premium. Créer un ordre ajoute des frais distincts : ${f.buyOrderSetup} % pour un ordre d’achat, ${f.sellOrderSetup} % pour un ordre de vente, sur le montant de cet ordre. Une vente ${mode} par ordre représente donc ${total} % avant arrondis séparés au silver supérieur, mais la taxe seule reste ${tax} %. Une vente instantanée n’a pas de frais de création d’ordre.`;
  if (lang === 'es') return `Reglas de la calculadora de la app (respuesta no generada por IA): ${explicitMode ? `impuesto de venta ${mode} ${tax} %. ` : ''}Las tasas son ${f.premiumSalesTax} % con Premium y ${f.standardSalesTax} % sin Premium. Crear una orden añade una tarifa separada: ${f.buyOrderSetup} % para compra y ${f.sellOrderSetup} % para venta, sobre el importe de esa orden. Una orden de venta ${mode} suma ${total} % antes de redondear cada tarifa hacia arriba, pero el impuesto solo es ${tax} %. La venta instantánea no tiene tarifa de creación de orden.`;
  return `App calculator rules (not an AI-generated answer): ${explicitMode ? `${mode} sales tax is ${tax}%. ` : ''}The rates are ${f.premiumSalesTax}% with Premium and ${f.standardSalesTax}% without Premium. Creating an order adds a separate setup fee: ${f.buyOrderSetup}% for a buy order and ${f.sellOrderSetup}% for a sell order, on that order's amount. A ${mode} sell order therefore totals ${total}% before rounding each fee up to whole silver, but sales tax alone is ${tax}%. An instant sale has no order setup fee.`;
}
