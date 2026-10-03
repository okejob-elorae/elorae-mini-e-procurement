"use client";

import { cn } from "@/lib/utils";
import gaya from "./layar-masuk.module.css";

/**
 * Penutup polos di halaman pertama sesudah masuk, berwarna latar dasbor
 * (`--background` tema pengguna). Menutup dasbor sejak bingkai pertama selagi
 * pertunjukan 3D diunduh, supaya dasbor tidak berkedip lalu tertutup. Tanpa
 * teks dan tanpa layar hitam — keduanya dilepas atas permintaan pemilik
 * (2026-10-01). Pertunjukannya sendiri mulai dari warna yang sama.
 */

export type TahapMasuk = "tahan" | "buka";

export function LayarMasuk({ tahap, className }: { tahap: TahapMasuk; className?: string }) {
  return <div className={cn(gaya.layar, className)} data-tahap={tahap} aria-hidden />;
}
