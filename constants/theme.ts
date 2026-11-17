export const COLORS = {
  // Comptoir de guilde: paper, ink and a single oxide accent. The 'Light'
  // aliases are ink on a light surface, never pale text on paper.
  primary: '#913D31', primaryLight: '#813729', primaryDark: '#6D2E24',
  primarySoft: '#F3E1D8', primaryFaint: '#FAF1EA', onPrimary: '#FFFFFF',
  secondary: '#2E643D', accent: '#913D31',
  profit: '#24623E', profitSoft: '#245939', profitBg: '#E9F1E8',
  loss: '#A12231', lossSoft: '#922438', lossBg: '#F8E7E6',
  warning: '#785200', info: '#315D68',
  background: '#F6F3EB', backgroundElevated: '#FFFEFA',
  surface: '#FFFEFA', surfaceLight: '#EDE8DD', surface2: '#F0ECE3',
  card: '#FFFEFA', cardElevated: '#FFFFFF',
  border: '#CFC7B7', borderStrong: '#827869', borderGold: '#B7A490',
  text: '#262620', textSecondary: '#544F48', textMuted: '#655F56',
  premiumGold: '#79500E', premiumBg: '#F5EAD4',
  overlay: 'rgba(34,32,28,0.40)',
  // Data colors are not navigation or branding colors.
  cityColors: {
    Caerleon: '#9C343E', Bridgewatch: '#975014', 'Fort Sterling': '#176687',
    Lymhurst: '#296442', Thetford: '#705281', Martlock: '#79600B', Brecilien: '#9C3872',
  } as Record<string, string>,
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const FONT_SIZE = {
  xs: 12,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 20,
  xxl: 26,
  title: 30,
  hero: 38,
};

// Font weights as a coherent, typed scale (RN accepts these string literals).
export const FONT_WEIGHT = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const;

export const BORDER_RADIUS = {
  sm: 3,
  md: 5,
  lg: 7,
  xl: 10,
  pill: 999,
};


// Shadow is reserved for a floating layer. Flat ledger panels use rules instead.
const paperShadow = { shadowColor: '#29251C', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 2, elevation: 1 };
export const SHADOWS = {
  sm: { ...paperShadow, shadowOpacity: 0, elevation: 0 },
  md: paperShadow,
  lg: { ...paperShadow, shadowRadius: 3, elevation: 2 },
  gold: { ...paperShadow, shadowOpacity: 0, elevation: 0 },
};
