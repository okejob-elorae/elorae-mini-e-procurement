/**
 * SPG berhenti dan tanggal mulai bekerja — aturan murni (keputusan pemilik 2026-11-02).
 *
 * P66: SPG yang berhenti ditandai di Pengaturan → Pengguna: tokonya dilepas (`assignedStoreId`
 * dikosongkan, `spgEndedStoreId` mengingatnya) dan HP-nya tidak bisa lagi membuka layar SPG. Hari
 * terakhirnya dicatat (`spgEndedOn`) — gaji bulan itu dibayar sebanyak hari terjadwalnya saja (P62),
 * dan pembayaran terakhirnya membawa semua koreksi; sisanya menjadi utang SPG (P6a).
 *
 * P62 membutuhkan tanggal mulai bekerja di toko (`spgStartedOn`): wajib diisi saat toko tetap diisi
 * pada peran SPG, dan hanya boleh diubah selama belum ada gaji yang dibayar.
 *
 * SPG tidak pernah pindah toko (fakta pemilik 2026-11-02): SPG aktif yang sudah punya riwayat
 * (check-in, penjualan, jadwal, catatan check-in, atau baris gaji) tidak bisa dipindah toko atau
 * diganti perannya — kantor memakai "SPG berhenti".
 */

export const JEJAK_SPG_BERHENTI = { DITANDAI: "SPG_ENDED", DIBATALKAN: "SPG_END_CANCELLED" } as const;

export const MAKS_ALASAN_BERHENTI = 500;

export type KodeTolakBerhenti =
  | "BUKAN_SPG"
  | "TANGGAL_TIDAK_SAH"
  | "TANGGAL_DEPAN"
  | "SEBELUM_MULAI"
  | "ADA_KEGIATAN_SESUDAH"
  | "SUDAH_BERHENTI"
  | "ALASAN_WAJIB"
  | "ALASAN_TERLALU_PANJANG";

const POLA_HARI = /^\d{4}-\d{2}-\d{2}$/;

export function hariSah(x: unknown): x is string {
  if (typeof x !== "string" || !POLA_HARI.test(x)) return false;
  const t = Date.parse(`${x}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === x;
}

/**
 * Periksa penanda berhenti sebelum menulis. `kegiatanTerakhir` = hari WIB check-in atau penjualan
 * terakhirnya di tokonya (null kalau belum pernah) — hari terakhir tidak boleh lebih dulu dari itu.
 */
export function periksaBerhentiSpg(m: {
  hariTerakhir: unknown;
  alasan: unknown;
  hariIni: string;
  mulai: string | null;
  kegiatanTerakhir: string | null;
}): { ok: true; hariTerakhir: string; alasan: string } | { ok: false; kode: KodeTolakBerhenti } {
  if (!hariSah(m.hariTerakhir)) return { ok: false, kode: "TANGGAL_TIDAK_SAH" };
  if (m.hariTerakhir > m.hariIni) return { ok: false, kode: "TANGGAL_DEPAN" };
  if (m.mulai && m.hariTerakhir < m.mulai) return { ok: false, kode: "SEBELUM_MULAI" };
  if (m.kegiatanTerakhir && m.hariTerakhir < m.kegiatanTerakhir) return { ok: false, kode: "ADA_KEGIATAN_SESUDAH" };
  const alasan = typeof m.alasan === "string" ? m.alasan.trim() : "";
  if (!alasan) return { ok: false, kode: "ALASAN_WAJIB" };
  if (alasan.length > MAKS_ALASAN_BERHENTI) return { ok: false, kode: "ALASAN_TERLALU_PANJANG" };
  return { ok: true, hariTerakhir: m.hariTerakhir, alasan };
}

export type KodeTolakMulai = "TANGGAL_TIDAK_SAH" | "MULAI_TERKUNCI" | "MULAI_SESUDAH_KEGIATAN" | "BUKAN_SPG";

/**
 * Tanggal mulai bekerja: sah, dan tidak sesudah check-in atau penjualan pertamanya di toko itu
 * (`kegiatanPertama`). Penguncinya (sudah ada gaji yang dibayar) diperiksa penulisnya.
 */
export function periksaMulaiSpg(m: { mulai: unknown; kegiatanPertama: string | null }): { ok: true; mulai: string } | { ok: false; kode: KodeTolakMulai } {
  if (!hariSah(m.mulai)) return { ok: false, kode: "TANGGAL_TIDAK_SAH" };
  if (m.kegiatanPertama && m.mulai > m.kegiatanPertama) return { ok: false, kode: "MULAI_SESUDAH_KEGIATAN" };
  return { ok: true, mulai: m.mulai };
}

/**
 * Perubahan toko / peran pengguna SPG lewat formulir Pengguna (B27). SPG yang sudah berhenti: tokonya
 * hanya boleh tetap kosong (`BERHENTI_BATALKAN_DULU` — pakai "Batalkan berhenti"). SPG aktif yang
 * sudah punya riwayat: toko tidak boleh diganti atau dikosongkan, dan perannya tidak boleh diganti
 * dari SPG (`SPG_GUNAKAN_BERHENTI`). Sebelum ada riwayat, toko yang salah masih bisa dibetulkan.
 */
export function tolakPerubahanSpg(m: {
  berhenti: boolean;
  adaRiwayat: boolean;
  tokoLama: string | null;
  tokoBaru: string | null;
  spgLama: boolean;
  spgBaru: boolean;
}): "SPG_GUNAKAN_BERHENTI" | "BERHENTI_BATALKAN_DULU" | null {
  if (m.berhenti) return m.tokoBaru ? "BERHENTI_BATALKAN_DULU" : null;
  if (!m.spgLama || !m.tokoLama || !m.adaRiwayat) return null;
  if (!m.spgBaru || m.tokoBaru !== m.tokoLama) return "SPG_GUNAKAN_BERHENTI";
  return null;
}
