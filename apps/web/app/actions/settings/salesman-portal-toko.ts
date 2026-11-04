"use server";

import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  bacaAturanPortalToko,
  KUNCI_PORTAL_TOKO,
  sahkanAturanPortalToko,
  type AturanPortalToko,
} from "@/lib/field-sales/portal-toko-aturan";

/**
 * Portal pesan mandiri toko: nyala/mati, masa berlaku tautan baru, dan batas
 * pesanan per toko per hari. Disimpan sebagai JSON di `salesman.portalToko`,
 * dibaca lewat `bacaAturanPortalToko` — nilai yang disimpan harus terbaca
 * kembali persis sama.
 *
 * Dijaga `field_sales_orders:approve`, sama dengan pengaturan salesman lain.
 * Mematikan portal adalah keputusan yang bisa dibalik dan langsung mematikan
 * setiap tautan toko, jadi perubahannya meninggalkan jejak `AuditLog` di
 * transaksi yang sama.
 */

const AKSI_PENGATURAN_PORTAL = "STORE_PORTAL_SETTINGS_UPDATED";

type Hasil = { ok: true } | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" };

export async function simpanAturanPortalToko(isi: AturanPortalToko): Promise<Hasil> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) return { ok: false, code: "FORBIDDEN" };
  const aturan = sahkanAturanPortalToko(isi);
  if (!aturan) return { ok: false, code: "INVALID" };
  const nilai = JSON.stringify(aturan);
  if (JSON.stringify(bacaAturanPortalToko(nilai)) !== nilai) return { ok: false, code: "INVALID" };

  await prisma.$transaction(async (tx) => {
    const lama = await tx.systemSetting.findUnique({ where: { key: KUNCI_PORTAL_TOKO }, select: { value: true } });
    const sebelum = bacaAturanPortalToko(lama?.value ?? null);
    await tx.systemSetting.upsert({
      where: { key: KUNCI_PORTAL_TOKO },
      create: { key: KUNCI_PORTAL_TOKO, value: nilai },
      update: { value: nilai },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: AKSI_PENGATURAN_PORTAL,
        entityType: "SystemSetting",
        entityId: KUNCI_PORTAL_TOKO,
        changes: { sebelum, sesudah: aturan } as Prisma.InputJsonValue,
      },
    });
  });
  revalidatePath("/backoffice/settings/salesman");
  return { ok: true };
}
