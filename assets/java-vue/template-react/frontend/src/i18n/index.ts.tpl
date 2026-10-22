import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enUS from './locales/en-US';
import zhCN from './locales/zh-CN';

export type AppLocale = 'zh-CN' | 'en-US';
export const SUPPORTED_LOCALES: AppLocale[] = ['zh-CN', 'en-US'];
export const DEFAULT_LOCALE: AppLocale = 'zh-CN';
const STORAGE_KEY = 'specgate.locale';

function preferredLocale(): AppLocale {
  const stored =
    typeof window === 'undefined'
      ? null
      : window.localStorage.getItem(STORAGE_KEY);
  return SUPPORTED_LOCALES.includes(stored as AppLocale)
    ? (stored as AppLocale)
    : DEFAULT_LOCALE;
}

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS },
  },
  lng: preferredLocale(),
  fallbackLng: ['zh-CN', 'en-US'],
  supportedLngs: SUPPORTED_LOCALES,
  initImmediate: false,
  interpolation: { escapeValue: false },
});

export function setLocale(next: AppLocale) {
  void i18n.changeLanguage(next);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, next);
  }
}

export { i18n };

export default i18n;
