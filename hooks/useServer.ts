import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Server } from '../lib/api';

const SERVER_KEY = 'albion_calc_server';

async function getStoredValue(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
    return await AsyncStorage.getItem(key);
  } catch {
    // Storage may be blocked by the browser or unavailable on the device.
    // Keep the default server, but allow the application to finish loading.
    return null;
  }
}

function setStoredValue(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    localStorage.setItem(key, value);
    return Promise.resolve();
  }
  return AsyncStorage.setItem(key, value);
}

export function useServer() {
  const [server, setServer] = useState<Server>('americas');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getStoredValue(SERVER_KEY).then((saved) => {
      if (saved === 'americas' || saved === 'europe' || saved === 'asia') {
        setServer(saved);
      }
      setLoaded(true);
    });
  }, []);

  const switchServer = useCallback(async (newServer: Server) => {
    setServer(newServer);
    try {
      await setStoredValue(SERVER_KEY, newServer);
    } catch {
      // The selection remains usable for this session; it was not persisted.
    }
  }, []);

  return { server, switchServer, serverLoaded: loaded };
}
