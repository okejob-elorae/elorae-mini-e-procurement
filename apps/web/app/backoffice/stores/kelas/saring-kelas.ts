import type { KelasToko } from "@/lib/stores/kelas-toko";

/** Bagian baris Kelas toko yang dibaca saringan layar. */
export type BarisSaringKelas = {
  storeId: string;
  code: string;
  name: string;
  kelas: KelasToko | null;
  usulan: KelasToko | null;
};

/** Usulan yang bisa diterapkan: ada, dan berbeda dari kelas sekarang. */
export const bisaDiterapkan = (b: Pick<BarisSaringKelas, "kelas" | "usulan">) =>
  b.usulan !== null && b.usulan !== b.kelas;

/**
 * Saringan layar Kelas toko. Selain baris yang tampil, menghitung toko yang
 * cocok dengan pencarian tetapi disembunyikan "Hanya yang usulannya berbeda" —
 * supaya judul "Toko aktif (2 toko)" tidak terbaca seolah tokonya hanya dua,
 * dan toko tanpa pembelian (mis. toko konsinyasi yang belum dikirimi barang)
 * tidak lenyap tanpa penjelasan.
 */
export function saringKelasToko<T extends BarisSaringKelas>(
  baris: readonly T[],
  cari: string,
  hanyaBerbeda: boolean,
): { tampil: T[]; cocokCari: number; tanpaBeli: number; sudahSesuai: number } {
  const q = cari.trim().toLowerCase();
  const cocok = q
    ? baris.filter((b) => b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q))
    : [...baris];
  if (!hanyaBerbeda) return { tampil: cocok, cocokCari: cocok.length, tanpaBeli: 0, sudahSesuai: 0 };
  const tampil = cocok.filter(bisaDiterapkan);
  let tanpaBeli = 0;
  let sudahSesuai = 0;
  for (const b of cocok) {
    if (bisaDiterapkan(b)) continue;
    if (b.usulan === null) tanpaBeli += 1;
    else sudahSesuai += 1;
  }
  return { tampil, cocokCari: cocok.length, tanpaBeli, sudahSesuai };
}
