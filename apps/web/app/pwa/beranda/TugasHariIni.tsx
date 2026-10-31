"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Tugas = {
  kunci: string;
  jumlah: number;
  href: string;
  label: string;
  ikon: LucideIcon;
  /** Mendesak = merah (tagihan lewat janji). Selain itu kuning (menunggu). */
  mendesak?: boolean;
};

/**
 * Yang harus dikerjakan hari ini, TERBUKA di beranda — dipakai beranda
 * salesman dan beranda SPG, masing-masing dengan tugasnya sendiri.
 *
 * Sebelumnya daftar ini tersembunyi di balik tombol kecil "2 hal perlu
 * dikerjakan" — padahal inilah hal pertama yang dicari setiap pagi. Kosong
 * berarti tidak tampil sama sekali: kartu "tidak ada apa-apa" di posisi
 * teratas hanya mendorong isi yang berguna ke bawah.
 */
export function TugasHariIni({ judul, tugas }: { judul: (jumlah: number) => string; tugas: Tugas[] }) {
  const ada = tugas.filter((x) => x.jumlah > 0);
  if (ada.length === 0) return null;

  return (
    <section className="beranda-kartu beranda-kartu-daftar" aria-labelledby="tugas-judul">
      <h2 id="tugas-judul" className="beranda-judul px-4 pb-1 pt-3">
        {/* Jumlah BARIS, bukan jumlah angkanya: "2 hal perlu dikerjakan" di atas
            satu baris berangka 2 membuat orang mencari baris kedua. */}
        {judul(ada.length)}
      </h2>
      <ul className="divide-y">
        {ada.map((x) => {
          const Ikon = x.ikon;
          return (
            <li key={x.kunci}>
              <Link href={x.href} className="flex min-h-12 items-center gap-3 px-4 py-2 transition-colors hover:bg-background/60">
                <span
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-full",
                    x.mendesak ? "bg-destructive/10 text-destructive" : "bg-amber-500/15 text-amber-800 dark:text-amber-300",
                  )}
                >
                  <Ikon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 text-sm leading-snug">{x.label}</span>
                <span
                  className={cn(
                    "shrink-0 text-base font-semibold tabular-nums",
                    x.mendesak ? "text-destructive" : "text-amber-800 dark:text-amber-300",
                  )}
                >
                  {x.jumlah}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
