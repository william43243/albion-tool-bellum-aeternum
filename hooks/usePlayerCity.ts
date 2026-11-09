import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CITIES, City } from '../lib/api';

const PLAYER_CITY_KEY = 'albion_player_city';

async function readCity(): Promise<City | null> {
  try {
    const value = Platform.OS === 'web' && typeof localStorage !== 'undefined'
      ? localStorage.getItem(PLAYER_CITY_KEY)
      : await AsyncStorage.getItem(PLAYER_CITY_KEY);
    return CITIES.includes(value as City) ? value as City : null;
  } catch {
    return null;
  }
}

async function writeCity(city: City): Promise<void> {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    localStorage.setItem(PLAYER_CITY_KEY, city);
    return;
  }
  await AsyncStorage.setItem(PLAYER_CITY_KEY, city);
}

export function usePlayerCity() {
  const [city, setCity] = useState<City | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    readCity()
      .then((saved) => setCity(saved))
      .finally(() => setLoaded(true));
  }, []);

  const selectCity = useCallback(async (nextCity: City) => {
    setCity(nextCity);
    try {
      await writeCity(nextCity);
    } catch {
      // Do not trap the user in the required city picker when storage is blocked.
      // This choice exists only in memory until a later write succeeds.
    }
  }, []);

  return { city, selectCity, cityLoaded: loaded };
}
