"use client";

import { cn } from "@/lib/utils";
import gaya from "./layar-masuk.module.css";

/**
 * Layar antara halaman masuk dan aplikasi — kartu judul film (lihat
 * `layar-masuk.module.css`).
 *
 * Satu markup untuk semua tahap, karena bingkai terakhir di halaman masuk dan
 * bingkai pertama di halaman tujuan harus sama persis sampai ke pikselnya —
 * dua markup yang "kira-kira sama" akan terlihat melompat saat dokumennya
 * berganti.
 */

export type TahapMasuk = "datang" | "tahan" | "sapa" | "buka";

type Props = {
  tahap: TahapMasuk;
  /** Kartu kedua. Hanya di halaman tujuan, setelah nama terbaca. */
  sapaan?: string | null;
  /** Kartu sapaan sudah (atau sedang) tampil — kartu judul tidak kembali. */
  sapaTampil?: boolean;
  className?: string;
};

export function LayarMasuk({ tahap, sapaan, sapaTampil, className }: Props) {
  return (
    <div
      className={cn(gaya.layar, className)}
      data-tahap={tahap}
      data-sapa={sapaTampil ? "" : undefined}
      aria-hidden
    >
      <div className={gaya.butir} />
      <p className={cn(gaya.kartu, gaya.judul)}>ELORAÉ</p>
      {sapaan ? <p className={cn(gaya.kartu, gaya.sapa)}>{sapaan}</p> : null}
    </div>
  );
}
