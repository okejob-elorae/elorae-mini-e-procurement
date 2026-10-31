"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  bacaAturanCheckin,
  bacaAturanHasilKunjungan,
  KUNCI_ATURAN_CHECKIN,
  KUNCI_HASIL_KUNJUNGAN,
  KUNCI_RADIUS_GLOBAL,
  sahRadiusGlobal,
  tulisAturanCheckin,
  tulisAturanHasilKunjungan,
  type AturanCheckin,
  type AturanHasilKunjungan,
} from "@/lib/salesman/aturan-kunjungan";

/**
 * Pengaturan → Salesman: aturan hasil kunjungan dan aturan check-in.
 *
 * Dijaga `field_sales_orders:approve`, sama dengan kartu salesman lain di
 * `./salesman.ts` — izin itu sudah ada di prod, jadi tidak ada yang perlu
 * di-seed. Hasil dikembalikan sebagai kode, tidak dilempar.
 */

type Hasil = { ok: true } | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" };

async function bolehUbah(): Promise<Hasil | null> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  return null;
}

async function tulis(key: string, value: string) {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

const segarkan = () => {
  revalidatePath("/backoffice/settings/salesman");
  revalidatePath("/pwa");
};

/** Alasan wajib bila pulang tanpa transaksi, dan foto sebelum check-out. */
export async function simpanAturanHasilKunjungan(isi: AturanHasilKunjungan): Promise<Hasil> {
  const tolak = await bolehUbah();
  if (tolak) return tolak;
  const nilai = tulisAturanHasilKunjungan(isi);
  // Yang disimpan harus terbaca kembali persis sama oleh `checkOut`.
  if (nilai === null || tulisAturanHasilKunjungan(bacaAturanHasilKunjungan(nilai)) !== nilai) {
    return { ok: false, code: "INVALID" };
  }
  await tulis(KUNCI_HASIL_KUNJUNGAN, nilai);
  segarkan();
  return { ok: true };
}

/**
 * Mode radius, batas akurasi GPS, dan radius check-in bawaan. Radius bawaan
 * disimpan di kunci lama `checkin.radiusMeters` (angka polos) yang sudah
 * dibaca `checkIn` sejak dulu — bukan kunci baru, supaya tidak ada dua sumber.
 */
export async function simpanAturanCheckin(isi: AturanCheckin & { radiusMeter: number }): Promise<Hasil> {
  const tolak = await bolehUbah();
  if (tolak) return tolak;
  if (!isi || typeof isi !== "object" || !sahRadiusGlobal(isi.radiusMeter)) return { ok: false, code: "INVALID" };
  const nilai = tulisAturanCheckin({ modeRadius: isi.modeRadius, akurasiMaksMeter: isi.akurasiMaksMeter });
  if (nilai === null || tulisAturanCheckin(bacaAturanCheckin(nilai)) !== nilai) return { ok: false, code: "INVALID" };

  await prisma.$transaction([
    prisma.systemSetting.upsert({
      where: { key: KUNCI_ATURAN_CHECKIN },
      create: { key: KUNCI_ATURAN_CHECKIN, value: nilai },
      update: { value: nilai },
    }),
    prisma.systemSetting.upsert({
      where: { key: KUNCI_RADIUS_GLOBAL },
      create: { key: KUNCI_RADIUS_GLOBAL, value: String(isi.radiusMeter) },
      update: { value: String(isi.radiusMeter) },
    }),
  ]);
  segarkan();
  revalidatePath("/backoffice/stores");
  return { ok: true };
}
