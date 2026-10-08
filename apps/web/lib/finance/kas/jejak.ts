import type { Prisma } from "@elorae/db";

/**
 * Nama tindakan jejak (`AuditLog.action`) kas & bank, rekonsiliasi bank, dan
 * pembayaran pemasok — SATU tempat, supaya jejaknya bisa dicari. Ditulis DI
 * DALAM transaksi perubahannya, membawa pasangan sebelum/sesudah bila ada.
 * Setiap nama punya label `auditActions.actions.<NAMA>` di kedua bahasa.
 */
export const JEJAK_KAS = {
  VOUCHER_DICATAT: "CASH_VOUCHER_RECORDED",
  VOUCHER_DIBATALKAN: "CASH_VOUCHER_CANCELLED",
  KATEGORI_DISIMPAN: "CASH_CATEGORY_SAVED",
  KATEGORI_BAWAAN: "CASH_CATEGORY_DEFAULTS_INSTALLED",
  KAS_KECIL_DIUBAH: "PETTY_CASH_SETTINGS_CHANGED",
  MUTASI_DIIMPOR: "BANK_STATEMENT_IMPORTED",
  MUTASI_IMPOR_DIHAPUS: "BANK_STATEMENT_IMPORT_DELETED",
  MUTASI_DICOCOKKAN: "BANK_STATEMENT_MATCHED",
  MUTASI_DICOCOKKAN_OTOMATIS: "BANK_STATEMENT_AUTO_MATCHED",
  MUTASI_DILEPAS: "BANK_STATEMENT_UNMATCHED",
  MUTASI_DIABAIKAN: "BANK_STATEMENT_IGNORED",
  MUTASI_DIBUKA: "BANK_STATEMENT_UNIGNORED",
  PEMBAYARAN_DICATAT: "SUPPLIER_PAYMENT_RECORDED",
  PEMBAYARAN_DIBATALKAN: "SUPPLIER_PAYMENT_CANCELLED",
  UANG_MUKA_DITERAPKAN: "SUPPLIER_ADVANCE_APPLIED",
  PO_LUNAS_DARI_PEMBAYARAN: "PO_PAID_BY_SUPPLIER_PAYMENTS",
  PO_LUNAS_DIBUKA_PEMBATALAN: "PO_UNPAID_BY_PAYMENT_CANCEL",
} as const;

export type JejakKas = (typeof JEJAK_KAS)[keyof typeof JEJAK_KAS];

export async function catatJejakKas(
  tx: Pick<Prisma.TransactionClient, "auditLog">,
  data: {
    userId: string;
    action: JejakKas;
    entityType: string;
    entityId: string;
    changes?: { before?: unknown; after?: unknown };
    metadata?: Record<string, unknown>;
    reason?: string | null;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: data.userId,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      changes: (data.changes ?? undefined) as Prisma.InputJsonValue | undefined,
      metadata: (data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      reason: data.reason ?? null,
    },
  });
}
