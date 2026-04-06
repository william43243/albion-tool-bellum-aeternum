import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Language, translations, TranslationKey } from '../lib/i18n';

const LANG_KEY = 'albion_calc_language';

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
    await setStoredValue(LANG_KEY, newLang);
  }, []);

  const t = useCallback(
    (key: TranslationKey): any => {
      return translations[lang][key];
    },
    [lang]
  );

  return { lang, switchLanguage, t, loaded };
}
