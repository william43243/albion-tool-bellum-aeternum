export type Language = 'fr' | 'en';

export const translations = {
  fr: {
    // Navigation
    marketplace: 'Marché',
    crafting: 'Craft',
    flipping: 'Flipping',
    history: 'Historique',
    settings: 'Réglages',

    // Common
    premium: 'Premium',
    nonPremium: 'Non-Premium',
    quantity: 'Quantité',
    calculate: 'Calculer',
    result: 'Résultat',
    profit: 'Profit',
    loss: 'Perte',
    fees: 'Frais',
    total: 'Total',
    perItem: 'Par item',
    silver: 'silver',
    copy: 'Copier',
    copied: 'Copié !',
    fetchLive: 'Prix live',
    loading: 'Chargement...',
    error: 'Erreur',
    retry: 'Réessayer',

    // Marketplace
    buyPrice: "Prix d'achat",
    sellPrice: 'Prix de vente',
    useOrders: 'Buy/Sell Orders (limités)',
    directTrade: 'Achat/Vente direct (instant)',
    setupFeeBuy: "Setup Fee (achat)",
    setupFeeSell: "Setup Fee (vente)",
    salesTax: 'Taxe de vente',
    netProfit: 'Profit net',
    feePercentage: '% de frais',
    marginPercentage: '% de marge',
    setupFeeInfo: 'Le Setup Fee (2.5%) est payé à la création de chaque ordre, non remboursable.',
    salesTaxInfo: 'Taxe de vente : 4% (Premium) ou 8% (Non-Premium). Payée lors de la vente.',

    // Crafting
    itemValue: "Valeur de l'item",
    stationTax: 'Taxe station (par 100 nutrition)',
    nutritionPerItem: 'Nutrition par item',
    totalNutrition: 'Nutrition totale',
    craftingFee: 'Frais de craft',
    totalCraftingFee: 'Frais total de craft',
    craftingFeeInfo: 'Le Premium ne réduit PAS les frais de craft, mais donne 10k Focus/jour.',
    selectItem: 'Sélectionner un item',
    manualInput: 'Saisie manuelle',

    // Flipping
    materialCost: 'Coût matériaux',
    productPrice: 'Prix du produit fini',
    craftingCost: 'Coût de craft',
    totalInvestment: 'Investissement total',
    roi: 'ROI',
    flippingInfo: 'Achat matériaux → Craft → Vente du produit fini. Tous les frais inclus.',

    // History
    selectItems: 'Sélectionner item(s)',
    selectCities: 'Sélectionner ville(s)',
    period: 'Période',
    days7: '7 jours',
    days30: '30 jours',
    days90: '90 jours',
    year1: '1 an',
    hourly: 'Horaire',
    daily: 'Journalier',
    avgPrice: 'Prix moyen',
    minPrice: 'Prix min',
    maxPrice: 'Prix max',
    compare: 'Comparer',
    noData: 'Aucune donnée disponible',

    // Settings
    language: 'Langue',
    french: 'Français',
    english: 'English',
    darkMode: 'Mode sombre',
    premiumBonuses: 'Bonus Premium',
    about: 'À propos',
    credits: 'Crédits',
    version: 'Version',

    // Premium bonuses
    premiumBonusList: [
      'Taxe de vente réduite de 50% (8% → 4%)',
      '+10 000 Focus/jour',
      '+50% Rendement de récolte',
      '+100% Rendement farming',
      '+50% Bonus de Fame',
      '+20 Learning Points/jour',
      'Île personnelle accessible',
    ],

    // Server
    server: 'Serveur',
    serverAmericas: 'Amériques',
    serverEurope: 'Europe',
    serverAsia: 'Asie',

    // Cities
    cities: {
      Caerleon: 'Caerleon',
      Bridgewatch: 'Bridgewatch',
      'Fort Sterling': 'Fort Sterling',
      Lymhurst: 'Lymhurst',
      Thetford: 'Thetford',
      Martlock: 'Martlock',
      Brecilien: 'Brecilien',
    },
  },
  en: {
    // Navigation
    marketplace: 'Market',
    crafting: 'Craft',
    flipping: 'Flipping',
    history: 'History',
    settings: 'Settings',

    // Common
    premium: 'Premium',
    nonPremium: 'Non-Premium',
    quantity: 'Quantity',
    calculate: 'Calculate',
    result: 'Result',
    profit: 'Profit',
    loss: 'Loss',
    fees: 'Fees',
    total: 'Total',
    perItem: 'Per item',
    silver: 'silver',
    copy: 'Copy',
    copied: 'Copied!',
    fetchLive: 'Live prices',
    loading: 'Loading...',
    error: 'Error',
    retry: 'Retry',

    // Marketplace
    buyPrice: 'Buy price',
    sellPrice: 'Sell price',
    useOrders: 'Buy/Sell Orders (limit)',
    directTrade: 'Direct buy/sell (instant)',
    setupFeeBuy: 'Setup Fee (buy)',
    setupFeeSell: 'Setup Fee (sell)',
    salesTax: 'Sales Tax',
    netProfit: 'Net Profit',
    feePercentage: 'Fee %',
    marginPercentage: 'Margin %',
    setupFeeInfo: 'Setup Fee (2.5%) is paid when creating each order, non-refundable.',
    salesTaxInfo: 'Sales Tax: 4% (Premium) or 8% (Non-Premium). Paid upon sale.',

    // Crafting
    itemValue: 'Item Value',
    stationTax: 'Station Tax (per 100 nutrition)',
    nutritionPerItem: 'Nutrition per item',
    totalNutrition: 'Total nutrition',
    craftingFee: 'Crafting fee',
    totalCraftingFee: 'Total crafting fee',
    craftingFeeInfo: 'Premium does NOT reduce crafting fees, but gives 10k Focus/day.',
    selectItem: 'Select an item',
    manualInput: 'Manual input',

    // Flipping
    materialCost: 'Material cost',
    productPrice: 'Finished product price',
    craftingCost: 'Crafting cost',
    totalInvestment: 'Total investment',
    roi: 'ROI',
    flippingInfo: 'Buy materials → Craft → Sell product. All fees included.',

    // History
    selectItems: 'Select item(s)',
    selectCities: 'Select city(ies)',
    period: 'Period',
    days7: '7 days',
    days30: '30 days',
    days90: '90 days',
    year1: '1 year',
    hourly: 'Hourly',
    daily: 'Daily',
    avgPrice: 'Avg price',
    minPrice: 'Min price',
    maxPrice: 'Max price',
    compare: 'Compare',
    noData: 'No data available',

    // Settings
    language: 'Language',
    french: 'Français',
    english: 'English',
    darkMode: 'Dark mode',
    premiumBonuses: 'Premium Bonuses',
    about: 'About',
    credits: 'Credits',
    version: 'Version',

    // Premium bonuses
    premiumBonusList: [
      'Sales Tax reduced by 50% (8% → 4%)',
      '+10,000 Focus/day',
      '+50% Gathering yield',
      '+100% Farming yield',
      '+50% Fame Bonus',
      '+20 Learning Points/day',
      'Personal Island access',
    ],

    // Server
    server: 'Server',
    serverAmericas: 'Americas',
    serverEurope: 'Europe',
    serverAsia: 'Asia',

    // Cities
    cities: {
      Caerleon: 'Caerleon',
      Bridgewatch: 'Bridgewatch',
      'Fort Sterling': 'Fort Sterling',
      Lymhurst: 'Lymhurst',
      Thetford: 'Thetford',
      Martlock: 'Martlock',
      Brecilien: 'Brecilien',
    },
  },
} as const;

export type TranslationKey = keyof typeof translations.fr;

export function t(lang: Language, key: TranslationKey): any {
  return translations[lang][key];
}
