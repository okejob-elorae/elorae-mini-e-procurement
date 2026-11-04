/*
 * Nama tindakan jejak (`AuditLog.action`) jurnal berulang. Murni dan aman
 * untuk klien. Setiap nama punya label di `auditActions.actions.<NAMA>`
 * (kedua bahasa) — `lib/finance/aset/jejak.test.ts` menuntutnya.
 *
 * Templat tidak punya kolom status persetujuan: keadaannya DITURUNKAN dari
 * jejak ini (`keadaanTemplat`) — isi yang dibuat/diubah menunggu persetujuan
 * orang lain sampai ada `DISETUJUI` sesudahnya.
 */
export const JEJAK_BERULANG = {
  DIBUAT: "RECURRING_JOURNAL_CREATED",
  DIUBAH: "RECURRING_JOURNAL_UPDATED",
  DISETUJUI: "RECURRING_JOURNAL_APPROVED",
  DIHENTIKAN: "RECURRING_JOURNAL_PAUSED",
  DILANJUTKAN: "RECURRING_JOURNAL_RESUMED",
  DIHAPUS: "RECURRING_JOURNAL_DELETED",
  DILEWATI: "RECURRING_JOURNAL_SKIPPED",
} as const;

export type JejakBerulang = (typeof JEJAK_BERULANG)[keyof typeof JEJAK_BERULANG];

/** Jejak yang MENGUBAH isi templat (dan karena itu menuntut persetujuan ulang). */
export const JEJAK_ISI_TEMPLAT: readonly string[] = [JEJAK_BERULANG.DIBUAT, JEJAK_BERULANG.DIUBAH];

export const ENTITAS_BERULANG = "RecurringJournal";
