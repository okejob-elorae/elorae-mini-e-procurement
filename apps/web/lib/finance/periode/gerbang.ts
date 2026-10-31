import { readGlCutover } from "@/lib/finance/sales/sweep";

/**
 * Apakah dokumen yang periodenya berakhir `akhirPeriode` SELURUHNYA sebelum
 * tanggal mulai buku besar. Tanpa tanggal mulai → false (tidak ada lantai yang
 * bisa dilanggar; gerbang lain yang menahan buku besar yang belum aktif).
 */
export async function seluruhnyaSebelumTanggalMulai(akhirPeriode: Date, tanggalMulai?: Date | null): Promise<boolean> {
  const lantai = tanggalMulai !== undefined ? tanggalMulai : await readGlCutover();
  return lantai != null && akhirPeriode.getTime() < lantai.getTime();
}
