/*
 * Nama tindakan jejak (`AuditLog.action`) tutup buku, tanggal mulai buku
 * besar, dan sapuan dokumen tanpa jurnal. Murni dan aman untuk klien. Setiap
 * nama punya label di `auditActions.actions.<NAMA>` (kedua bahasa) —
 * `jejak.test.ts` menuntutnya. Jangan menulis nama tindakan sebagai string bebas.
 */
export const JEJAK_PERIODE = {
  BULAN_DITUTUP: "ACCOUNTING_PERIOD_CLOSED",
  BULAN_DIBUKA: "ACCOUNTING_PERIOD_REOPENED",
  TAHUN_DITUTUP: "ACCOUNTING_YEAR_CLOSED",
  TAHUN_DIBUKA: "ACCOUNTING_YEAR_REOPENED",
  TANGGAL_MULAI_DIUBAH: "GL_CUTOVER_DATE_SET",
} as const;

export type JejakPeriode = (typeof JEJAK_PERIODE)[keyof typeof JEJAK_PERIODE];

export const ENTITAS_PERIODE = "AccountingPeriod";
export const ENTITAS_TAHUN = "AccountingYear";
export const ENTITAS_PENGATURAN = "SystemSetting";
