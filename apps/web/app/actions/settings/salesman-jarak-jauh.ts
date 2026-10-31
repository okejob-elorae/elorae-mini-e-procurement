"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaAturanJarakJauh, KUNCI_JARAK_JAUH, type AturanJarakJauh } from "@/lib/field-sales/jarak-jauh";

/**
 * Pesanan jarak jauh (WA/telepon, tanpa kunjungan): boleh tidaknya, dan apakah
 * hanya untuk toko yang dipegang salesman itu. Disimpan sebagai JSON di
 * `salesman.pesananJarakJauh`, dibaca lewat `bacaAturanJarakJauh` — nilai yang
 * disimpan harus terbaca kembali persis sama, supaya layar pengaturan tidak
 * pernah menampilkan aturan yang berbeda dari yang dipakai server.
 *
 * Dijaga `field_sales_orders:approve`, sama dengan pengaturan salesman lain.
 */

type Hasil = { ok: true } | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" };

export async function simpanAturanJarakJauh(isi: AturanJarakJauh): Promise<Hasil> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) return { ok: false, code: "FORBIDDEN" };
  if (!isi || typeof isi !== "object" || typeof isi.aktif !== "boolean" || typeof isi.hanyaTokoSendiri !== "boolean") {
    return { ok: false, code: "INVALID" };
  }
  const aturan: AturanJarakJauh = { aktif: isi.aktif, hanyaTokoSendiri: isi.hanyaTokoSendiri };
  const nilai = JSON.stringify(aturan);
  if (JSON.stringify(bacaAturanJarakJauh(nilai)) !== nilai) return { ok: false, code: "INVALID" };

  await prisma.systemSetting.upsert({
    where: { key: KUNCI_JARAK_JAUH },
    create: { key: KUNCI_JARAK_JAUH, value: nilai },
    update: { value: nilai },
  });
  revalidatePath("/backoffice/settings/salesman");
  revalidatePath("/pwa");
  return { ok: true };
}
