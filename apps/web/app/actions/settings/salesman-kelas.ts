"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaAturanKelasToko, KUNCI_KELAS_TOKO, type AturanKelasToko } from "@/lib/stores/kelas-toko";

/**
 * Aturan kelas toko: jarak kunjungan per kelas A/B/C dan usulan kelas otomatis.
 *
 * Dijaga `field_sales_orders:approve`, sama dengan pengaturan salesman lain di
 * layar yang sama (batas hari kunjungan, target) — izin itu sudah ada di prod,
 * tidak ada yang perlu di-seed. Kelas per toko sendiri diubah di master toko
 * (`stores:manage`).
 */

type Hasil = { ok: true } | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" };

export async function simpanAturanKelasToko(isi: AturanKelasToko): Promise<Hasil> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  if (!isi || typeof isi !== "object" || !isi.jarakHari || !isi.otomatis) return { ok: false, code: "INVALID" };

  const aturan: AturanKelasToko = {
    jarakHari: { A: isi.jarakHari.A, B: isi.jarakHari.B, C: isi.jarakHari.C },
    otomatis: { aktif: isi.otomatis.aktif, batasA: isi.otomatis.batasA, batasB: isi.otomatis.batasB },
  };
  const nilai = JSON.stringify(aturan);
  // Yang disimpan harus terbaca kembali persis sama — pembaca jatuh ke bawaan
  // untuk nilai rusak, jadi nilai yang tidak lolos di sini akan diam-diam
  // berbeda dari yang dilihat pemilik di layar.
  if (JSON.stringify(bacaAturanKelasToko(nilai)) !== nilai) return { ok: false, code: "INVALID" };

  await prisma.systemSetting.upsert({
    where: { key: KUNCI_KELAS_TOKO },
    create: { key: KUNCI_KELAS_TOKO, value: nilai },
    update: { value: nilai },
  });
  revalidatePath("/backoffice/settings/salesman");
  revalidatePath("/backoffice/stores/kelas");
  revalidatePath("/pwa");
  return { ok: true };
}
