'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/lib/i18n/messages/en.json';
import idMessages from '@/lib/i18n/messages/id.json';

type Locale = 'id' | 'en';

const messagesMap: Record<Locale, Record<string, any>> = {
  id: idMessages,
  en: enMessages,
};

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'id',
  setLocale: () => {},
});

export function useLocaleContext() {
  return useContext(LocaleContext);
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('id');
  const [messages, setMessages] = useState<Record<string, any>>(messagesMap['id']);

  useEffect(() => {
    const stored = (typeof window !== 'undefined' && localStorage.getItem('locale')) as Locale | null;
    if (stored && messagesMap[stored]) {
      const next = stored;
      const t = setTimeout(() => {
        setLocaleState(next);
        setMessages(messagesMap[next]);
      }, 0);
      return () => clearTimeout(t);
    }
  }, []);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    setMessages(messagesMap[next]);
    if (typeof window !== 'undefined') {
      localStorage.setItem('locale', next);
    }
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      <NextIntlClientProvider
        locale={locale}
        messages={messages}
        timeZone="Asia/Jakarta"
      >
        {children}
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}
