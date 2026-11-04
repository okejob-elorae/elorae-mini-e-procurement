import type { prisma, Prisma } from "@elorae/db";
import { kurangPerBarang } from "./selisih-retur";

/** Jumlah satu barang + ukuran (`variantSku` "" untuk barang tanpa ukuran). */
export type JumlahVarian = { itemId: string; variantSku: string; qty: number };

type Klien = Prisma.TransactionClient | typeof prisma;

/**
 * Barang yang KURANG dari nota retur toko yang punya selisih (beban bernilai di
 * atas nol), per toko — satu sumber untuk stok titipan, pencocokan, dan jurnal
 * barang hilang konsinyasi.
 *
 * Kurang = jumlah di nota toko − hitungan gudang asli − setiap hitungan susulan
 * yang sudah final (`kurangPerBarang`). Hanya baris yang menunjuk barang
 * (`itemId`); baris yang hanya diketik namanya tidak bisa diletakkan di stok.
 *
 * `terbuka` = bebannya belum diputuskan; `diputuskan` = sudah diputuskan.
 *
 * Dengan `sebelum`, keadaan dibaca per saat itu (pencocokan memotong di akhir bulan). Final berarti
 * FINAL dengan `finalisedAt` (baris lama: `receivedAt`) sebelum saat itu — aturan `sudahDihitungGudang`
 * di pencocokan:
 * - nota yang hitungan gudang aslinya belum final tidak ikut: kurangnya belum ada, seluruh klaimnya
 *   masih retur yang belum dihitung — ikut di sini berarti terhitung dua kali;
 * - hitungan susulan yang belum final belum mengurangi kurangnya;
 * - yang diputuskan pada/sesudah saat itu dibaca masih terbuka.
 * Batas yang tersisa: syarat "beban di atas nol" dibaca menurut keadaan SEKARANG.
 *
 * `storeReturnIds` membatasi ke nota tertentu (mis. nota yang barisnya keluar dari buku stok toko);
 * daftar kosong = tidak ada nota.
 */
export async function kurangReturPerToko(
  klien: Klien,
  storeIds: readonly string[],
  opsi?: { sebelum?: Date; storeReturnIds?: readonly string[] },
): Promise<Map<string, { terbuka: JumlahVarian[]; diputuskan: JumlahVarian[] }>> {
  const hasil = new Map<string, { terbuka: JumlahVarian[]; diputuskan: JumlahVarian[] }>();
  if (storeIds.length === 0) return hasil;
  if (opsi?.storeReturnIds && opsi.storeReturnIds.length === 0) return hasil;
  const sebelum = opsi?.sebelum?.getTime();
  const sudahFinal = (w: { status: string; finalisedAt: Date | null; receivedAt: Date }) =>
    w.status === "FINAL" && (sebelum === undefined || (w.finalisedAt ?? w.receivedAt).getTime() < sebelum);

  const nota = await klien.storeReturn.findMany({
    where: {
      storeId: { in: [...storeIds] },
      ...(opsi?.storeReturnIds ? { id: { in: [...opsi.storeReturnIds] } } : {}),
      status: { not: "BATAL" },
      charges: { some: { amount: { gt: 0 } } },
    },
    select: {
      storeId: true,
      items: { select: { itemId: true, variantSku: true, itemName: true, qty: true } },
      warehouseReturn: {
        select: {
          status: true,
          finalisedAt: true,
          receivedAt: true,
          items: { select: { itemId: true, variantSku: true, itemName: true, qty: true } },
        },
      },
      followUps: {
        where: { status: "FINAL" },
        select: {
          status: true,
          finalisedAt: true,
          receivedAt: true,
          items: { select: { itemId: true, variantSku: true, itemName: true, qty: true } },
        },
      },
      charges: { where: { amount: { gt: 0 } }, select: { decidedAt: true } },
    },
  });

  for (const n of nota) {
    const asli = n.warehouseReturn && sudahFinal(n.warehouseReturn) ? n.warehouseReturn : null;
    if (sebelum !== undefined && !asli) continue;
    const hitungan = [...(asli?.items ?? []), ...n.followUps.filter(sudahFinal).flatMap((f) => f.items)];
    const kurang = kurangPerBarang(n.items, hitungan).filter((k) => k.itemId && k.qtyKurang > 0);
    if (kurang.length === 0) continue;
    const diputuskan = n.charges.some(
      (c) => c.decidedAt !== null && (sebelum === undefined || c.decidedAt.getTime() < sebelum),
    );
    const grup = hasil.get(n.storeId) ?? { terbuka: [], diputuskan: [] };
    const sasaran = diputuskan ? grup.diputuskan : grup.terbuka;
    for (const k of kurang) {
      const variantSku = k.variantSku?.trim() ?? "";
      const ada = sasaran.find((x) => x.itemId === k.itemId && x.variantSku === variantSku);
      if (ada) ada.qty += k.qtyKurang;
      else sasaran.push({ itemId: k.itemId as string, variantSku, qty: k.qtyKurang });
    }
    hasil.set(n.storeId, grup);
  }
  return hasil;
}
