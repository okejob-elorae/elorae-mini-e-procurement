"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  salinTargetBulanLalu,
  simpanTargetRinci,
  type KodeTolakSimpanTarget,
} from "@/lib/salesman/target-rinci-writer";

/**
 * Target sales per kategori/barang. Mengubah = `field_sales_orders:approve`
 * (orang yang menyetujui pesanan salesman adalah orang yang menetapkan
 * targetnya — sama dengan target total di Pengaturan → Salesman); melihat =
 * `field_sales_orders:view`, di halamannya. Hasil dikembalikan sebagai kode,
 * bukan dilempar, supaya pesannya tidak disamarkan Next di produksi.
 */

type TolakIzin = { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" };

export type HasilSimpanTargetSales =
  | { ok: true; jumlah: number; berubah: boolean }
  | TolakIzin
  | { ok: false; code: KodeTolakSimpanTarget; indeks?: number };

export type HasilSalinTargetSales =
  | { ok: true; jumlah: number; dibuang: number }
  | TolakIzin
  | {
      ok: false;
      code: "BULAN_TIDAK_SAH" | "SALESMAN_TIDAK_DIKENAL" | "BULAN_LALU_KOSONG" | "SUDAH_ADA" | "SEMUA_TIDAK_BERLAKU";
    };

const POLA_ID = /^[A-Za-z0-9_-]{1,64}$/;

async function pengubah(): Promise<{ userId: string } | TolakIzin> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  return { userId: session.user.id };
}

const segarkan = () => {
  revalidatePath("/backoffice/target-sales");
  revalidatePath("/pwa/target");
};

const bacaMasukan = (input: unknown) => {
  const x = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    salesmanId: typeof x.salesmanId === "string" && POLA_ID.test(x.salesmanId) ? x.salesmanId : "",
    bulan: typeof x.bulan === "string" ? x.bulan : "",
    baris: x.baris,
    timpa: x.timpa === true,
  };
};

/** Simpan seluruh target satu sales satu bulan (mengganti yang lama). */
export async function simpanTargetSalesAction(input: unknown): Promise<HasilSimpanTargetSales> {
  const izin = await pengubah();
  if ("ok" in izin) return izin;
  const m = bacaMasukan(input);
  if (!m.salesmanId) return { ok: false, code: "SALESMAN_TIDAK_DIKENAL" };

  const r = await simpanTargetRinci({ salesmanId: m.salesmanId, bulan: m.bulan, baris: m.baris, olehUserId: izin.userId });
  if (!r.ok) return { ok: false, code: r.kode, ...(r.indeks !== undefined ? { indeks: r.indeks } : {}) };
  if (r.berubah) segarkan();
  return r;
}

/** Salin target bulan lalu; `timpa` hanya sesudah pengguna mengonfirmasi. */
export async function salinTargetSalesAction(input: unknown): Promise<HasilSalinTargetSales> {
  const izin = await pengubah();
  if ("ok" in izin) return izin;
  const m = bacaMasukan(input);
  if (!m.salesmanId) return { ok: false, code: "SALESMAN_TIDAK_DIKENAL" };

  const r = await salinTargetBulanLalu({ salesmanId: m.salesmanId, bulan: m.bulan, olehUserId: izin.userId, timpa: m.timpa });
  if (!r.ok) return { ok: false, code: r.kode };
  segarkan();
  return r;
}
