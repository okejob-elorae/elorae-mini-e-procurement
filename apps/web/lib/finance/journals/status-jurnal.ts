/**
 * Status jurnal (`Journal.status`) — murni, aman untuk komponen klien.
 *
 * - `POSTED`  — berlaku; SATU-SATUNYA status yang boleh dihitung saldo,
 *   laporan keuangan, rekonsiliasi, dan integritas buku besar. Semua jurnal
 *   lama terbaca POSTED (DEFAULT kolom).
 * - `DRAFT`   — jurnal manual yang menunggu persetujuan orang LAIN
 *   (maker-checker). Tidak pernah dihitung.
 * - `REJECTED` — draf yang ditolak (`rejectedById/At/rejectReason`); barisnya
 *   tetap ada sebagai jejak, tidak pernah dihitung.
 *
 * Setiap kueri yang menjumlah `JournalLine` WAJIB menyaring
 * `journal: SARING_JURNAL_BERLAKU` begitu jurnal DRAFT bisa dibuat — kalau
 * tidak, draf yang belum disetujui sudah mengubah Neraca.
 */
export const STATUS_JURNAL = {
  POSTED: "POSTED",
  DRAFT: "DRAFT",
  REJECTED: "REJECTED",
} as const;

export type StatusJurnal = (typeof STATUS_JURNAL)[keyof typeof STATUS_JURNAL];

/** Saringan Prisma (`where: { journal: SARING_JURNAL_BERLAKU }`) untuk jurnal yang dihitung. */
export const SARING_JURNAL_BERLAKU = { status: STATUS_JURNAL.POSTED } as const;

export function jurnalBerlaku(status: string | null | undefined): boolean {
  // Baris tanpa status (klien lama, data uji tiruan) diperlakukan seperti DEFAULT kolomnya.
  return (status ?? STATUS_JURNAL.POSTED) === STATUS_JURNAL.POSTED;
}
