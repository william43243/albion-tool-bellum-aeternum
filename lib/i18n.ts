export type Language = 'fr' | 'en' | 'es';

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
    spanish: 'Español',
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

    // AI Advisor
    advisor: 'IA',
    advisorTitle: 'Conseiller IA',
    advisorDescription: "Analyse les prix du marché en temps réel grâce à l'IA embarquée (LiteRT-LM). Sélectionne un item pour obtenir des recommandations d'achat/vente.",
    advisorInit: "Démarrer l'IA",
    advisorLoading: 'Chargement du modèle...',
    advisorLoadingHint: "Première fois : ~10-30s selon le téléphone.\nLe modèle se charge en mémoire avec accélération GPU.",
    advisorReady: "IA prête. Sélectionne un item pour lancer l'analyse, ou pose une question.",
    advisorError: "Erreur de chargement de l'IA",
    advisorModelNeeded: 'Modèle IA requis',
    advisorModelInstructions: "Le modèle Gemma (~2.5 GB) doit être téléchargé séparément.\nCopiez le fichier .litertlm dans le chemin ci-dessous :",
    advisorPlaceholder: 'Pose une question sur le marché...',
    advisorAnalyzing: 'Analyse de',
    advisorFetchingData: 'Récupération des données...',

    // Donate
    donate: 'Faire un don',
    donateText: "Si cette app t'aide, tu peux soutenir le développement avec un don BTC :",
    tapToCopy: 'Appuie pour copier',
    copiedAlert: 'Copié !',
    copiedMsg: 'Adresse BTC copiée dans le presse-papier',
    referenceFormulas: 'Formules de référence',
    priceData: 'Données de prix : Albion Online Data Project',
    notAffiliated: 'Non affilié à Sandbox Interactive',

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
    spanish: 'Español',
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

    // AI Advisor
    advisor: 'AI',
    advisorTitle: 'AI Advisor',
    advisorDescription: 'Analyze real-time market prices with on-device AI (LiteRT-LM). Select an item to get buy/sell recommendations.',
    advisorInit: 'Start AI',
    advisorLoading: 'Loading model...',
    advisorLoadingHint: 'First time: ~10-30s depending on device.\nModel loads into memory with GPU acceleration.',
    advisorReady: 'AI ready. Select an item to start analysis, or ask a question.',
    advisorError: 'AI loading error',
    advisorModelNeeded: 'AI model required',
    advisorModelInstructions: 'The Gemma model (~2.5 GB) must be downloaded separately.\nCopy the .litertlm file to the path below:',
    advisorPlaceholder: 'Ask about the market...',
    advisorAnalyzing: 'Analyzing',
    advisorFetchingData: 'Fetching market data...',

    // Donate
    donate: 'Donate',
    donateText: 'If this app helps you, you can support development with a BTC donation:',
    tapToCopy: 'Tap to copy',
    copiedAlert: 'Copied!',
    copiedMsg: 'BTC address copied to clipboard',
    referenceFormulas: 'Reference Formulas',
    priceData: 'Price data: Albion Online Data Project',
    notAffiliated: 'Not affiliated with Sandbox Interactive',

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
  es: {
    // Navigation
    marketplace: 'Mercado',
    crafting: 'Fabricación',
    flipping: 'Flipping',
    history: 'Historial',
    settings: 'Ajustes',

    // Common
    premium: 'Premium',
    nonPremium: 'No Premium',
    quantity: 'Cantidad',
    calculate: 'Calcular',
    result: 'Resultado',
    profit: 'Ganancia',
    loss: 'Pérdida',
    fees: 'Comisiones',
    total: 'Total',
    perItem: 'Por item',
    silver: 'silver',
    copy: 'Copiar',
    copied: '¡Copiado!',
    fetchLive: 'Precios en vivo',
    loading: 'Cargando...',
    error: 'Error',
    retry: 'Reintentar',

    // Marketplace
    buyPrice: 'Precio de compra',
    sellPrice: 'Precio de venta',
    useOrders: 'Órdenes Buy/Sell (límite)',
    directTrade: 'Compra/Venta directa (instantánea)',
    setupFeeBuy: 'Setup Fee (compra)',
    setupFeeSell: 'Setup Fee (venta)',
    salesTax: 'Impuesto de venta',
    netProfit: 'Ganancia neta',
    feePercentage: '% de comisiones',
    marginPercentage: '% de margen',
    setupFeeInfo: 'El Setup Fee (2.5%) se paga al crear cada orden, no reembolsable.',
    salesTaxInfo: 'Impuesto de venta: 4% (Premium) u 8% (No Premium). Se paga al vender.',

    // Crafting
    itemValue: 'Valor del item',
    stationTax: 'Impuesto estación (por 100 nutrición)',
    nutritionPerItem: 'Nutrición por item',
    totalNutrition: 'Nutrición total',
    craftingFee: 'Coste de fabricación',
    totalCraftingFee: 'Coste total de fabricación',
    craftingFeeInfo: 'El Premium NO reduce los costes de fabricación, pero da 10k Focus/día.',
    selectItem: 'Seleccionar un item',
    manualInput: 'Entrada manual',

    // Flipping
    materialCost: 'Coste de materiales',
    productPrice: 'Precio del producto final',
    craftingCost: 'Coste de fabricación',
    totalInvestment: 'Inversión total',
    roi: 'ROI',
    flippingInfo: 'Comprar materiales → Fabricar → Vender producto. Todas las comisiones incluidas.',

    // History
    selectItems: 'Seleccionar item(s)',
    selectCities: 'Seleccionar ciudad(es)',
    period: 'Período',
    days7: '7 días',
    days30: '30 días',
    days90: '90 días',
    year1: '1 año',
    hourly: 'Por hora',
    daily: 'Diario',
    avgPrice: 'Precio medio',
    minPrice: 'Precio mín',
    maxPrice: 'Precio máx',
    compare: 'Comparar',
    noData: 'No hay datos disponibles',

    // Settings
    language: 'Idioma',
    french: 'Français',
    english: 'English',
    spanish: 'Español',
    darkMode: 'Modo oscuro',
    premiumBonuses: 'Bonificaciones Premium',
    about: 'Acerca de',
    credits: 'Créditos',
    version: 'Versión',

    // Premium bonuses
    premiumBonusList: [
      'Impuesto de venta reducido un 50% (8% → 4%)',
      '+10.000 Focus/día',
      '+50% Rendimiento de recolección',
      '+100% Rendimiento de granja',
      '+50% Bonus de Fama',
      '+20 Puntos de aprendizaje/día',
      'Acceso a Isla personal',
    ],

    // Server
    server: 'Servidor',
    serverAmericas: 'Américas',
    serverEurope: 'Europa',
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

    // AI Advisor
    advisor: 'IA',
    advisorTitle: 'Consejero IA',
    advisorDescription: 'Analiza precios del mercado en tiempo real con IA en el dispositivo (LiteRT-LM). Selecciona un item para obtener recomendaciones.',
    advisorInit: 'Iniciar IA',
    advisorLoading: 'Cargando modelo...',
    advisorLoadingHint: 'Primera vez: ~10-30s según el dispositivo.\nEl modelo se carga en memoria con aceleración GPU.',
    advisorReady: 'IA lista. Selecciona un item para iniciar el análisis, o haz una pregunta.',
    advisorError: 'Error al cargar la IA',
    advisorModelNeeded: 'Modelo IA requerido',
    advisorModelInstructions: 'El modelo Gemma (~2.5 GB) debe descargarse por separado.\nCopia el archivo .litertlm en la ruta de abajo:',
    advisorPlaceholder: 'Pregunta sobre el mercado...',
    advisorAnalyzing: 'Analizando',
    advisorFetchingData: 'Obteniendo datos del mercado...',

    // Donate
    donate: 'Donar',
    donateText: 'Si esta app te ayuda, puedes apoyar el desarrollo con una donación BTC:',
    tapToCopy: 'Toca para copiar',
    copiedAlert: '¡Copiado!',
    copiedMsg: 'Dirección BTC copiada al portapapeles',
    referenceFormulas: 'Fórmulas de referencia',
    priceData: 'Datos de precios: Albion Online Data Project',
    notAffiliated: 'No afiliado a Sandbox Interactive',
  },
} as const;

export type TranslationKey = keyof typeof translations.fr;

export function t(lang: Language, key: TranslationKey): any {
  return translations[lang][key];
}
