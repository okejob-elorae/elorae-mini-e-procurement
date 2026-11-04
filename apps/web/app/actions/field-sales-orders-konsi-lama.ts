"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import {
  batalKirimPesananLama,
  konfirmasiSampaiPesananLama,
  type AlasanTolakBatalKirim,
  type AlasanTolakSampai,
} from "@/lib/field-sales/konsi-transfer/pesanan-lama-writer";
import { BATAS_ALASAN_BATAL_KIRIM } from "@/lib/field-sales/konsi-transfer/pesanan-lama-aturan";
import { kaitPindahKonsiTransfer } from "@/lib/finance/operasional/kait";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import { kabariTitipanTersedia } from "@/lib/spg/titip-tersedia";

/**
 * Aksi pesanan konsinyasi LAMA yang cadangannya masih ditahan (keputusan pemilik no. 9).
 *
 * - `konfirmasiSampaiPesananLamaAction` — HP saja: SPG toko itu, atau salesman pemegang toko tanpa
 *   SPG, sedang check-in di toko itu. Pengguna kantor (izin wildcard admin, atau tanpa akses HP)
 *   ditolak di sini; siapa yang boleh untuk TOKO itu diputuskan penulisnya dari data.
 * - `batalKirimPesananLamaAction` — kantor saja, izin yang SAMA dengan tutup sisa pesanan
 *   (`field_sales_orders:deliver`); tombolnya memeriksa izin yang sama.
 *
 * Hasil dikembalikan sebagai kode, tidak dilempar, supaya pesan galat tidak disamarkan Next.
 */

export type HasilKonfirmasiSampaiAction =
  | { ok: true; docNo: string; pcs: number; pcsSesudahOpname: number }
  | { ok: false; code: "FORBIDDEN" | "VALIDATION" | AlasanTolakSampai };

const sampaiSchema = z.object({
  orderId: z.string().min(1).max(100),
  baris: z
    .array(z.object({ lineId: z.string().min(1).max(100), qty: z.number().int().min(0).max(100_000) }))
    .min(1)
    .max(500),
  idempotencyKey: z.string().min(1).max(100).optional(),
  note: z.string().max(500).optional(),
});

export async function konfirmasiSampaiPesananLamaAction(input: unknown): Promise<HasilKonfirmasiSampaiAction> {
  const parsed = sampaiSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const session = await auth();
  // Kantor tidak pernah mengonfirmasi barang sampai: admin (wildcard) dan pengguna tanpa akses HP ditolak.
  if (!session?.user?.id || pwaAccessGuard(session.user.permissions ?? []) !== "render") return { ok: false, code: "FORBIDDEN" };

  const hasil = await konfirmasiSampaiPesananLama({
    orderId: parsed.data.orderId,
    userId: session.user.id,
    baris: parsed.data.baris,
    idempotencyKey: parsed.data.idempotencyKey ?? null,
    note: parsed.data.note ?? null,
  });
  if (!hasil.ok) return { ok: false, code: hasil.alasan };

  // Idempoten dan tidak pernah melempar; dipanggil juga untuk kiriman ulang, yang menyelamatkan
  // jurnalnya bila kait pertama mati sebelum sempat memposting.
  await kaitPindahKonsiTransfer(hasil.transferId, session.user.id);
  if (hasil.receiptId && !hasil.ulang) void kabariTitipanTersedia(hasil.storeId);

  revalidatePath("/pwa");
  revalidatePath("/pwa/spg/terima");
  revalidatePath("/pwa/spg/stok");
  revalidatePath(`/pwa/stores/${hasil.storeId}`);
  revalidatePath("/backoffice/field-sales-orders");
  revalidatePath(`/backoffice/field-sales-orders/${parsed.data.orderId}`);
  return { ok: true, docNo: hasil.docNo, pcs: hasil.pcs, pcsSesudahOpname: hasil.pcsSesudahOpname };
}

export type HasilBatalKirimAction = { ok: true } | { ok: false; code: "FORBIDDEN" | "VALIDATION" | AlasanTolakBatalKirim };

export async function batalKirimPesananLamaAction(orderId: unknown, alasan: unknown): Promise<HasilBatalKirimAction> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_DELIVER)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  if (typeof orderId !== "string" || orderId === "" || typeof alasan !== "string") return { ok: false, code: "VALIDATION" };
  const teks = alasan.trim();
  if (teks === "" || teks.length > BATAS_ALASAN_BATAL_KIRIM) return { ok: false, code: "ALASAN_WAJIB" };

  const hasil = await batalKirimPesananLama({ orderId, userId: session.user.id, alasan: teks });
  if (!hasil.ok) return { ok: false, code: hasil.alasan };

  revalidatePath("/backoffice/field-sales-orders");
  revalidatePath(`/backoffice/field-sales-orders/${orderId}`);
  revalidatePath("/pwa/spg/terima");
  void kabarSisaTidakDikirim(orderId, teks, session.user.id);
  return { ok: true };
}

/** Salesman pemilik pesanan dikabari, seperti tutup sisa pesanan biasa. Tidak pernah melempar. */
async function kabarSisaTidakDikirim(orderId: string, alasan: string, pelakuId: string): Promise<void> {
  try {
    const order = await prisma.fieldSalesOrder.findUnique({
      where: { id: orderId },
      select: { orderNo: true, salesmanId: true, store: { select: { name: true } } },
    });
    if (!order || order.salesmanId === pelakuId) return;
    await kabariPengguna(order.salesmanId, {
      jenis: JENIS_KABAR.PESANAN_DITUTUP,
      judul: `Sisa pesanan ${order.orderNo} tidak jadi dikirim`,
      isi: `${order.store.name} · sisa barang pesanan konsinyasi lama tidak jadi dikirim. Alasan: ${alasan}`,
      data: { orderId },
    });
  } catch (err) {
    console.error("[kabar] sisa pesanan konsi lama tidak jadi dikirim gagal", orderId, err);
  }
}
