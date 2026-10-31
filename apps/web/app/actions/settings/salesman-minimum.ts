"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { KUNCI_MIN_PERTAMA, KUNCI_MIN_ULANG, MIN_PESANAN_MAKS } from "@/lib/field-sales/minimum-pesanan";

/**
 * Minimum pesan PUTUS bertingkat: pesanan pertama vs pesan ulang.
 *
 * Dijaga `field_sales_orders:approve` — sama dengan pengaturan salesman lain;
 * izin itu sudah ada di prod, tidak ada yang perlu di-seed. `null` menghapus
 * barisnya: pesanan pertama kembali ke 6, pesan ulang kembali mengikuti
 * pesanan pertama. Hasil dikembalikan sebagai kode, tidak dilempar.
 */

type Hasil = { ok: true } | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" };

const sah = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MIN_PESANAN_MAKS;

export async function simpanMinimumPesanan(isi: { pertama: number | null; ulang: number | null }): Promise<Hasil> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) return { ok: false, code: "FORBIDDEN" };
  if (!isi || typeof isi !== "object") return { ok: false, code: "INVALID" };
  if (isi.pertama !== null && !sah(isi.pertama)) return { ok: false, code: "INVALID" };
  if (isi.ulang !== null && !sah(isi.ulang)) return { ok: false, code: "INVALID" };

  await prisma.$transaction(
    [
      [KUNCI_MIN_PERTAMA, isi.pertama],
      [KUNCI_MIN_ULANG, isi.ulang],
    ].map(([key, nilai]) =>
      nilai === null
        ? prisma.systemSetting.deleteMany({ where: { key: key as string } })
        : prisma.systemSetting.upsert({
            where: { key: key as string },
            create: { key: key as string, value: String(nilai) },
            update: { value: String(nilai) },
          }),
    ),
  );
  revalidatePath("/backoffice/settings/salesman");
  revalidatePath("/pwa");
  return { ok: true };
}
