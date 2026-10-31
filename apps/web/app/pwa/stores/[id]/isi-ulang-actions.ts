"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { createFieldSalesOrder } from "@/lib/field-sales/writer";
import { NoActiveVisitError, MinQtyViolationError } from "@/lib/field-sales/errors";
import { labelVarian } from "@/lib/konsinyasi/stok-di-toko";
import { MAKS_TARGET } from "@/lib/konsinyasi/isi-ulang";

/**
 * Kirim pesanan isi ulang dari kartu "Stok di toko ini" — pesanan KONSINYASI
 * biasa lewat jalur pembuatan yang sama dengan katalog (`createFieldSalesOrder`),
 * jadi aturan kunjungan, nomor dokumen dan persetujuannya tidak bercabang.
 *
 * Yang TIDAK dipercaya dari HP: nama barang (dibaca ulang dari master) dan jenis
 * toko (hanya toko KONSI). Harga tidak pernah dikirim — pesanan konsinyasi
 * tidak berharga dari salesman, harganya dihitung kantor saat disetujui.
 */

const schema = z.object({
  storeId: z.string().min(1),
  visitId: z.string().min(1),
  note: z.string().max(500).optional(),
  idempotencyKey: z.string().min(1).max(100),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        variantSku: z.string(),
        qty: z.number().int().positive().max(MAKS_TARGET),
      }),
    )
    .min(1)
    .max(300),
});

export type KodeIsiUlang = "UNAUTHORIZED" | "INVALID" | "BUKAN_KONSI" | "BARANG_TIDAK_DIKENAL" | "NO_ACTIVE_VISIT" | "GAGAL";
export type HasilIsiUlang = { ok: true; orderNo: string } | { ok: false; code: KodeIsiUlang };

export async function kirimPesananIsiUlang(input: unknown): Promise<HasilIsiUlang> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID" };
  const d = parsed.data;

  const toko = await prisma.store.findUnique({ where: { id: d.storeId }, select: { termsType: true, isActive: true } });
  if (!toko || !toko.isActive || toko.termsType !== "KONSI") return { ok: false, code: "BUKAN_KONSI" };

  // Baris kembar (barang + ukuran sama) digabung, bukan ditolak: layar bisa
  // saja mengirim dua kali karena ketukan ganda di lembar konfirmasi.
  const gabung = new Map<string, { itemId: string; variantSku: string; qty: number }>();
  for (const l of d.lines) {
    const k = `${l.itemId}::${l.variantSku}`;
    const ada = gabung.get(k);
    if (ada) ada.qty += l.qty;
    else gabung.set(k, { ...l });
  }
  const baris = [...gabung.values()];

  const items = await prisma.item.findMany({
    where: { id: { in: [...new Set(baris.map((b) => b.itemId))] }, isActive: true },
    select: { id: true, nameId: true, variants: true },
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  if (baris.some((b) => !byId.has(b.itemId))) return { ok: false, code: "BARANG_TIDAK_DIKENAL" };

  try {
    const { orderNo } = await createFieldSalesOrder({
      storeId: d.storeId,
      salesmanId: session.user.id,
      // Sama dengan katalog: pesanan diikat ke kunjungan yang sedang berjalan
      // di toko ini; penulis menolak kunjungan milik orang/toko lain.
      visitId: d.visitId,
      note: d.note?.trim() || undefined,
      idempotencyKey: d.idempotencyKey,
      lines: baris.map((b) => {
        const i = byId.get(b.itemId)!;
        const varian = labelVarian(i.variants, b.variantSku);
        return {
          itemId: b.itemId,
          variantSku: b.variantSku,
          // Bentuk nama baris sama dengan keranjang katalog (`lib/field-sales/cart.ts`).
          productName: varian ? `${i.nameId} — ${varian}` : i.nameId,
          qty: b.qty,
          unitPrice: 0,
        };
      }),
    });
    revalidatePath(`/pwa/stores/${d.storeId}`);
    return { ok: true, orderNo };
  } catch (e) {
    if (e instanceof NoActiveVisitError) return { ok: false, code: "NO_ACTIVE_VISIT" };
    // Konsinyasi tidak punya minimum pesan; kalau suatu hari punya, jangan
    // biarkan ia jatuh sebagai galat tak terbaca.
    if (e instanceof MinQtyViolationError) return { ok: false, code: "INVALID" };
    console.error("[kirimPesananIsiUlang]", e);
    return { ok: false, code: "GAGAL" };
  }
}
