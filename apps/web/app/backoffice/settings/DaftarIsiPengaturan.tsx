"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

/** Satu kartu di daftar isi: `id` jangkar di halaman, `judul` kunci i18n judul kartu itu sendiri. */
export type KartuDaftarIsi = { id: string; judul: string };
export type KelompokDaftarIsi = { id: string; judul: string; kartu: KartuDaftarIsi[] };

/**
 * Daftar isi berjangkar untuk halaman pengaturan yang panjang (Salesman, SPG):
 * kelompok kartu dan tautan ke `#id` masing-masing. `kaki` untuk tautan ke
 * halaman pengaturan lain yang memegang sebagian aturan yang sama.
 */
export function DaftarIsiPengaturan({
  label,
  kelompok,
  kaki,
}: {
  label: string;
  kelompok: readonly KelompokDaftarIsi[];
  kaki?: ReactNode;
}) {
  const tAkar = useTranslations();
  return (
    <nav aria-label={label} className="rounded-lg border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        {kelompok.map((g) => (
          <div key={g.id} className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{tAkar(g.judul as never)}</p>
            <ul className="space-y-1">
              {g.kartu.map((k) => (
                <li key={k.id}>
                  <a href={`#${k.id}`} className="text-sm text-foreground underline-offset-4 hover:underline">
                    {tAkar(k.judul as never)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {kaki ? <div className="mt-3 border-t pt-3">{kaki}</div> : null}
    </nav>
  );
}

/** Judul kelompok di halaman, sejajar dengan daftar isi. */
export function JudulKelompok({ kunci }: { kunci: string }) {
  const tAkar = useTranslations();
  return (
    <h2 className="border-t pt-6 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
      {tAkar(kunci as never)}
    </h2>
  );
}
