"use server";

import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaAturanMember, JEJAK_MEMBER, KUNCI_MEMBER, sahkanAturanMember, type AturanMember } from "@/lib/spg/member";

/**
 * Program member & pelacakan pelanggan SPG (`spg.member`): pendaftaran, tingkat
 * dan diskonnya, gabung dengan promo barang, bagian toko konsinyasi, belanja
 * minimal untuk mendaftar, dan batas pelanggan "tidur". Dijaga `promos:manage`
 * — diskon member adalah potongan harga, keputusan yang sama dengan promo dan
 * diskon manual. Menyalakan diskon member mengurangi pendapatan di setiap
 * toko, jadi setiap perubahan meninggalkan jejak `AuditLog` dengan
 * sebelum/sesudah di transaksi yang sama.
 */

type Hasil = { ok: true } | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" };

export async function simpanAturanMemberSpg(isi: AturanMember): Promise<Hasil> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.PROMOS_MANAGE)) return { ok: false, code: "FORBIDDEN" };
  const aturan = sahkanAturanMember(isi);
  if (!aturan) return { ok: false, code: "INVALID" };
  const nilai = JSON.stringify(aturan);

  await prisma.$transaction(async (tx) => {
    const lama = await tx.systemSetting.findUnique({ where: { key: KUNCI_MEMBER }, select: { value: true } });
    const before = bacaAturanMember(lama?.value ?? null);
    await tx.systemSetting.upsert({
      where: { key: KUNCI_MEMBER },
      create: { key: KUNCI_MEMBER, value: nilai },
      update: { value: nilai },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: JEJAK_MEMBER.PENGATURAN_DIUBAH,
        entityType: "SystemSetting",
        entityId: KUNCI_MEMBER,
        changes: { before, after: aturan } as Prisma.InputJsonValue,
      },
    });
  });
  revalidatePath("/backoffice/settings/spg");
  revalidatePath("/backoffice/spg-pelanggan");
  revalidatePath("/pwa/spg/sale");
  return { ok: true };
}
