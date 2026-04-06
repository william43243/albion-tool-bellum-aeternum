// Albion Online — City-to-city route data
// Extracted from ao-data/ao-bin-dumps world.json via BFS shortest path
// Zone colors: blue=safe, yellow=flagging PvP, red=full PvP

export type ZoneColor = 'blue' | 'yellow' | 'red';
export type RiskLevel = 'safe' | 'low' | 'medium' | 'high';

export interface Route {
  from: string;
  to: string;
  zones: number;
  blueZones: number;
  yellowZones: number;
  redZones: number;
  risk: RiskLevel;
  path: ZoneColor[];  // zone-by-zone color sequence
  note: string;
}

function riskFromRed(redCount: number): RiskLevel {
  if (redCount === 0) return 'safe';
  if (redCount <= 2) return 'medium';
  return 'high';
}

/**
 * All routes computed by BFS on world.json graph data.
 * Brecilien has no overland route (Roads of Avalon only).
 */
export const ROUTES: Route[] = [
  // Fort Sterling routes
  {
    from: 'Fort Sterling', to: 'Thetford', zones: 6, blueZones: 5, yellowZones: 1, redZones: 0,
    risk: 'safe', path: ['blue','blue','blue','blue','yellow','blue'],
    note: 'Safest long route, almost all blue zones',
  },
  {
    from: 'Fort Sterling', to: 'Lymhurst', zones: 6, blueZones: 1, yellowZones: 5, redZones: 0,
    risk: 'safe', path: ['blue','yellow','yellow','yellow','yellow','yellow'],
    note: 'Safe yellow route, no red zones',
  },
  {
    from: 'Fort Sterling', to: 'Caerleon', zones: 5, blueZones: 1, yellowZones: 1, redZones: 3,
    risk: 'high', path: ['blue','yellow','red','red','red'],
    note: 'Short but 3 red zones. Gank hotspot.',
  },
  {
    from: 'Fort Sterling', to: 'Martlock', zones: 9, blueZones: 1, yellowZones: 3, redZones: 5,
    risk: 'high', path: ['blue','yellow','red','red','red','red','red','yellow','yellow'],
    note: 'Must cross red center. Consider Caerleon shortcut.',
  },
  {
    from: 'Fort Sterling', to: 'Bridgewatch', zones: 11, blueZones: 1, yellowZones: 2, redZones: 8,
    risk: 'high', path: ['blue','yellow','red','red','red','red','red','red','red','red','yellow'],
    note: 'Very dangerous, 8 red zones. Use safe detour via Thetford instead.',
  },

  // Martlock routes
  {
    from: 'Martlock', to: 'Bridgewatch', zones: 6, blueZones: 3, yellowZones: 3, redZones: 0,
    risk: 'safe', path: ['blue','blue','yellow','yellow','yellow','blue'],
    note: 'Safe route through blue/yellow zones',
  },
  {
    from: 'Martlock', to: 'Thetford', zones: 6, blueZones: 2, yellowZones: 4, redZones: 0,
    risk: 'safe', path: ['blue','yellow','yellow','yellow','yellow','blue'],
    note: 'Safe yellow route',
  },
  {
    from: 'Martlock', to: 'Caerleon', zones: 5, blueZones: 0, yellowZones: 2, redZones: 3,
    risk: 'high', path: ['yellow','yellow','red','red','red'],
    note: 'Short but 3 red zones. Gank hotspot.',
  },
  {
    from: 'Martlock', to: 'Lymhurst', zones: 10, blueZones: 0, yellowZones: 4, redZones: 6,
    risk: 'high', path: ['yellow','yellow','red','red','red','red','red','red','yellow','yellow'],
    note: 'Very dangerous, 6 red zones. Use safe detour via Bridgewatch.',
  },

  // Bridgewatch routes
  {
    from: 'Bridgewatch', to: 'Lymhurst', zones: 6, blueZones: 2, yellowZones: 4, redZones: 0,
    risk: 'safe', path: ['blue','yellow','yellow','yellow','yellow','blue'],
    note: 'Safe yellow route',
  },
  {
    from: 'Bridgewatch', to: 'Caerleon', zones: 6, blueZones: 1, yellowZones: 2, redZones: 3,
    risk: 'high', path: ['blue','yellow','yellow','red','red','red'],
    note: '3 red zones to reach center',
  },
  {
    from: 'Bridgewatch', to: 'Thetford', zones: 11, blueZones: 1, yellowZones: 4, redZones: 6,
    risk: 'high', path: ['blue','yellow','yellow','red','red','red','red','red','red','yellow','yellow'],
    note: 'Very dangerous direct. Use safe detour via Martlock.',
  },

  // Thetford routes
  {
    from: 'Thetford', to: 'Caerleon', zones: 6, blueZones: 0, yellowZones: 2, redZones: 4,
    risk: 'high', path: ['yellow','yellow','red','red','red','red'],
    note: '4 red zones. Most dangerous Caerleon route.',
  },
  {
    from: 'Thetford', to: 'Lymhurst', zones: 10, blueZones: 0, yellowZones: 3, redZones: 7,
    risk: 'high', path: ['yellow','red','red','red','red','red','red','red','yellow','yellow'],
    note: 'Extremely dangerous direct. Use detour via Fort Sterling.',
  },

  // Lymhurst routes
  {
    from: 'Lymhurst', to: 'Caerleon', zones: 5, blueZones: 0, yellowZones: 2, redZones: 3,
    risk: 'high', path: ['yellow','yellow','red','red','red'],
    note: '3 red zones to reach center',
  },
];

// Brecilien note: only accessible via Roads of Avalon (randomized portals, always risky)
export const BRECILIEN_NOTE = 'Brecilien: Roads of Avalon only (no overland route). Random portals, always PvP risk.';

/**
 * Safe routes summary (0 red zones) — for quick reference
 */
export const SAFE_ROUTES: [string, string][] = [
  ['Fort Sterling', 'Thetford'],    // 6 zones, 5B 1Y
  ['Fort Sterling', 'Lymhurst'],    // 6 zones, 1B 5Y
  ['Martlock', 'Bridgewatch'],      // 6 zones, 3B 3Y
  ['Martlock', 'Thetford'],         // 6 zones, 2B 4Y
  ['Bridgewatch', 'Lymhurst'],      // 6 zones, 2B 4Y
];

/**
 * Find route between two cities (checks both directions)
 */
export function getRoute(cityA: string, cityB: string): Route | null {
  if (cityA === 'Brecilien' || cityB === 'Brecilien') return null;
  return ROUTES.find(
    (r) =>
      (r.from === cityA && r.to === cityB) ||
      (r.from === cityB && r.to === cityA)
  ) || null;
}

/**
 * Get risk color for display
 */
export function riskColor(risk: RiskLevel): string {
  switch (risk) {
    case 'safe': return '#4CAF50';
    case 'low': return '#8BC34A';
    case 'medium': return '#FF9800';
    case 'high': return '#F44336';
  }
}

/**
 * Format route info as compact text for LLM prompt
 */
export function formatRouteForPrompt(cityA: string, cityB: string): string {
  if (cityA === 'Brecilien' || cityB === 'Brecilien') {
    return `${cityA}→${cityB}: Avalon Roads only (no safe overland route)`;
  }
  const route = getRoute(cityA, cityB);
  if (!route) return `${cityA}→${cityB}: no direct route data`;

  if (route.redZones > 0) {
    return `${cityA}→${cityB}: ${route.zones} zones (${route.redZones} RED), DANGEROUS`;
  }
  return `${cityA}→${cityB}: ${route.zones} zones (${route.blueZones}blue+${route.yellowZones}yellow), SAFE`;
}

/**
 * Build compact route summary for the flip recommendation
 */
export function getFlipRouteInfo(buyCity: string, sellCity: string): string {
  if (buyCity === 'Brecilien' || sellCity === 'Brecilien') {
    return 'Avalon Roads only — unpredictable PvP risk';
  }
  const route = getRoute(buyCity, sellCity);
  if (!route) return 'no route data';

  const parts: string[] = [`${route.zones} zones`];
  if (route.redZones > 0) {
    parts.push(`${route.redZones} RED zones`);
    parts.push('DANGER: ganking risk');
  } else {
    parts.push('SAFE route (no red zones)');
  }
  if (route.note) parts.push(route.note);
  return parts.join(', ');
}

/**
 * Get all safe flip pairs (0 red zones)
 */
export function getSafeFlipPairs(): [string, string][] {
  return SAFE_ROUTES;
}
