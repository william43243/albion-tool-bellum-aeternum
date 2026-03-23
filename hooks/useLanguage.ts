import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Language, translations, TranslationKey } from '../lib/i18n';

const LANG_KEY = 'albion_calc_language';

export function useLanguage() {
  const [lang, setLang] = useState<Language>('fr');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(LANG_KEY).then((saved) => {
      if (saved === 'en' || saved === 'fr') {
        setLang(saved);
      }
      setLoaded(true);
    });
  }, []);

  const switchLanguage = useCallback(async (newLang: Language) => {
    setLang(newLang);
    await AsyncStorage.setItem(LANG_KEY, newLang);
  }, []);

  const t = useCallback(
    (key: TranslationKey): any => {
      return translations[lang][key];
    },
    [lang]
  );

  return { lang, switchLanguage, t, loaded };
}
