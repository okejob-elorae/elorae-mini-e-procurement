'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  BarChart3,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  Flag,
  Handshake,
  PackageCheck,
  PlaySquare,
  Settings2,
  Users,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Layar-layar Ruang KOL duduk berdampingan sebagai tab, bukan bersarang di
 * menu samping.
 *
 * Kolaborasi, sampel, konten, dan pembayaran adalah satu alur yang sama dilihat
 * dari empat sudut — orang berpindah di antaranya puluhan kali sehari. Menaruh
 * semuanya hanya di sidebar memaksa bolak-balik lewat menu untuk pekerjaan
 * yang sebenarnya satu tarikan napas. Menu samping memuat daftar yang sama
 * (`lib/nav/menu.ts`) untuk orang yang datang dari luar.
 *
 * Bawaan Kreatif = Hari ini (`/backoffice/kreatif`). Tab yang aktif adalah
 * kecocokan TERPANJANG, supaya Hari ini tidak ikut menyala di setiap sub-layar.
 */
export const TAB_KREATIF = [
  { href: '/backoffice/kreatif', key: 'hariIni', ikon: ClipboardList },
  { href: '/backoffice/kreatif/kolaborasi', key: 'kolaborasi', ikon: Handshake },
  { href: '/backoffice/kreatif/kol', key: 'kol', ikon: Users },
  { href: '/backoffice/kreatif/campaign', key: 'campaign', ikon: Flag },
  { href: '/backoffice/kreatif/sampel', key: 'sampel', ikon: PackageCheck },
  { href: '/backoffice/kreatif/konten-kol', key: 'kontenKol', ikon: PlaySquare },
  { href: '/backoffice/kreatif/pembayaran', key: 'pembayaran', ikon: Wallet },
  { href: '/backoffice/kreatif/kalender', key: 'kalender', ikon: CalendarDays },
  { href: '/backoffice/kreatif/laporan', key: 'laporan', ikon: BarChart3 },
  { href: '/backoffice/kreatif/konten', key: 'rencanaKonten', ikon: CalendarRange },
  { href: '/backoffice/kreatif/pengaturan', key: 'pengaturan', ikon: Settings2 },
] as const;

export function tabAktif(pathname: string): string | null {
  const cocok = TAB_KREATIF.filter((t) => pathname === t.href || pathname.startsWith(`${t.href}/`));
  return cocok.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}

/**
 * `jumlahTugas` = total Hari ini (`hitungTugasKreatif`), dihitung tata letak
 * di server. Lencananya merah tetap, sama dengan lencana menu samping.
 */
export function KreatifTabs({ jumlahTugas = 0 }: { jumlahTugas?: number }) {
  const t = useTranslations('kreatifRuang.tab');
  const pathname = usePathname();
  const aktif = tabAktif(pathname);

  return (
    <nav className="-mx-1 overflow-x-auto border-b" aria-label={t('label')}>
      <div className="flex min-w-max gap-1 px-1">
        {TAB_KREATIF.map(({ href, key, ikon: Ikon }) => (
          <Link
            key={href}
            href={href}
            aria-current={aktif === href ? 'page' : undefined}
            className={cn(
              '-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
              aktif === href
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Ikon className="h-4 w-4" />
            {t(key)}
            {key === 'hariIni' && jumlahTugas > 0 ? (
              <>
                <span
                  className="rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white tabular-nums"
                  aria-hidden
                >
                  {jumlahTugas > 99 ? '99+' : jumlahTugas}
                </span>
                <span className="sr-only">{t('lencana', { n: jumlahTugas })}</span>
              </>
            ) : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}
