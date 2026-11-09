import type { Quality, Server } from './api';

export interface WatchlistEntry { itemId: string; itemName: string; quality: Quality; }
type StoredWatchlist = Record<Server, WatchlistEntry[]> & Record<string, unknown>;
interface WatchlistSnapshot { all: StoredWatchlist; loaded: boolean; }
interface WatchlistStorage {
  read(): string | null | Promise<string | null>;
  write(raw: string): void | Promise<void>;
}
type Operation =
  | { kind: 'add'; server: Server; entry: WatchlistEntry }
  | { kind: 'remove'; server: Server; entry: Pick<WatchlistEntry, 'itemId' | 'quality'> };

const empty = (): StoredWatchlist => ({ americas: [], europe: [], asia: [] });
const servers = ['americas', 'europe', 'asia'] as const;

function parseStored(raw: string | null): StoredWatchlist | null {
  if (!raw) return empty();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const values = parsed as Record<string, unknown>;
    for (const server of servers) {
      const list = values[server];
      if (list === undefined) continue;
      if (!Array.isArray(list) || !list.every((entry) => entry && typeof entry.itemId === 'string'
        && typeof entry.itemName === 'string' && Number.isInteger(entry.quality)
        && entry.quality >= 1 && entry.quality <= 5)) return null;
    }
    // Keep unknown fields intact rather than deleting future-version data.
    return { ...empty(), ...values } as StoredWatchlist;
  } catch {
    return null;
  }
}

function apply(all: StoredWatchlist, operation: Operation): StoredWatchlist {
  const entries = all[operation.server];
  const matches = (entry: WatchlistEntry) => entry.itemId === operation.entry.itemId && entry.quality === operation.entry.quality;
  const next = operation.kind === 'remove'
    ? entries.filter((entry) => !matches(entry))
    : entries.some(matches) || entries.length >= 50 ? entries : [...entries, operation.entry];
  return { ...all, [operation.server]: next };
}

/**
 * Keep edits usable in memory when storage fails. Pending operations are replayed
 * only after a successful read, so recovery cannot overwrite unseen saved lists.
 */
export function createWatchlistStore(storage: WatchlistStorage) {
  let snapshot: WatchlistSnapshot = { all: empty(), loaded: false };
  let pending: Operation[] = [];
  let queue = Promise.resolve();
  const listeners = new Set<(state: WatchlistSnapshot) => void>();

  const publish = (all: StoredWatchlist, loaded = snapshot.loaded) => {
    snapshot = { all, loaded };
    for (const listener of listeners) listener(snapshot);
  };
  const read = async () => {
    try { return parseStored(await storage.read()); } catch { return null; }
  };
  const enqueue = (operation: () => Promise<void>) => {
    queue = queue.then(operation);
    return queue;
  };
  const persist = async () => {
    if (!pending.length) return;
    const stored = await read();
    // Never replace an unreadable persisted list with an assumed empty list.
    if (!stored) return;
    const batch = [...pending];
    const merged = batch.reduce(apply, stored);
    publish(merged);
    try {
      await storage.write(JSON.stringify(merged));
      // Edits made while this write was pending remain queued for the next write.
      pending = pending.slice(batch.length);
    } catch {
      // Memory and pending operations remain intact; no persistence is claimed.
    }
  };
  const update = (operation: Operation) => {
    pending.push(operation);
    publish(apply(snapshot.all, operation));
    return enqueue(persist);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: (state: WatchlistSnapshot) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load: () => enqueue(async () => {
      const stored = await read();
      publish(stored ? pending.reduce(apply, stored) : snapshot.all, true);
    }),
    add: (server: Server, entry: WatchlistEntry) => update({ kind: 'add', server, entry }),
    remove: (server: Server, entry: Pick<WatchlistEntry, 'itemId' | 'quality'>) => update({ kind: 'remove', server, entry }),
  };
}
