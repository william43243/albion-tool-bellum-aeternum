const AODP_NAIVE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/;
const TIMESTAMP_WITH_ZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;

/** AODP timestamps without an offset are documented/treated as UTC. */
export function normalizeAodpTimestamp(value: string): string | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const normalized = AODP_NAIVE_TIMESTAMP.test(value)
    ? `${value}Z`
    : TIMESTAMP_WITH_ZONE.test(value) ? value : null;
  if (!normalized) return null;
  return Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

export function parseAodpTimestamp(value: string): number | null {
  const normalized = normalizeAodpTimestamp(value);
  if (!normalized) return null;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}
