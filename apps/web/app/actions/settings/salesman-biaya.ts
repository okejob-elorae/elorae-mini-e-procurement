"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaPengaturanBiaya, KUNCI_PENGATURAN_BIAYA, periksaPengaturanBiaya } from "@/lib/salesman/biaya";
import { bacaPengaturanAbsensi, KUNCI_PENGATURAN_ABSENSI, periksaPengaturanAbsensi } from "@/lib/salesman/absensi";

/**
 * Pengaturan biaya perjalanan dan absensi salesman.
 *
 * Dijaga `field_sales_orders:approve` — izin yang sama dengan seluruh kartu
 * Pengaturan → Salesman: orang yang menyetujui pesanan salesman adalah orang
 * yang menetapkan aturan kerjanya. Sudah ada di prod, tidak ada yang di-seed.
 *
 * Nilai yang disimpan harus terbaca kembali PERSIS sama lewat pembacanya —
 * kalau tidak, layar ini akan menampilkan aturan yang berbeda dari yang dipakai
 * server saat salesman mengajukan atau absen.
 */

type Hasil = { ok: true } | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" | "GAGAL" };

async function bolehUbah(): Promise<Hasil | null> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  return null;
}

async function simpan(kunci: string, nilai: string): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key: kunci }, create: { key: kunci, value: nilai }, update: { value: nilai } });
}

export async function simpanPengaturanBiaya(isi: unknown): Promise<Hasil> {
  const tolak = await bolehUbah();
  if (tolak) return tolak;
  const p = periksaPengaturanBiaya(isi);
  if (!p) return { ok: false, code: "INVALID" };
  const nilai = JSON.stringify(p);
  if (JSON.stringify(bacaPengaturanBiaya(nilai)) !== nilai) return { ok: false, code: "INVALID" };
  try {
    await simpan(KUNCI_PENGATURAN_BIAYA, nilai);
  } catch (err) {
    console.error("simpanPengaturanBiaya gagal", err);
    return { ok: false, code: "GAGAL" };
  }
  revalidatePath("/backoffice/settings/salesman");
  revalidatePath("/pwa/biaya");
  revalidatePath("/pwa/biaya/baru");
  return { ok: true };
}

export async function simpanPengaturanAbsensi(isi: unknown): Promise<Hasil> {
  const tolak = await bolehUbah();
  if (tolak) return tolak;
  const p = periksaPengaturanAbsensi(isi);
  if (!p) return { ok: false, code: "INVALID" };
  const nilai = JSON.stringify(p);
  if (JSON.stringify(bacaPengaturanAbsensi(nilai)) !== nilai) return { ok: false, code: "INVALID" };
  try {
    await simpan(KUNCI_PENGATURAN_ABSENSI, nilai);
  } catch (err) {
    console.error("simpanPengaturanAbsensi gagal", err);
    return { ok: false, code: "GAGAL" };
  }
  revalidatePath("/backoffice/settings/salesman");
  revalidatePath("/backoffice/absensi");
  // Kuota cuti tahunan ikut pengaturan ini.
  revalidatePath("/backoffice/izin");
  revalidatePath("/pwa");
  revalidatePath("/pwa/absen");
  return { ok: true };
}
