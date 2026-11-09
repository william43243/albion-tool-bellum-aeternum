import { zones, WorldZone, ZoneRisk } from './worldMap';

export type RoutePolicy = 'fewest_transitions' | 'fewest_lethal';
export type RouteResult = {
  status: 'found'; zoneIds: string[]; transitions: number;
  lethalZones: number; unknownRiskZones: number; riskCounts: Record<ZoneRisk, number>;
  policy: RoutePolicy; scope: 'static_cluster_exits';
} | { status: 'unreachable' | 'unknown_zone'; policy: RoutePolicy; scope: 'static_cluster_exits' };
const lethal = (z: WorldZone) => z.risk === 'red' || z.risk === 'black';
/** Directed source exits only. Costs are lexicographic, not an invented travel-time model. */
export function planWorldRoute(from: string, to: string, policy: RoutePolicy, graph: readonly WorldZone[] = zones): RouteResult {
  if (policy !== 'fewest_transitions' && policy !== 'fewest_lethal') throw new Error('Unknown route policy');
  const byId = new Map(graph.map(z => [z.id, z]));
  const base = { policy, scope: 'static_cluster_exits' as const };
  if (!byId.has(from) || !byId.has(to)) return { ...base, status: 'unknown_zone' };
  // Unknown risk is ranked with lethal for avoidance, never silently considered safe.
  type Cost = [number, number];
  const less = (a: Cost, b: Cost) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const scores = new Map<string, Cost>([[from, [0, 0]]]);
  const previous = new Map<string, string>(), pending = new Set([from]);
  while (pending.size) {
    const current = [...pending].sort((a, b) => {
      const x = scores.get(a)!, y = scores.get(b)!;
      return x[0] - y[0] || x[1] - y[1] || a.localeCompare(b);
    })[0];
    pending.delete(current);
    if (current === to) break;
    for (const id of [...byId.get(current)!.exits].sort()) {
      const next = byId.get(id); if (!next) continue;
      const hazard = lethal(next) || next.risk === 'unknown' ? 1 : 0;
      const prior = scores.get(current)!;
      const cost: Cost = policy === 'fewest_lethal' ? [prior[0] + hazard, prior[1] + 1] : [prior[0] + 1, prior[1] + hazard];
      const old = scores.get(id);
      if (!old || less(cost, old)) { scores.set(id, cost); previous.set(id, current); pending.add(id); }
    }
  }
  if (!scores.has(to)) return { ...base, status: 'unreachable' };
  const zoneIds = [to];
  while (zoneIds[0] !== from) zoneIds.unshift(previous.get(zoneIds[0])!);
  const riskCounts: Record<ZoneRisk, number> = { blue: 0, yellow: 0, red: 0, black: 0, city: 0, unknown: 0 };
  for (const id of zoneIds) riskCounts[byId.get(id)!.risk]++;
  return { ...base, status: 'found', zoneIds, transitions: zoneIds.length - 1,
    lethalZones: riskCounts.red + riskCounts.black, unknownRiskZones: riskCounts.unknown, riskCounts };
}

/** Typed contract for a future app tool bridge. It does not run a model or invent locations. */
export type MapAction = { type: 'focus_zone'; zoneId: string } |
  { type: 'plan_route'; from: string; to: string; policy: RoutePolicy };
export function resolveMapAction(action: MapAction, graph: readonly WorldZone[] = zones) {
  if (action.type === 'focus_zone') {
    const zone = graph.find(z => z.id === action.zoneId);
    return zone ? { status: 'found' as const, zone } : { status: 'unknown_zone' as const };
  }
  if (action.type === 'plan_route') return planWorldRoute(action.from, action.to, action.policy, graph);
  throw new Error('Unknown map action');
}
