import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Language, translations, TranslationKey } from '../lib/i18n';

const LANG_KEY = 'albion_calc_language';

async function getStoredValue(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
    return await AsyncStorage.getItem(key);
  } catch {
    // Storage may be blocked by the browser or unavailable on the device.
    // Keep the default language, but allow the application to finish loading.
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

export function useLanguage() {
  const [lang, setLang] = useState<Language>('fr');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getStoredValue(LANG_KEY).then((saved) => {
      if (saved === 'en' || saved === 'fr' || saved === 'es') {
        setLang(saved);
      }
      setLoaded(true);
    });
  }, []);

  const switchLanguage = useCallback(async (newLang: Language) => {
    setLang(newLang);
    try {
      await setStoredValue(LANG_KEY, newLang);
    } catch {
      // The selection remains usable for this session; it was not persisted.
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey): any => {
      return translations[lang][key];
    },
    [lang]
  );

  return { lang, switchLanguage, t, loaded };
}
