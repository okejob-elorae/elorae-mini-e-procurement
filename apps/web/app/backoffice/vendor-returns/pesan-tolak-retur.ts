import type { ProsesReturResult, SelesaikanReturResult } from "@/app/actions/vendor-returns";

/*
 * Pesan penolakan `processReturn` / `completeReturn` untuk layar retur pemasok
 * (daftar dan detail). Kunci di `vendorReturnsList.err.<kode>`; kode yang belum
 * punya teks memakai `cadangan`.
 */

export type TolakRetur = Extract<ProsesReturResult | SelesaikanReturResult, { ok: false }>;

type Penerjemah = {
  (kunci: string, nilai?: Record<string, string | number>): string;
  has(kunci: string): boolean;
};

export function pesanTolakRetur(hasil: TolakRetur, t: Penerjemah, cadangan: string, locale: string): string {
  const kunci = `err.${hasil.code}`;
  if (!t.has(kunci)) return cadangan;
  const format = new Intl.NumberFormat(locale === "en" ? "en-GB" : "id-ID", { maximumFractionDigits: 2 });
  const rincian = hasil as { barang?: string; perlu?: number; ada?: number };
  return t(kunci, {
    barang: rincian.barang ?? "",
    perlu: format.format(rincian.perlu ?? 0),
    ada: format.format(rincian.ada ?? 0),
  });
}

/** Penolakan yang berarti layar sudah basi (dokumen berubah/hilang) — muat ulang datanya. */
export function tolakReturBasi(hasil: TolakRetur): boolean {
  return ["TIDAK_DITEMUKAN", "SUDAH_DIPROSES", "SUDAH_SELESAI", "BELUM_DIPROSES"].includes(hasil.code);
}
