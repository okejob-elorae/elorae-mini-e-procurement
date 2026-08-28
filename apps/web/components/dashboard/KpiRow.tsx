'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Barisan KPI beranda.
 *
 * Angka besar dengan satu baris konteks di bawahnya, bukan kartu berjudul.
 * Yang dicari orang tiap pagi adalah angkanya; judul yang lebih menonjol
 * daripada angkanya membuat mata berhenti di tempat yang salah.
 *
 * Tiap ubin MENAUT ke halaman tempat pekerjaannya. Angka yang tidak bisa
 * diklik memaksa orang mengingat sendiri menu mana yang memuatnya — dan
 * dengan 53 tautan, ingatan itu meleset.
 */

export type Kpi = {
  label: string;
  nilai: string;
  /** Satu baris konteks. Tanpa ini angka tidak menyatakan apa-apa. */
  konteks?: string;
  href?: string;
  /**
   * Menonjolkan yang menuntut tindakan.
   *
   * Dipakai HEMAT — kalau semuanya menonjol, tidak ada yang menonjol, dan
   * orang berhenti melihat warnanya sama sekali.
   */
  nada?: 'netral' | 'perhatian' | 'buruk';
};

const NADA: Record<NonNullable<Kpi['nada']>, string> = {
  netral: '',
  perhatian: 'text-amber-600 dark:text-amber-500',
  buruk: 'text-destructive',
};

export function KpiRow({ judul, kpi }: { judul: string; kpi: Kpi[] }) {
  return (
    <section className="space-y-2">
      {/* Penanda kecil berwarna tema. Judul bagian yang cuma teks abu terbaca
          sebagai keterangan; satu batang warna membuatnya terbaca sebagai
          kepala bagian — dan itu satu-satunya tempat warna tema muncul tanpa
          bersaing dengan angkanya. */}
      <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span
          aria-hidden
          className="h-3 w-[3px] shrink-0 rounded-full"
          style={{ background: 'var(--kpi-accent)' }}
        />
        {judul}
      </h3>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {kpi.map((k) => {
          const isi = (
            <>
              {/* Dua baris DISEDIAKAN untuk label, walau sebagian cuma butuh
                  satu. Tanpa itu tinggi ubin ikut panjang labelnya dan barisnya
                  jadi bergerigi — mata membaca gerigi itu sebagai kekacauan
                  sebelum sempat membaca angkanya. */}
              <p className="line-clamp-2 min-h-[2.1rem] text-xs leading-snug text-muted-foreground">
                {k.label}
              </p>
              {/* `whitespace-nowrap`: tanpa itu "Rp" terpisah dari angkanya di
                  ubin yang sempit, dan yang terbaca sekilas bukan lagi angka. */}
              <p
                className={cn(
                  'mt-0.5 whitespace-nowrap text-lg font-semibold tabular-nums sm:text-xl',
                  NADA[k.nada ?? 'netral'],
                )}
              >
                {k.nilai}
              </p>
              {k.konteks && (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{k.konteks}</p>
              )}
            </>
          );
          const kelas = cn(
            'rounded-xl border px-3.5 py-3 transition-shadow',
            k.href && 'hover:shadow-[0_1px_2px_rgb(0_0_0/0.05),0_14px_34px_-14px_var(--kpi-glow)]',
          );
          const gaya = {
            background: 'var(--kpi-surface)',
            borderColor: 'var(--kpi-ring)',
            /* Halo di LUAR garis, dalam warna tema — inti perbaikannya. */
            boxShadow: '0 1px 2px rgb(0 0 0 / 0.05), 0 12px 30px -14px var(--kpi-glow)',
          };
          return k.href ? (
            <Link key={k.label} href={k.href} className={kelas} style={gaya}>
              {isi}
            </Link>
          ) : (
            <div key={k.label} className={kelas} style={gaya}>
              {isi}
            </div>
          );
        })}
      </div>
    </section>
  );
}
