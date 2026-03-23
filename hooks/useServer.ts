import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Server } from '../lib/api';

const SERVER_KEY = 'albion_calc_server';

export function useServer() {
  const [server, setServer] = useState<Server>('americas');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(SERVER_KEY).then((saved) => {
      if (saved === 'americas' || saved === 'europe' || saved === 'asia') {
        setServer(saved);
      }
      setLoaded(true);
    });
  }, []);

  const switchServer = useCallback(async (newServer: Server) => {
    setServer(newServer);
    await AsyncStorage.setItem(SERVER_KEY, newServer);
  }, []);

  return { server, switchServer, serverLoaded: loaded };
}
