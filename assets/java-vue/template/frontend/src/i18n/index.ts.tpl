import { createI18n } from 'vue-i18n';
import zhCN from './locales/zh-CN';
import enUS from './locales/en-US';

export type AppLocale = 'zh-CN' | 'en-US';
export const SUPPORTED_LOCALES: AppLocale[] = ['zh-CN', 'en-US'];
export const DEFAULT_LOCALE: AppLocale = 'zh-CN';

const stored =
  typeof window === 'undefined'
    ? null
    : window.localStorage.getItem('specgate.locale');
const locale: AppLocale = SUPPORTED_LOCALES.includes(stored as AppLocale)
  ? (stored as AppLocale)
  : DEFAULT_LOCALE;

export const i18n = createI18n({
  legacy: false,
  locale,
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
});

export function setLocale(next: AppLocale) {
  i18n.global.locale.value = next;
  if (typeof window !== 'undefined')
    window.localStorage.setItem('specgate.locale', next);
}
