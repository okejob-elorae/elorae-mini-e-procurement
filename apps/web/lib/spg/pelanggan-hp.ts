/**
 * Status dan barang favorit pelanggan toko untuk HP SPG — aturan murni, dipakai
 * `pelanggan-queries.ts`. Hari "tidur" dihitung dengan definisi yang SAMA
 * dengan layar kantor (`hariSejak` di `pelanggan-lacak.ts`: hari kalender WIB),
 * supaya pelanggan yang tidur di HP juga tidur di kantor.
 */
import { hariSejak } from "./pelanggan-lacak";

/**
 * Status pelanggan toko menurut nota-notanya DI TOKO ITU:
 * - `TIDUR`: belanja terakhir sudah `hariTidur` hari atau lebih (keputusan sementara 109: 90 hari);
 * - `KEMBALI`: punya dua nota atau lebih;
 * - `BARU`: satu nota;
 * - `BELUM_BELANJA`: belum ada nota.
 */
export type StatusPelangganHp = "BELUM_BELANJA" | "BARU" | "KEMBALI" | "TIDUR";

export function statusPelangganHp(input: { jumlahNota: number; terakhir: Date | null; sekarang: Date; hariTidur: number }): {
  status: StatusPelangganHp;
  /** Hari kalender WIB sejak belanja terakhir (0 = hari ini), atau null tanpa nota. */
  hariSejak: number | null;
} {
  if (input.jumlahNota <= 0 || !input.terakhir) return { status: "BELUM_BELANJA", hariSejak: null };
  const hari = Math.max(0, hariSejak(input.terakhir, input.sekarang));
  if (hari >= input.hariTidur) return { status: "TIDUR", hariSejak: hari };
  return { status: input.jumlahNota >= 2 ? "KEMBALI" : "BARU", hariSejak: hari };
}

/** Barang favorit pelanggan: potong BERSIH (terjual − dikembalikan) per barang, terbanyak dulu, nol dibuang. */
export function barangFavorit<T extends { itemId: string; nama: string; qty: number; kembali: number }>(baris: readonly T[], batas = 3): { itemId: string; nama: string; qty: number }[] {
  const per = new Map<string, { itemId: string; nama: string; qty: number }>();
  for (const b of baris) {
    const ada = per.get(b.itemId);
    const bersih = b.qty - b.kembali;
    if (ada) ada.qty += bersih;
    else per.set(b.itemId, { itemId: b.itemId, nama: b.nama, qty: bersih });
  }
  return [...per.values()]
    .filter((b) => b.qty > 0)
    .sort((a, b) => b.qty - a.qty || a.nama.localeCompare(b.nama, "id"))
    .slice(0, batas);
}
