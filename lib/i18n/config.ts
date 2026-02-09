export const defaultLocale = 'id';
export const locales = ['id', 'en'] as const;

export type Locale = (typeof locales)[number];

export const localeLabels: Record<Locale, string> = {
  id: 'Bahasa Indonesia',
  en: 'English',
};
