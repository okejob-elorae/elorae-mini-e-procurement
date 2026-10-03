"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { perannyaSpg, rapikanEmail, validasiPengguna, type KodeValidasi } from "@/lib/users/validasi";

/**
 * Tambah dan ubah akun pengguna (sales, SPG, admin, …) dari Pengaturan.
 *
 * Dijaga `settings_security:manage` — izin yang sama dengan mengganti peran
 * pengguna. Sandi hanya pernah disimpan sebagai hash bcrypt dan tidak pernah
 * dikembalikan ke layar. Setiap perubahan menulis jejak audit TANPA sandi.
 */

export type KodeSimpanPengguna =
  | KodeValidasi
  | "FORBIDDEN"
  | "VALIDATION"
  | "PERAN_TIDAK_DITEMUKAN"
  | "TOKO_TIDAK_DITEMUKAN"
  | "EMAIL_DIPAKAI"
  | "TIDAK_DITEMUKAN"
  | "PERAN_SENDIRI";

export type HasilSimpanPengguna = { ok: true; id: string } | { ok: false; codes: KodeSimpanPengguna[] };

const schema = z.object({
  id: z.string().min(1).nullable(),
  nama: z.string().max(191),
  email: z.string().max(191),
  roleId: z.string().min(1),
  tokoId: z.string().min(1).nullable(),
  sandi: z.string().max(200),
  ulangSandi: z.string().max(200),
});

export async function simpanPenggunaAction(input: unknown): Promise<HasilSimpanPengguna> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SETTINGS_SECURITY_MANAGE)) {
    return { ok: false, codes: ["FORBIDDEN"] };
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, codes: ["VALIDATION"] };
  const d = parsed.data;
  const baru = d.id === null;

  const peran = await prisma.roleDefinition.findUnique({
    where: { id: d.roleId },
    select: { id: true, name: true, permissions: { select: { permission: { select: { code: true } } } } },
  });
  if (!peran) return { ok: false, codes: ["PERAN_TIDAK_DITEMUKAN"] };
  const butuhToko = perannyaSpg(peran.permissions.map((p) => p.permission.code));

  const galat = validasiPengguna({ baru, nama: d.nama, email: d.email, sandi: d.sandi, ulangSandi: d.ulangSandi, butuhToko, tokoId: d.tokoId });
  if (galat.length) return { ok: false, codes: galat };

  const tokoId = butuhToko ? d.tokoId : null;
  if (tokoId) {
    const toko = await prisma.store.count({ where: { id: tokoId, isActive: true } });
    if (!toko) return { ok: false, codes: ["TOKO_TIDAK_DITEMUKAN"] };
  }

  const email = rapikanEmail(d.email);
  const nama = d.nama.trim();
  const sandiBaru = d.sandi !== "";
  const passwordHash = sandiBaru ? await bcrypt.hash(d.sandi, 10) : undefined;

  try {
    if (baru) {
      const dibuat = await prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: { name: nama, email, roleId: peran.id, assignedStoreId: tokoId, passwordHash },
          select: { id: true },
        });
        await tx.auditLog.create({
          data: {
            userId: session.user.id,
            action: "USER_CREATED",
            entityType: "User",
            entityId: u.id,
            changes: { after: { name: nama, email, role: peran.name, assignedStoreId: tokoId } },
          },
        });
        return u;
      });
      revalidatePath("/backoffice/settings/users");
      return { ok: true, id: dibuat.id };
    }

    const id = d.id as string;
    const lama = await prisma.user.findUnique({
      where: { id },
      select: { name: true, email: true, roleId: true, assignedStoreId: true },
    });
    if (!lama) return { ok: false, codes: ["TIDAK_DITEMUKAN"] };
    // Admin yang mengganti perannya sendiri bisa terkunci keluar dari halaman ini.
    if (id === session.user.id && lama.roleId !== peran.id) return { ok: false, codes: ["PERAN_SENDIRI"] };

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { name: nama, email, roleId: peran.id, assignedStoreId: tokoId, ...(passwordHash ? { passwordHash } : {}) },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "USER_UPDATED",
          entityType: "User",
          entityId: id,
          changes: {
            before: { name: lama.name, email: lama.email, roleId: lama.roleId, assignedStoreId: lama.assignedStoreId },
            after: { name: nama, email, roleId: peran.id, assignedStoreId: tokoId },
          },
          metadata: { sandiDiganti: sandiBaru },
        },
      });
    });
    revalidatePath("/backoffice/settings/users");
    return { ok: true, id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, codes: ["EMAIL_DIPAKAI"] };
    }
    throw err;
  }
}
