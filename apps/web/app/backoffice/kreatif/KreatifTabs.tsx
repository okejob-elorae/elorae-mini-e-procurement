'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CalendarRange, Megaphone, Palette, Shirt, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Layar-layar modul ini duduk berdampingan, bukan bersarang di menu samping.
 *
 * Konten, brief, dan KOL saling merujuk sepanjang hari — sebuah konten lahir
 * dari brief, sebuah brief menunjuk KOL. Menaruhnya sebagai tiga entri terpisah
 * di sidebar memaksa orang bolak-balik lewat menu untuk pekerjaan yang
 * sebenarnya satu tarikan napas.
 */
const TAB = [
  { href: '/backoffice/kreatif/konten', key: 'tabContent', ikon: CalendarRange },
  { href: '/backoffice/kreatif/brief', key: 'tabBrief', ikon: Megaphone },
  { href: '/backoffice/kreatif/kol', key: 'tabKol', ikon: Users },
  { href: '/backoffice/kreatif/palet', key: 'tabPalette', ikon: Palette },
  { href: '/backoffice/kreatif/sablon', key: 'tabSablon', ikon: Shirt },
] as const;

export function KreatifTabs() {
  const t = useTranslations('creative');
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap gap-1 border-b">
      {TAB.map(({ href, key, ikon: Ikon }) => {
        const aktif = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors -mb-px',
              aktif
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Ikon className="h-4 w-4" />
            {t(key)}
          </Link>
        );
      })}
    </div>
  );
}
