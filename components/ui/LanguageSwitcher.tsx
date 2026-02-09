'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLocaleContext } from '@/components/providers/LocaleProvider';

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocaleContext();

  return (
    <Select value={locale} onValueChange={(value) => setLocale(value as 'id' | 'en')}>
      <SelectTrigger className="w-[110px]">
        <SelectValue placeholder="Language" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="id">Bahasa</SelectItem>
        <SelectItem value="en">English</SelectItem>
      </SelectContent>
    </Select>
  );
}
