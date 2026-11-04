/*
 * Nama tindakan jejak (`AuditLog.action`) aset tetap. Murni dan aman untuk
 * klien. Setiap nama punya label di `auditActions.actions.<NAMA>` (kedua
 * bahasa) — `lib/finance/aset/jejak.test.ts` menuntutnya.
 */
export const JEJAK_ASET = {
  DICATAT: "FIXED_ASSET_CREATED",
  DIUBAH: "FIXED_ASSET_UPDATED",
  DIBATALKAN: "FIXED_ASSET_CANCELLED",
  DILEPAS: "FIXED_ASSET_DISPOSED",
  PELEPASAN_DIBATALKAN: "FIXED_ASSET_DISPOSAL_CANCELLED",
  PENYUSUTAN_DIJALANKAN: "FIXED_ASSET_DEPRECIATION_RUN",
} as const;

export type JejakAset = (typeof JEJAK_ASET)[keyof typeof JEJAK_ASET];

export const ENTITAS_ASET = "FixedAsset";
