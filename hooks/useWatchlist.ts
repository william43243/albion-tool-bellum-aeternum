import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Server } from '../lib/api';
import { createWatchlistStore } from '../lib/watchlistStorage';
import type { WatchlistEntry } from '../lib/watchlistStorage';

export type { WatchlistEntry } from '../lib/watchlistStorage';
const KEY = 'albion_market_watchlist_v1';
function read(): string | null | Promise<string | null> {
  return Platform.OS === 'web' && typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : AsyncStorage.getItem(KEY);
}
async function write(raw: string): Promise<void> {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') localStorage.setItem(KEY, raw);
  else await AsyncStorage.setItem(KEY, raw);
}
export function useWatchlist(server: Server) {
  const [store] = useState(() => createWatchlistStore({ read, write }));
  const [snapshot, setSnapshot] = useState(store.getSnapshot);
  useEffect(() => {
    const unsubscribe = store.subscribe(setSnapshot);
    void store.load();
    return unsubscribe;
  }, [store]);
  const add = useCallback((entry: WatchlistEntry) => store.add(server, entry), [server, store]);
  const remove = useCallback((entry: Pick<WatchlistEntry, 'itemId' | 'quality'>) => store.remove(server, entry), [server, store]);
  return { entries: snapshot.all[server], loaded: snapshot.loaded, add, remove };
}
