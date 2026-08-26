'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Camera, Scale, Store, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Menu bawah modul piutang.
 *
 * Empat tujuan, bukan lima: setiap ketukan harus mengarah ke sesuatu yang
 * dikerjakan sales, dan ikon yang berdesakan di layar HP membuat semuanya
 * sama-sama sulit ditekan.
 */
const MENU = [
  { href: '/pwa/piutang', kunci: 'toko', ikon: Store },
  { href: '/pwa/bkm', kunci: 'bkm', ikon: Wallet },
  { href: '/pwa/retur', kunci: 'retur', ikon: Camera },
  { href: '/pwa/beban', kunci: 'beban', ikon: Scale },
] as const;

export function MenuBawahPiutang() {
  const t = useTranslations('pwaMenu');
  const path = usePathname();

  return (
    <nav
      className="sticky bottom-0 z-20 grid grid-cols-4 border-t bg-background/95 backdrop-blur"
      /* Aman dari bilah gestur iPhone. Tanpa ini tombol paling bawah tertutup
         garis home dan meleset saat ditekan. */
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {MENU.map(({ href, kunci, ikon: Ikon }) => {
        const aktif = path === href || path.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors',
              aktif ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <Ikon className={cn('h-5 w-5', aktif && 'stroke-[2.5]')} />
            {t(kunci)}
          </Link>
        );
      })}
    </nav>
  );
}
