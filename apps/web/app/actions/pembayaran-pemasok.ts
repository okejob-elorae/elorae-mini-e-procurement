"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  batalkanPembayaranPemasok,
  catatPembayaranPemasok,
  terapkanUangMuka,
  type HasilPembayaranPemasok,
} from "@/lib/purchasing/pembayaran-writer";
import { bacaHutangPemasok, type HutangPemasok } from "@/lib/purchasing/pembayaran-hutang-queries";
import type { IsianPembayaran } from "@/lib/purchasing/pembayaran-aturan";

/*
 * Aksi pembayaran pemasok sebagian (rancangan D2). Izin di SETIAP aksi:
 * mencatat `supplier_payments:create`, membatalkan dan menerapkan uang muka
 * `supplier_payments:edit`, membaca hutang `supplier_payments:view`. Pelaku dari
 * sesi; hasil `{ ok:false, kode }`.
 */

type Gagal<K extends string = string> = { ok: false; kode: K };

async function sesi() {
  const s = await auth();
  if (!s?.user?.id) return null;
  const p = s.user.permissions ?? [];
  return {
    userId: s.user.id,
    lihat: hasPermission(p, PERMISSIONS.SUPPLIER_PAYMENTS_VIEW),
    catat: hasPermission(p, PERMISSIONS.SUPPLIER_PAYMENTS_CREATE),
    ubah: hasPermission(p, PERMISSIONS.SUPPLIER_PAYMENTS_EDIT),
  };
}

function segarkan(id?: string) {
  revalidatePath("/backoffice/supplier-payments", "layout");
  if (id) revalidatePath(`/backoffice/supplier-payments/${id}`);
  revalidatePath("/backoffice/purchase-orders", "layout");
  revalidatePath("/backoffice/finance/journals");
  revalidatePath("/backoffice/finance/pph-dipotong");
  revalidatePath("/backoffice/finance/rekonsiliasi-bank");
}

async function aman<T>(nama: string, fn: () => Promise<T>): Promise<T | Gagal<"GAGAL">> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[${nama}] gagal`, e);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function catatPembayaranPemasokAction(
  input: IsianPembayaran & { idempotencyKey?: string | null },
): Promise<HasilPembayaranPemasok | Gagal<"TANPA_AKSES" | "GAGAL">> {
  const s = await sesi();
  if (!s?.catat) return { ok: false, kode: "TANPA_AKSES" };
  return aman("catatPembayaranPemasok", async () => {
    const r = await catatPembayaranPemasok({ ...(input ?? ({} as IsianPembayaran)), olehUserId: s.userId });
    if (r.ok) segarkan(r.id);
    return r;
  });
}

export async function batalkanPembayaranPemasokAction(input: { id: string; alasan: string }): Promise<HasilPembayaranPemasok | Gagal<"TANPA_AKSES" | "GAGAL">> {
  const s = await sesi();
  if (!s?.ubah) return { ok: false, kode: "TANPA_AKSES" };
  return aman("batalkanPembayaranPemasok", async () => {
    const r = await batalkanPembayaranPemasok({ id: String(input?.id ?? ""), alasan: String(input?.alasan ?? ""), olehUserId: s.userId });
    if (r.ok) segarkan(r.id);
    return r;
  });
}

export async function terapkanUangMukaAction(input: { pembayaranId: string; alokasi: unknown }): Promise<HasilPembayaranPemasok | Gagal<"TANPA_AKSES" | "GAGAL">> {
  const s = await sesi();
  if (!s?.ubah) return { ok: false, kode: "TANPA_AKSES" };
  return aman("terapkanUangMuka", async () => {
    const r = await terapkanUangMuka({ pembayaranId: String(input?.pembayaranId ?? ""), alokasi: input?.alokasi, olehUserId: s.userId });
    if (r.ok) segarkan(r.id);
    return r;
  });
}

/** Hutang terbuka satu pemasok (dokumen + uang muka) untuk formulir pembayaran. */
export async function hutangPemasokAction(input: { pemasokId: string }): Promise<{ ok: true; hutang: HutangPemasok | null; apBelumDipetakan: boolean } | Gagal<"TANPA_AKSES" | "GAGAL">> {
  const s = await sesi();
  if (!s?.lihat) return { ok: false, kode: "TANPA_AKSES" };
  const id = String(input?.pemasokId ?? "");
  if (!id) return { ok: true, hutang: null, apBelumDipetakan: false };
  return aman("hutangPemasok", async () => {
    const r = await bacaHutangPemasok({ supplierIds: [id] });
    return { ok: true as const, hutang: r.pemasok[0] ?? null, apBelumDipetakan: r.apBelumDipetakan };
  });
}
