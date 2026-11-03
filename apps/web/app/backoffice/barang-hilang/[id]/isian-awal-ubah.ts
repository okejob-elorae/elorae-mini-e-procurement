import type { IsianBagian } from "@/lib/spg/hilang";
import type { RincianHilangKantor } from "@/lib/spg/hilang-queries";

/**
 * Isian awal dialog "Ubah keputusan" barang hilang. Murni (tanpa Prisma) supaya dites.
 *
 * - Total mulai dari `totalBawaanUbah` — bawaan yang sama dengan penulisnya (`ubahKeputusanHilang`):
 *   sesudah klaim ekspedisi DITOLAK itu Σ nilai baris (penanggung lain dinilai menurut pengaturan
 *   barang hilang; hanya klaim ekspedisi memakai nilai jual di nota, P42/R19), selain itu total
 *   keputusan yang berlaku.
 * - Bagian mulai dari pembagian SEBELUM keringanan yang tercatat di jejak (keringanan tidak
 *   diterapkan dua kali), atau bagian yang berlaku. Sesudah klaim ekspedisi DITOLAK, bagian
 *   EKSPEDISI itu TIDAK ikut terisi: nilainya nilai nota, dan penanggung baru dipilih kantor sendiri.
 */
export function isianAwalUbah(
  r: Pick<RincianHilangKantor, "totalBawaanUbah" | "bagian" | "keringanan">,
): { total: number; bagian: IsianBagian[] } {
  const klaimDitolak = r.bagian.some((b) => b.bearer === "EKSPEDISI" && b.klaim?.status === "DITOLAK");
  const sumber: IsianBagian[] =
    r.keringanan && r.keringanan.sebelum.length > 0
      ? r.keringanan.sebelum
      : r.bagian.map((b) => ({ bearer: b.bearer, bearerUserId: b.orang?.id ?? null, amount: b.nilai }));
  return { total: r.totalBawaanUbah, bagian: klaimDitolak ? sumber.filter((b) => b.bearer !== "EKSPEDISI") : sumber };
}
