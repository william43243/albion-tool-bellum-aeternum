// Albion Online inspired theme — refined dark + gold system.
// All original token names are preserved for backward compatibility;
// new tokens (elevated surfaces, gold ramp, soft semantics, shadows,
// typography) are additive so screens can opt into a richer look.
export const COLORS = {
  // ── Primary Albion gold ramp ─────────────────────────────────
  primary: '#c8a84e',      // Gold/amber (Albion gold) — brand anchor
  primaryLight: '#e3c674', // Lighter gold for hovers / active accents
  primaryDark: '#a08030',  // Deeper gold for pressed / borders
  primarySoft: '#c8a84e26', // ~15% gold — subtle fills / tinted surfaces
  primaryFaint: '#c8a84e14', // ~8% gold — barely-there wash
  secondary: '#4a9e4a',    // Green (profit accent)
  accent: '#d4a017',       // Orange-gold accent

  // ── Semantic ─────────────────────────────────────────────────
  profit: '#3fb950',       // Refined green (GitHub-dark friendly)
  profitSoft: '#56d364',   // Lighter profit for emphasis text
  profitBg: '#3fb95018',    // Translucent profit backdrop
  loss: '#f85149',         // Refined red
  lossSoft: '#ff7b72',     // Lighter loss for emphasis text
  lossBg: '#f8514918',      // Translucent loss backdrop
  warning: '#e3a008',
  info: '#4493f8',

  // ── Dark theme surfaces (low → high elevation) ───────────────
  background: '#0b0f16',   // App base
  backgroundElevated: '#0f141c',
  surface: '#151b24',      // Inputs / chips base
  surfaceLight: '#212936', // Raised controls / active pills
  surface2: '#1b222d',     // Secondary elevated surface
  card: '#181e28',         // Cards
  cardElevated: '#1d2531', // Cards that need to pop

  // ── Borders ──────────────────────────────────────────────────
  border: '#2a323d',       // Default subtle border
  borderStrong: '#3a4553', // Stronger divider
  borderGold: '#c8a84e40', // Subtle gold border for premium accents

  // ── Text ─────────────────────────────────────────────────────
  text: '#e9eef5',
  textSecondary: '#9aa5b3',
  textMuted: '#697180',

  // ── Premium ──────────────────────────────────────────────────
  premiumGold: '#FFD700',
  premiumBg: '#2d2200',

  // ── Overlay ──────────────────────────────────────────────────
  overlay: 'rgba(0,0,0,0.6)',

  // City colors for charts (kept for reference / compatibility)
  cityColors: {
    Caerleon: '#FF6B6B',
    Bridgewatch: '#FFA94D',
    'Fort Sterling': '#74C0FC',
    Lymhurst: '#69DB7C',
    Thetford: '#B197FC',
    Martlock: '#FFD43B',
    Brecilien: '#F06595',
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
  xs: 10,
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
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
};

// Elevation / shadow tokens. Values map cleanly to both native RN
// (shadow* + elevation) and react-native-web (boxShadow) — no CSS-only APIs.
export const SHADOWS = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  // Warm gold glow for hero / active accents
  gold: {
    shadowColor: '#c8a84e',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
};
