"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { cancelFieldSalesOrderBySalesman } from "@/lib/field-sales/writer";
import { BatalPesananError, type KodeBatalPesanan } from "@/lib/field-sales/ganti-pesanan";
import { salinanPesananSaya } from "@/lib/field-sales/pwa-queries";

/**
 * Aksi salesman atas pesanannya sendiri, dari aplikasi HP.
 *
 * Penjaganya `pwa:access` + pemilik pesanan (di penulis/kueri, bukan di layar):
 * aksi server bisa dipanggil langsung, jadi id pesanan orang lain sama dengan
 * id yang tidak ada. Penolakan menjadi kode, tidak pernah dilempar (pesan galat
 * server disamarkan di produksi).
 */

const bolehHp = (izin: string[] | undefined) => (izin ?? []).includes("pwa:access");

export type HasilBatalPesanan = { ok: true; orderNo: string } | { ok: false; code: KodeBatalPesanan | "TANPA_AKSES" };

export async function batalkanPesananSayaAction(orderId: string, alasan: string): Promise<HasilBatalPesanan> {
  const session = await auth();
  if (!session?.user?.id || !bolehHp(session.user.permissions)) return { ok: false, code: "TANPA_AKSES" };
  if (typeof orderId !== "string" || orderId.trim() === "") return { ok: false, code: "TIDAK_DITEMUKAN" };
  try {
    const r = await cancelFieldSalesOrderBySalesman({ orderId, salesmanId: session.user.id, reason: alasan });
    revalidatePath("/pwa/orders");
    revalidatePath(`/pwa/orders/${orderId}`);
    revalidatePath("/pwa");
    revalidatePath("/backoffice/field-sales-orders");
    revalidatePath(`/backoffice/field-sales-orders/${orderId}`);
    return { ok: true, orderNo: r.orderNo };
  } catch (e) {
    if (e instanceof BatalPesananError) return { ok: false, code: e.kode };
    throw e;
  }
}

export type HasilSalinanWa =
  | { ok: true; teks: string; tautan: string; adaNomor: boolean }
  | { ok: false; code: "TANPA_AKSES" | "TIDAK_DITEMUKAN" | "GAGAL" };

/**
 * Salinan pesanan untuk toko (teks + tautan `wa.me`). Hanya pemiliknya; tidak
 * untuk pesanan yang ditolak/dibatalkan. Hanya MEMBUKA WhatsApp — salesman
 * sendiri yang membaca dan menekan kirim.
 */
export async function salinanPesananWaAction(orderId: string): Promise<HasilSalinanWa> {
  const session = await auth();
  if (!session?.user?.id || !bolehHp(session.user.permissions)) return { ok: false, code: "TANPA_AKSES" };
  if (typeof orderId !== "string" || orderId.trim() === "") return { ok: false, code: "TIDAK_DITEMUKAN" };
  const s = await salinanPesananSaya(orderId, session.user.id);
  return s ? { ok: true, ...s } : { ok: false, code: "TIDAK_DITEMUKAN" };
}
