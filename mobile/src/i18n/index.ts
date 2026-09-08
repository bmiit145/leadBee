import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from './translations/en.json';
import gu from './translations/gu.json';

export const LANGUAGE_STORAGE_KEY = 'app.language';
export type AppLanguage = 'en' | 'gu';
const DEFAULT_LANGUAGE: AppLanguage = 'gu';

const normalizeLanguage = (value?: string | null): AppLanguage => {
  if (!value) return DEFAULT_LANGUAGE;
  const lower = value.toLowerCase();
  if (lower.startsWith('gu')) return 'gu';
  return 'en';
};

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    gu: { translation: gu },
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: 'en',
  compatibilityJSON: 'v4',
  interpolation: {
    escapeValue: false,
  },
});

export const initializeI18n = async (): Promise<void> => {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    const normalized = stored ? normalizeLanguage(stored) : DEFAULT_LANGUAGE;
    if (i18n.language !== normalized) {
      await i18n.changeLanguage(normalized);
    }
  } catch {
    if (i18n.language !== DEFAULT_LANGUAGE) {
      await i18n.changeLanguage(DEFAULT_LANGUAGE);
    }
  }
};

export const setAppLanguage = async (language: AppLanguage): Promise<void> => {
  const normalized = normalizeLanguage(language);
  await i18n.changeLanguage(normalized);
  await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
};

export const toggleAppLanguage = async (): Promise<AppLanguage> => {
  const nextLanguage: AppLanguage = normalizeLanguage(i18n.language) === 'en' ? 'gu' : 'en';
  await setAppLanguage(nextLanguage);
  return nextLanguage;
};

export const getCurrentLanguage = (): AppLanguage => normalizeLanguage(i18n.language);

export default i18n;
