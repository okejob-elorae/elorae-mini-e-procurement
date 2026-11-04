import { lockMainInventoryValueRow, moveMainStock, moveStoreStock, moveVanStock, type Prisma } from "@elorae/db";

/*
 * Penilaian ulang stok tanpa memindahkan barang (qty 0) — bagian sisa stok dari selisih harga invoice
 * yang diterima (keputusan pemilik 2026-11-02, P49) dan pembaliknya saat tagihannya dibatalkan.
 * Selalu lewat mover `stock-balance.ts` (`moveMainStock`/`moveStoreStock`/`moveVanStock` dengan
 * `qtyDelta: 0`), jadi kartu stok mencatat satu entri ADJUSTMENT ber-ref koreksinya — preseden yang
 * sama dengan penilaian ulang saldo awal (`tulisPenilaianUlang`). Nilai dalam sen; yang dikembalikan
 * adalah bagian yang BENAR-BENAR masuk nilai stok, supaya jurnalnya sama dengan kartu stok.
 */

type Tx = Prisma.TransactionClient;

export type RefNilaiUlang = "SupplierPayableCorrection" | "SupplierPayableCorrectionReversal";

type IsianNilaiUlang = {
  itemId: string;
  variantSku: string | null;
  /** Perubahan nilai, sen (bertanda). */
  selisihSen: number;
  refType: RefNilaiUlang;
  refId: string;
  refDocNumber: string;
  olehUserId: string;
};

const keRupiah = (sen: number) => Math.round(sen) / 100;

/**
 * Gudang Utama: kunci barisnya (pencarian null/"" yang sama dengan penerimaannya), tambahkan nilai ke
 * `totalValue`, dan harga rata-rata = nilai ÷ qty. Barang yang sudah habis (qty ≤ 0) tidak dinilai
 * ulang — seluruh bagiannya menjadi "sudah keluar".
 */
export async function nilaiUlangStokUtama(tx: Tx, a: IsianNilaiUlang): Promise<{ diterapkanSen: number }> {
  if (Math.round(a.selisihSen) === 0) return { diterapkanSen: 0 };
  const kunci = await lockMainInventoryValueRow(tx, a.itemId, a.variantSku);
  if (!kunci) return { diterapkanSen: 0 };
  const baris = await tx.inventoryValue.findUnique({ where: { id: kunci.id }, select: { qtyOnHand: true, totalValue: true } });
  const qty = Number(baris?.qtyOnHand ?? 0);
  if (!baris || qty <= 0) return { diterapkanSen: 0 };
  const totalSen = Math.round(Number(baris.totalValue) * 100);
  const baruSen = totalSen + Math.round(a.selisihSen);
  if (baruSen < 0) return { diterapkanSen: 0 };
  const avgBaru = Math.round(baruSen / qty) / 100;
  await moveMainStock(tx, {
    itemId: a.itemId,
    variantSku: a.variantSku,
    qtyDelta: 0,
    inventoryValueId: kunci.id,
    avgCost: avgBaru,
    totalValue: keRupiah(baruSen),
    unitCost: avgBaru,
    totalCost: keRupiah(a.selisihSen),
    balanceValue: keRupiah(baruSen),
    refType: a.refType,
    refId: a.refId,
    refDocNumber: a.refDocNumber,
    createdById: a.olehUserId,
  });
  return { diterapkanSen: Math.round(a.selisihSen) };
}

/**
 * Gudang Toko konsinyasi atau van: barisnya hanya menyimpan harga rata-rata (tanpa nilai total), jadi
 * harga rata-rata naik sebesar bagian ÷ qty, dibulatkan ke sen. Yang diterapkan = (harga baru − harga
 * lama) × qty; selisih pembulatannya dikembalikan ke pemanggil sebagai bagian yang tidak masuk stok.
 */
async function nilaiUlangLokasiBerharga(
  tx: Tx,
  lokasi: { jenis: "STORE"; storeId: string } | { jenis: "VAN"; userId: string },
  a: IsianNilaiUlang,
): Promise<{ diterapkanSen: number }> {
  if (Math.round(a.selisihSen) === 0) return { diterapkanSen: 0 };
  const varian = a.variantSku?.trim() ?? "";
  const baris =
    lokasi.jenis === "STORE"
      ? await tx.storeStock.findUnique({
          where: { storeId_itemId_variantSku: { storeId: lokasi.storeId, itemId: a.itemId, variantSku: varian } },
          select: { qty: true, avgCost: true },
        })
      : await tx.vanStock.findUnique({
          where: { userId_itemId_variantSku: { userId: lokasi.userId, itemId: a.itemId, variantSku: varian } },
          select: { qty: true, avgCost: true },
        });
  const qty = Number(baris?.qty ?? 0);
  if (!baris || qty <= 0) return { diterapkanSen: 0 };
  const avgLamaSen = Math.round(Number(baris.avgCost) * 100);
  const avgBaruSen = avgLamaSen + Math.round(a.selisihSen / qty);
  if (avgBaruSen < 0 || avgBaruSen === avgLamaSen) return { diterapkanSen: 0 };
  const diterapkanSen = Math.round((avgBaruSen - avgLamaSen) * qty);
  const umum = {
    itemId: a.itemId,
    variantSku: varian,
    qtyDelta: 0,
    avgCost: avgBaruSen / 100,
    unitCost: avgBaruSen / 100,
    totalCost: keRupiah(diterapkanSen),
    balanceValue: keRupiah(Math.round(avgBaruSen * qty)),
    refType: a.refType,
    refId: a.refId,
    refDocNumber: a.refDocNumber,
    createdById: a.olehUserId,
  };
  if (lokasi.jenis === "STORE") await moveStoreStock(tx, { ...umum, storeId: lokasi.storeId });
  else await moveVanStock(tx, { ...umum, userId: lokasi.userId });
  return { diterapkanSen };
}

export function nilaiUlangStokToko(tx: Tx, storeId: string, a: IsianNilaiUlang) {
  return nilaiUlangLokasiBerharga(tx, { jenis: "STORE", storeId }, a);
}

export function nilaiUlangStokVan(tx: Tx, userId: string, a: IsianNilaiUlang) {
  return nilaiUlangLokasiBerharga(tx, { jenis: "VAN", userId }, a);
}
