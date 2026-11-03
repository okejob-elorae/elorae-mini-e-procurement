/**
 * Jenis tagihan di Faktur & piutang: konsinyasi atau bukan.
 *
 * Tagihan konsinyasi masuk Piutang sejak keputusan pemilik 2026-10-29 ("Daftar
 * Piutang diberi filter konsi / non-konsi"). Penandanya SATU kolom,
 * `Receivable.isConsignment`, diisi saat tagihan dibuat dan tidak pernah
 * diubah — bukan `Store.termsType` hari ini, yang bisa berganti sesudah
 * tagihannya terbit.
 *
 * Murni dan tanpa impor — boleh dipakai komponen klien.
 */

export const JENIS_TAGIHAN = ["konsi", "nonkonsi"] as const;

export type JenisTagihan = (typeof JENIS_TAGIHAN)[number];

/** `?jenis=` dari alamat. Kosong atau nilai lain = semua jenis (null), bukan ditolak. */
export function bacaJenisTagihan(raw: string | string[] | undefined | null): JenisTagihan | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && (JENIS_TAGIHAN as readonly string[]).includes(v) ? (v as JenisTagihan) : null;
}

/** Apakah tagihan berpenanda `konsi` masuk saringan `jenis`. Tanpa saringan semua masuk. */
export function cocokJenisTagihan(konsi: boolean, jenis: JenisTagihan | null): boolean {
  if (jenis === null) return true;
  return jenis === "konsi" ? konsi : !konsi;
}

/**
 * Asal sebuah tagihan, untuk label sumbernya di layar:
 * - `SIKLUS_KONSI`  — lahir saat angka terjual siklus konsinyasi dikunci;
 * - `LAPORAN_KONSI` — laporan sell-through tim (jalur lama, tidak menagih lagi);
 * - `IMPORT` / `MANUAL` — impor Excel / faktur ketik manual;
 * - `DELIVERY` — nota tagihan pengiriman putus.
 */
export type AsalTagihan = "DELIVERY" | "IMPORT" | "MANUAL" | "SIKLUS_KONSI" | "LAPORAN_KONSI";

export function asalTagihan(r: {
  source: string;
  sellThroughId: string | null;
  consignmentCycleId: string | null;
}): AsalTagihan {
  if (r.consignmentCycleId) return "SIKLUS_KONSI";
  if (r.sellThroughId) return "LAPORAN_KONSI";
  if (r.source === "IMPORT") return "IMPORT";
  if (r.source === "MANUAL") return "MANUAL";
  return "DELIVERY";
}
