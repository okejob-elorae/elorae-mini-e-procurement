import type { BarisSiklus, TahapSiklusLengkap } from "@/lib/konsinyasi/queries";
import { cocokCari } from "../piutang/_daftar/halaman";
import { URUT_TAHAP } from "./tahap";

/**
 * Saringan daftar siklus konsinyasi (`?tahap=`, `?cari=`).
 *
 * Bawaannya siklus yang belum selesai — yang sudah tuntas (toko sudah bayar)
 * tidak menuntut apa pun, sama seperti faktur lunas di daftar piutang. `semua`
 * menampilkan semuanya.
 */
export type SaringSiklus = "berjalan" | "semua" | TahapSiklusLengkap;

export function bacaSaringSiklus(raw: string | undefined): SaringSiklus {
  if (raw === "semua") return "semua";
  return raw && (URUT_TAHAP as readonly string[]).includes(raw) ? (raw as TahapSiklusLengkap) : "berjalan";
}

export function saringSiklus<T extends Pick<BarisSiklus, "tahap" | "noKonsi" | "storeName" | "periode" | "noNota" | "noFakturPajak">>(
  baris: T[],
  s: { saring: SaringSiklus; cari: string },
): T[] {
  return baris.filter((b) => {
    const lolos = s.saring === "semua" ? true : s.saring === "berjalan" ? b.tahap !== "selesai" : b.tahap === s.saring;
    return lolos && cocokCari(s.cari, b.noKonsi, b.storeName, b.periode, b.noNota, b.noFakturPajak);
  });
}
