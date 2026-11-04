'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AngkaNaik } from '@/components/gerak/AngkaNaik';

/**
 * Satu kelompok angka beranda sebagai DAFTAR, bukan empat ubin.
 *
 * Enam belas ubin besar menghabiskan dua layar untuk enam belas angka. Daftar
 * label-di-kiri, angka-di-kanan memuat kelompok yang sama dalam sepertiga
 * tingginya, dan mata tetap bisa menyapu kolom angkanya ke bawah. Setiap baris
 * tetap tautan ke halaman kerjanya — tanda › muncul saat disorot, supaya jelas
 * bisa diklik tanpa memenuhi daftar dengan panah.
 */

export type BarisKpi = {
  label: string;
  nilai: number;
  format: (n: number) => string;
  /** Satu baris kecil di bawah label. */
  konteks?: string;
  href?: string;
  /** Dipakai HEMAT — kalau semuanya menonjol, tidak ada yang menonjol. */
  nada?: 'netral' | 'perhatian' | 'buruk';
};

const NADA: Record<NonNullable<BarisKpi['nada']>, string> = {
  netral: '',
  perhatian: 'text-amber-600 dark:text-amber-500',
  buruk: 'text-destructive',
};

export function KpiDaftar({ judul, baris, className }: { judul: string; baris: BarisKpi[]; className?: string }) {
  return (
    <section className={cn('beranda-kartu', className)}>
      <h3 className="beranda-judul">{judul}</h3>
      {/* -mx: baris punya latar sorot selebar kartu, tapi teksnya tetap
          sejajar dengan judul di atasnya. */}
      <ul className="-mx-1.5 mt-1.5">
        {baris.map((b) => {
          const isi = (
            <>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-tight">{b.label}</span>
                {b.konteks ? (
                  <span className="block text-[11px] leading-tight text-muted-foreground">{b.konteks}</span>
                ) : null}
              </span>
              <span
                className={cn(
                  'shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums',
                  NADA[b.nada ?? 'netral'],
                )}
              >
                <AngkaNaik nilai={b.nilai} format={b.format} />
              </span>
              {b.href ? (
                <ChevronRight
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
                />
              ) : null}
            </>
          );
          const kelas =
            'group flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-background/60 focus-visible:bg-background/60 focus-visible:outline-none';
          return (
            <li key={b.label}>
              {b.href ? (
                <Link href={b.href} className={kelas}>
                  {isi}
                </Link>
              ) : (
                <div className={kelas}>{isi}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
