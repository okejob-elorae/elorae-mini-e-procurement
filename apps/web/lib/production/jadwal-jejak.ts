/*
 * Jadwal produksi per tahap — nama tindakan jejak dan kode penolakan
 * (2026-10-07). Murni dan aman untuk klien: layar boleh mengimpor berkas ini
 * untuk memetakan kode ke teks (`jadwalProduksi.server.err<KODE>`) dan label
 * jejak (`auditActions.actions.<KODE>`), tanpa ikut menarik Prisma.
 */

/** `AuditLog.action` untuk setiap penulis jadwal. Jangan menulis nama tindakan sebagai string bebas. */
export const JEJAK_JADWAL = {
  /** Langkah ditarik dari rantai Lead Time pemasok (tambah atau ganti). */
  DITARIK: "PLAN_STAGE_SCHEDULE_PULLED",
  LANGKAH_DITAMBAH: "PLAN_STAGE_STEP_ADDED",
  LANGKAH_DIUBAH: "PLAN_STAGE_STEP_UPDATED",
  STATUS_DIUBAH: "PLAN_STAGE_STEP_STATUS_CHANGED",
  URUTAN_DIPINDAH: "PLAN_STAGE_STEP_MOVED",
  LANGKAH_DIHAPUS: "PLAN_STAGE_STEP_DELETED",
  /** Tanggal mulai (maju) atau tenggat (mundur) tahap diatur. */
  MULAI_DIATUR: "PLAN_STAGE_SCHEDULE_START_SET",
  HARI_KERJA_DIUBAH: "PRODUCTION_WORKDAYS_UPDATED",
  TANGGAL_MERAH_DIUBAH: "PRODUCTION_HOLIDAYS_UPDATED",
} as const;

export type JejakJadwal = (typeof JEJAK_JADWAL)[keyof typeof JEJAK_JADWAL];

export const ENTITAS_TAHAP = "PlanStage";
export const ENTITAS_LANGKAH = "PlanStageStep";
export const ENTITAS_PENGATURAN = "SystemSetting";

/**
 * Semua kode penolakan penulis, kueri, dan aksi jadwal. Setiap kode punya teks
 * di `jadwalProduksi.server.err<KODE>` (kedua bahasa).
 */
export const KODE_GALAT_JADWAL = [
  "TANPA_AKSES",
  "ISIAN_TIDAK_SAH",
  "TAHAP_TIDAK_ADA",
  "LANGKAH_TIDAK_ADA",
  "ADA_LANGKAH_BERJALAN",
  "TANGGAL_TIDAK_SAH",
  "DURASI_TIDAK_SAH",
  "NAMA_WAJIB",
  "NAMA_TERLALU_PANJANG",
  "PEMASOK_TIDAK_ADA",
  "TANPA_LANGKAH_LEAD_TIME",
  "HARI_KERJA_TIDAK_SAH",
  "GAGAL",
] as const;

export type KodeGalatJadwal = (typeof KODE_GALAT_JADWAL)[number];

/** Batas lama satu langkah (hari kerja) — lebih dari ini pasti salah ketik. */
export const DURASI_MAKS_HARI = 3650;

/** `PlanStageStep.name` di MariaDB adalah VARCHAR(191). */
export const NAMA_LANGKAH_MAKS = 191;

/** Nama tanggal merah ("Idulfitri 1448 H"). */
export const NAMA_LIBUR_MAKS = 100;

/** Baris follow-up per halaman. */
export const UKURAN_HALAMAN_FOLLOW_UP = 50;

export const SARINGAN_FOLLOW_UP = ["hari-ini", "terlambat", "minggu-ini", "semua"] as const;
export type SaringanFollowUp = (typeof SARINGAN_FOLLOW_UP)[number];
