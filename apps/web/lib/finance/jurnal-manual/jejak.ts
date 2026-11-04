/*
 * Nama tindakan jejak (`AuditLog.action`) jurnal manual: pengajuan, perubahan
 * draf, persetujuan, penolakan/penarikan, dan pengajuan pembalik. Murni dan
 * aman untuk klien. Setiap nama punya label di `auditActions.actions.<NAMA>`
 * (kedua bahasa) — `lib/finance/aset/jejak.test.ts` menuntutnya.
 */
export const JEJAK_JURNAL_MANUAL = {
  DIAJUKAN: "JOURNAL_SUBMITTED",
  DRAF_DIUBAH: "JOURNAL_DRAFT_UPDATED",
  DISETUJUI: "JOURNAL_APPROVED",
  DITOLAK: "JOURNAL_REJECTED",
  DITARIK: "JOURNAL_WITHDRAWN",
  PEMBALIK_DIAJUKAN: "JOURNAL_REVERSAL_SUBMITTED",
} as const;

export type JejakJurnalManual = (typeof JEJAK_JURNAL_MANUAL)[keyof typeof JEJAK_JURNAL_MANUAL];

export const ENTITAS_JURNAL = "Journal";
