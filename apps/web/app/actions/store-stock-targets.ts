"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@elorae/db";
import { cariTeks } from "@/lib/db/cari-teks";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseItemVariants } from "@/lib/items/variants";
import { kunciStok, periksaTarget, type KodeTarget } from "@/lib/konsinyasi/isi-ulang";
import { labelVarian } from "@/lib/konsinyasi/stok-di-toko";

/**
 * Target stok min/maks per toko × barang × ukuran (`StoreStockTarget`).
 *
 * Dijaga `stores:manage` — izin yang sama dengan mengubah data toko. Target
 * menentukan saran isi ulang yang dilihat salesman; setiap simpan menulis SATU
 * baris jejak audit berisi pasangan sebelum/sesudah untuk baris yang berubah,
 * di dalam transaksi yang sama. Barisnya sendiri hanya menyimpan keadaan
 * terakhir, jadi jejak itulah satu-satunya catatan target yang tergantikan.
 */

export type VarianTarget = { variantSku: string; label: string | null };
export type BarangTarget = { itemId: string; sku: string; nama: string; varian: VarianTarget[] };

/** Ukuran sebuah barang untuk editor: setiap varian ber-SKU, atau satu baris "" untuk barang tanpa varian. */
function varianBarang(variants: unknown): VarianTarget[] {
  const skus = parseItemVariants(variants)
    .map((v) => (v.sku ?? "").trim())
    .filter(Boolean);
  if (skus.length === 0) return [{ variantSku: "", label: null }];
  return [...new Set(skus)].map((sku) => ({ variantSku: sku, label: labelVarian(variants, sku) }));
}

async function bolehKelola(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE)) return null;
  return session.user.id;
}

export async function cariBarangTargetAction(
  query: string,
): Promise<{ ok: true; barang: BarangTarget[] } | { ok: false; code: "FORBIDDEN" }> {
  if (!(await bolehKelola())) return { ok: false, code: "FORBIDDEN" };
  const q = String(query ?? "").trim().slice(0, 100);
  if (q.length < 2) return { ok: true, barang: [] };
  const rows = await prisma.item.findMany({
    where: {
      isActive: true,
      type: "FINISHED_GOOD",
      OR: [{ sku: cariTeks(q) }, { nameId: cariTeks(q) }],
    },
    orderBy: { nameId: "asc" },
    take: 20,
    select: { id: true, sku: true, nameId: true, variants: true },
  });
  return { ok: true, barang: rows.map((r) => ({ itemId: r.id, sku: r.sku, nama: r.nameId, varian: varianBarang(r.variants) })) };
}

const simpanSchema = z.object({
  storeId: z.string().min(1),
  baris: z
    .array(
      z.object({
        itemId: z.string().min(1),
        variantSku: z.string().max(191),
        minQty: z.number().nullable(),
        maxQty: z.number().nullable(),
      }),
    )
    .max(2000),
});

export type BarisTargetGagal = { itemId: string; variantSku: string; kode: KodeTarget };
export type HasilSimpanTarget =
  | { ok: true; diubah: number }
  | { ok: false; code: "FORBIDDEN" | "VALIDATION" | "TOKO_TIDAK_DITEMUKAN" | "BARANG_TIDAK_DITEMUKAN" }
  | { ok: false; code: "BARIS_TIDAK_VALID"; baris: BarisTargetGagal[] };

/**
 * Simpan baris yang DIUBAH di editor. Baris dengan min & maks kosong berarti
 * hapus targetnya. Baris yang tidak dikirim tidak disentuh.
 */
export async function simpanTargetStokAction(input: unknown): Promise<HasilSimpanTarget> {
  const userId = await bolehKelola();
  if (!userId) return { ok: false, code: "FORBIDDEN" };
  const parsed = simpanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const { storeId } = parsed.data;

  // Satu kunci satu baris — kalau layar mengirim kembar, yang terakhir menang.
  const perKunci = new Map<string, (typeof parsed.data.baris)[number]>();
  for (const b of parsed.data.baris) perKunci.set(kunciStok(b.itemId, b.variantSku), { ...b, variantSku: b.variantSku.trim() });
  const baris = [...perKunci.values()];
  if (baris.length === 0) return { ok: true, diubah: 0 };

  const gagal: BarisTargetGagal[] = [];
  for (const b of baris) {
    const kode = periksaTarget(b);
    if (kode) gagal.push({ itemId: b.itemId, variantSku: b.variantSku, kode });
  }
  if (gagal.length > 0) return { ok: false, code: "BARIS_TIDAK_VALID", baris: gagal };

  const toko = await prisma.store.count({ where: { id: storeId } });
  if (!toko) return { ok: false, code: "TOKO_TIDAK_DITEMUKAN" };
  const ada = await prisma.item.count({ where: { id: { in: [...new Set(baris.map((b) => b.itemId))] } } });
  if (ada !== new Set(baris.map((b) => b.itemId)).size) return { ok: false, code: "BARANG_TIDAK_DITEMUKAN" };

  const diubah = await prisma.$transaction(async (tx) => {
    const lama = await tx.storeStockTarget.findMany({
      where: { storeId, itemId: { in: [...new Set(baris.map((b) => b.itemId))] } },
      select: { itemId: true, variantSku: true, minQty: true, maxQty: true },
    });
    const lamaPer = new Map(lama.map((l) => [kunciStok(l.itemId, l.variantSku), l]));

    const sebelum: { itemId: string; variantSku: string; minQty: number; maxQty: number }[] = [];
    const sesudah: { itemId: string; variantSku: string; minQty: number | null; maxQty: number | null }[] = [];
    for (const b of baris) {
      const l = lamaPer.get(kunciStok(b.itemId, b.variantSku));
      const hapus = b.minQty === null && b.maxQty === null;
      if (hapus) {
        if (!l) continue;
        await tx.storeStockTarget.delete({
          where: { storeId_itemId_variantSku: { storeId, itemId: b.itemId, variantSku: b.variantSku } },
        });
      } else {
        if (l && l.minQty === b.minQty && l.maxQty === b.maxQty) continue;
        await tx.storeStockTarget.upsert({
          where: { storeId_itemId_variantSku: { storeId, itemId: b.itemId, variantSku: b.variantSku } },
          create: { storeId, itemId: b.itemId, variantSku: b.variantSku, minQty: b.minQty as number, maxQty: b.maxQty as number, updatedById: userId },
          update: { minQty: b.minQty as number, maxQty: b.maxQty as number, updatedById: userId },
        });
      }
      if (l) sebelum.push(l);
      sesudah.push({ itemId: b.itemId, variantSku: b.variantSku, minQty: b.minQty, maxQty: b.maxQty });
    }

    if (sesudah.length > 0) {
      await tx.auditLog.create({
        data: {
          userId,
          action: "STORE_STOCK_TARGETS_UPDATED",
          entityType: "Store",
          entityId: storeId,
          changes: { before: sebelum, after: sesudah },
          metadata: { jumlah: sesudah.length },
        },
      });
    }
    return sesudah.length;
  });

  revalidatePath(`/backoffice/stores/${storeId}/target-stok`);
  revalidatePath(`/backoffice/stores/${storeId}`);
  revalidatePath("/backoffice/konsinyasi/isi-ulang");
  revalidatePath(`/pwa/stores/${storeId}`);
  return { ok: true, diubah };
}
