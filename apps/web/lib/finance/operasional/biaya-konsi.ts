import type { Prisma, PrismaClient } from "@elorae/db";
import { rataRataKirim } from "./aturan";

/*
 * Biaya per potong barang di toko konsinyasi — KHUSUS SERVER.
 *
 * Barang keluar dari gudang utama ke toko konsinyasi lewat penyesuaian stok
 * `KONSI_TRANSFER` (kiriman titipan dan pesanan konsinyasi yang disetujui),
 * masing-masing sebesar qty × harga rata-rata saat itu (`prevAvgCost`). Itulah
 * yang didebit ke `INVENTORY_CONSIGNMENT`, jadi barang yang keluar dari toko
 * (laku, kembali, hilang) dikredit pada rata-rata tertimbang kiriman barang
 * itu SAMPAI saat kejadiannya — deterministik: kiriman sesudahnya tidak
 * mengubah biaya kejadian yang lebih dulu, sehingga jurnal yang diselaraskan
 * ulang tidak bergeser.
 *
 * Per BARANG (bukan per varian, bukan per toko): penyesuaian stok tidak
 * menyimpan varian, laporan laku resmi hanya per barang, dan barang yang
 * dimutasi antar toko konsinyasi tetap satu akun persediaan.
 *
 * Barang tanpa kiriman tercatat (dikirim sebelum pemindahan stok ada) memakai
 * harga rata-rata gudang terakhir sebelum saat itu (`newAvgCost` penyesuaian
 * stok terakhirnya), lalu harga rata-rata gudang sekarang — ditandai
 * `cadangan` supaya layar bisa menyebutnya.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

export type BiayaKonsi = { biaya: number; sumber: "KIRIMAN" | "CADANGAN" | "TIDAK_DIKETAHUI" };

export async function biayaSatuanKonsi(client: Klien, itemIds: readonly string[], sampai: Date): Promise<Map<string, BiayaKonsi>> {
  const ids = [...new Set(itemIds.filter(Boolean))];
  const hasil = new Map<string, BiayaKonsi>();
  if (ids.length === 0) return hasil;

  const kirim = await client.stockAdjustment.findMany({
    where: { source: "KONSI_TRANSFER", itemId: { in: ids }, createdAt: { lte: sampai } },
    select: { itemId: true, qtyChange: true, prevAvgCost: true },
  });
  const perBarang = new Map<string, { qty: number; biaya: number }[]>();
  for (const k of kirim) {
    const daftar = perBarang.get(k.itemId) ?? [];
    daftar.push({ qty: Number(k.qtyChange), biaya: Number(k.prevAvgCost) });
    perBarang.set(k.itemId, daftar);
  }
  const tanpa: string[] = [];
  for (const id of ids) {
    const rata = rataRataKirim(perBarang.get(id) ?? []);
    if (rata !== null) hasil.set(id, { biaya: rata, sumber: "KIRIMAN" });
    else tanpa.push(id);
  }
  for (const id of tanpa) {
    const terakhir = await client.stockAdjustment.findFirst({
      where: { itemId: id, createdAt: { lte: sampai }, newAvgCost: { gt: 0 } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { newAvgCost: true },
    });
    if (terakhir) {
      hasil.set(id, { biaya: Number(terakhir.newAvgCost), sumber: "CADANGAN" });
      continue;
    }
    const stok = await client.inventoryValue.findMany({ where: { itemId: id }, select: { qtyOnHand: true, avgCost: true } });
    const rata = rataRataKirim(stok.map((s) => ({ qty: Math.max(1, Number(s.qtyOnHand)), biaya: Number(s.avgCost) })).filter((s) => s.biaya > 0));
    hasil.set(id, rata !== null ? { biaya: rata, sumber: "CADANGAN" } : { biaya: 0, sumber: "TIDAK_DIKETAHUI" });
  }
  return hasil;
}

/** Peta id barang → biaya per potong saja. */
export function petaBiaya(biaya: ReadonlyMap<string, BiayaKonsi>): Map<string, number> {
  return new Map([...biaya].map(([id, b]) => [id, b.biaya]));
}
