import type { Prisma } from "@elorae/db";

/**
 * Nama tindakan jejak (`AuditLog.action`) modul pajak — SATU tempat, supaya
 * jejaknya bisa dicari. Ditulis DI DALAM transaksi perubahannya
 * (`catatJejakPajak`), membawa pasangan sebelum/sesudah bila ada.
 */
export const JEJAK_PAJAK = {
  PPN_MASA_FINAL: "TAX_PPN_PERIOD_FINALIZED",
  PPN_MASA_DIBUKA: "TAX_PPN_PERIOD_REOPENED",
  PPH_FINAL_DIPOSTING: "TAX_FINAL_PPH_POSTED",
  PPH_FINAL_DIBUKA: "TAX_FINAL_PPH_REOPENED",
  SETORAN_DICATAT: "TAX_PAYMENT_RECORDED",
  SETORAN_DIBATALKAN: "TAX_PAYMENT_CANCELLED",
  PENGATURAN_PPN_DIUBAH: "TAX_PPN_SETTINGS_CHANGED",
  PROFIL_PAJAK_DIUBAH: "TAX_PROFILE_CHANGED",
  IDENTITAS_PAJAK_DIUBAH: "TAX_IDENTITY_CHANGED",
  FAKTUR_DIEKSPOR: "TAX_INVOICES_EXPORTED",
} as const;

export type JejakPajak = (typeof JEJAK_PAJAK)[keyof typeof JEJAK_PAJAK];

export async function catatJejakPajak(
  tx: Pick<Prisma.TransactionClient, "auditLog">,
  data: {
    userId: string;
    action: JejakPajak;
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
