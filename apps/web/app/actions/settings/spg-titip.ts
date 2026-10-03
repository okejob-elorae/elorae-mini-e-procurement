"use server";

import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaTitipPesan, KUNCI_TITIP_PESAN } from "@/lib/spg/pengaturan";
import { JEJAK_TITIP } from "@/lib/spg/titip";

/**
 * Pengaturan → SPG → Titip pesan: berapa hari barang disimpankan untuk pembeli
 * sesudah dikabari (1–30). Dijaga `stores:manage`. Disimpan sebagai JSON di
 * `spg.titipPesan` dan harus terbaca kembali persis sama lewat `bacaTitipPesan`;
 * perubahannya meninggalkan jejak di transaksi yang sama.
 */

type Hasil = { ok: true } | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" };

export async function simpanAturanTitipPesan(isi: { hariSimpan: number }): Promise<Hasil> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE)) return { ok: false, code: "FORBIDDEN" };
  const hariSimpan = Number(isi?.hariSimpan);
  if (!Number.isInteger(hariSimpan) || hariSimpan < 1 || hariSimpan > 30) return { ok: false, code: "INVALID" };
  const aturan = { hariSimpan };
  const nilai = JSON.stringify(aturan);
  if (JSON.stringify(bacaTitipPesan(nilai)) !== nilai) return { ok: false, code: "INVALID" };

  await prisma.$transaction(async (tx) => {
    const lama = await tx.systemSetting.findUnique({ where: { key: KUNCI_TITIP_PESAN }, select: { value: true } });
    const sebelum = bacaTitipPesan(lama?.value ?? null);
    await tx.systemSetting.upsert({
      where: { key: KUNCI_TITIP_PESAN },
      create: { key: KUNCI_TITIP_PESAN, value: nilai },
      update: { value: nilai },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: JEJAK_TITIP.PENGATURAN,
        entityType: "SystemSetting",
        entityId: KUNCI_TITIP_PESAN,
        changes: { before: sebelum, after: aturan } as Prisma.InputJsonValue,
      },
    });
  });
  revalidatePath("/backoffice/settings/spg");
  return { ok: true };
}
