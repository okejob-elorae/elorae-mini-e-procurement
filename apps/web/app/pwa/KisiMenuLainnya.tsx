"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export type ItemKisiMenu = {
  href: string;
  ikon: LucideIcon;
  label: string;
  /** Keterangan menu — dibacakan pembaca layar, tidak ditulis di kisi. */
  hint: string;
  /** Angka kecil di pojok ikon (mis. kiriman yang belum terkirim); 0/undefined = tidak tampil. */
  lencana?: number;
};

export type KelompokKisiMenu = { kunci: string; judul: string; item: ItemKisiMenu[] };

/**
 * Tab "Lainnya" di HP — SATU bentuk untuk salesman (`app/pwa/lainnya`) dan SPG
 * (`app/pwa/spg/lainnya`); isinya beda, tampilannya sama.
 *
 * Kisi ikon tiga kolom per kelompok, bukan baris berketerangan: dua puluh baris
 * memenuhi tiga layar dan yang di bawah tidak pernah ditemukan. Keterangan
 * tiap menu tetap dibacakan pembaca layar (`sr-only`).
 */
export function KisiMenuLainnya({ kelompok }: { kelompok: KelompokKisiMenu[] }) {
  return (
    <div className="space-y-4">
      {kelompok.map((g) => (
        <section key={g.kunci} className="space-y-1.5" aria-labelledby={`lainnya-${g.kunci}`}>
          <h2 id={`lainnya-${g.kunci}`} className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {g.judul}
          </h2>
          {/* Padding di dalam: `.beranda-kartu-daftar` (CSS biasa, di luar
              layer Tailwind) menimpa kelas padding apa pun di elemen yang sama. */}
          <nav className="beranda-kartu beranda-kartu-daftar" aria-labelledby={`lainnya-${g.kunci}`}>
            <ul className="grid grid-cols-3 gap-1 p-2">
              {g.item.map(({ href, ikon: Ikon, label, hint, lencana }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="flex h-full min-h-24 flex-col items-center gap-1.5 rounded-lg px-1 py-2.5 text-center transition-colors hover:bg-muted/60 active:bg-muted/60"
                  >
                    <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Ikon className="h-5 w-5" aria-hidden />
                      {lencana && lencana > 0 ? (
                        <span className="absolute -right-1.5 -top-1.5 grid min-w-5 place-items-center rounded-full bg-amber-500 px-1 text-[11px] font-semibold tabular-nums text-white">
                          {lencana}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs font-medium leading-tight">{label}</span>
                    <span className="sr-only">{hint}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </section>
      ))}
    </div>
  );
}
