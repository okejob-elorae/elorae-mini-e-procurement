import { prisma, type Prisma } from "@elorae/db";
import { rentangBulanWib } from "./laporan-spg";
import { hitungPromoElorae, type BarisKembaliPromo, type HasilPromoElorae } from "./promo-elorae";

/**
 * Potongan promo konter yang ditanggung Elorae untuk satu toko × satu bulan WIB.
 * Aturannya di `promo-elorae.ts`; di sini hanya pemuatnya.
 *
 * Menerima klien transaksi: `kunciAngka` memanggilnya DI DALAM transaksi kunci,
 * supaya angka yang dibekukan sama dengan nota yang terlihat transaksi itu.
 * Layar rincian memanggilnya dengan `prisma` biasa selama siklus belum dikunci.
 */

type Klien = Prisma.TransactionClient | typeof prisma;
const angka = (v: unknown): number => Number(v ?? 0);

export async function promoEloraeSiklus(
  klien: Klien,
  input: { storeId: string; periodYear: number; periodMonth: number },
): Promise<HasilPromoElorae> {
  const { awal, akhir } = rentangBulanWib(input.periodYear, input.periodMonth);

  const [jual, kembali] = await Promise.all([
    // Hanya baris yang memang berpotongan — baris tanpa potongan tidak punya bagian Elorae.
    klien.spgSaleLine.findMany({
      where: { discount: { gt: 0 }, spgSale: { storeId: input.storeId, createdAt: { gte: awal, lt: akhir } } },
      select: { qty: true, discount: true, storeDiscount: true },
    }),
    klien.spgSaleReturnLine.findMany({
      where: {
        saleReturn: { storeId: input.storeId, createdAt: { gte: awal, lt: akhir } },
        saleLine: { discount: { gt: 0 } },
      },
      select: {
        id: true,
        qty: true,
        spgSaleLineId: true,
        saleReturn: { select: { createdAt: true } },
        saleLine: { select: { qty: true, discount: true, storeDiscount: true } },
      },
    }),
  ]);

  // Potong yang sudah kembali SEBELUM setiap retur bulan ini, per baris nota —
  // termasuk retur bulan-bulan sebelumnya — untuk hitungan kumulatif.
  const idBaris = [...new Set(kembali.map((k) => k.spgSaleLineId))];
  const semuaKembali = idBaris.length
    ? await klien.spgSaleReturnLine.findMany({
        where: { spgSaleLineId: { in: idBaris } },
        select: { id: true, qty: true, spgSaleLineId: true, saleReturn: { select: { createdAt: true } } },
      })
    : [];
  const urut = (a: { id: string; saleReturn: { createdAt: Date } }, b: { id: string; saleReturn: { createdAt: Date } }) =>
    a.saleReturn.createdAt.getTime() - b.saleReturn.createdAt.getTime() || a.id.localeCompare(b.id);
  semuaKembali.sort(urut);

  const barisKembali: BarisKembaliPromo[] = kembali.map((k) => {
    const sebelum = semuaKembali
      .filter((x) => x.spgSaleLineId === k.spgSaleLineId && urut(x, k) < 0)
      .reduce((s, x) => s + x.qty, 0);
    return {
      qty: k.saleLine.qty,
      discount: angka(k.saleLine.discount),
      storeDiscount: angka(k.saleLine.storeDiscount),
      qtySebelum: sebelum,
      qtyKembali: k.qty,
    };
  });

  return hitungPromoElorae({
    jual: jual.map((j) => ({ qty: j.qty, discount: angka(j.discount), storeDiscount: angka(j.storeDiscount) })),
    kembali: barisKembali,
  });
}
