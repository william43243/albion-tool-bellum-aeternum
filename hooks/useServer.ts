import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Server } from '../lib/api';

const SERVER_KEY = 'albion_calc_server';

function getStoredValue(key: string): Promise<string | null> {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    return Promise.resolve(localStorage.getItem(key));
  }
  return AsyncStorage.getItem(key);
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
    await setStoredValue(SERVER_KEY, newServer);
  }, []);

  return { server, switchServer, serverLoaded: loaded };
}
