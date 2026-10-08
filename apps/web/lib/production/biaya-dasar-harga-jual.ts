// Bukan aksi server — dasar harga jual otomatis barang jadi produksi sendiri.
// KHUSUS SERVER (membaca basis data lewat klien yang diberikan); sengaja tanpa
// impor nilai lain supaya ringan dipakai penulis harga.

import { Decimal } from "decimal.js";
import type { Prisma, PrismaClient } from "@elorae/db";

type Klien = Prisma.TransactionClient | PrismaClient;

/**
 * Dasar harga jual otomatis (`recalcItemSellingPrice`) untuk barang jadi
 * produksi sendiri, untuk pemicu yang TIDAK membawa biayanya sendiri
 * (perubahan margin barang, perubahan bawaan Jubelio).
 *
 * Harga jual dihitung dari biaya BAHAN per pcs (seperti sebelum ongkos jahit
 * masuk HPP): `InventoryValue.avgCost` kini memuat jasa langkah WO, jadi tanpa
 * ini perubahan margin berikutnya diam-diam menaikkan harga jual sebesar
 * ongkos jahit × (1 + margin). Bila barang sudah punya penerimaan bergaya baru
 * (`serviceCost`/`additionalCost` terisi), dasarnya = biaya bahan per pcs
 * penerimaan terakhir yang memikul bahan — sama dengan dasar yang dipakai
 * penerimaan itu sendiri. Bila belum, `undefined`: penulis harga memakai
 * `InventoryValue.avgCost` seperti dulu (yang memang masih bahan saja).
 */
export async function dasarHargaJualProduksi(klien: Klien, itemId: string): Promise<number | undefined> {
  const gayaBaru = await klien.fGReceipt.findFirst({
    where: { wo: { finishedGoodId: itemId }, OR: [{ serviceCost: { not: null } }, { additionalCost: { not: null } }] },
    select: { id: true },
  });
  if (!gayaBaru) return undefined;
  const terakhir = await klien.fGReceipt.findFirst({
    where: { wo: { finishedGoodId: itemId }, qtyAccepted: { gt: 0 }, materialCost: { gt: 0 } },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    select: { materialCost: true, qtyAccepted: true },
  });
  if (!terakhir?.materialCost) return undefined;
  return new Decimal(terakhir.materialCost.toString())
    .div(terakhir.qtyAccepted.toString())
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toNumber();
}
