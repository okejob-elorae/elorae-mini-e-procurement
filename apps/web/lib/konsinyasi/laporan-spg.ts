import { prisma } from "@elorae/db";

/**
 * Bahan laporan SPG satu siklus konsinyasi, dari catatan penjualan harian SPG.
 *
 * Hanya MEMBACA. Hasilnya mengisi formulir laporan SPG yang sudah ada, dan
 * admin memeriksa sebelum menyimpan lewat `catatLaporan` — aturan "kunci butuh
 * kedua laporan" dan "siklus terkunci menolak" tetap di satu tempat itu.
 */

export type BarisBahan = { itemId: string; itemName: string; qty: number };

/**
 * Jumlahkan baris penjualan per barang (varian dilebur — laporan konsi per barang).
 * Barang kembali dari pembeli masuk sebagai qty negatif; barang yang bersihnya
 * nol atau kurang tidak dilaporkan.
 */
export function susunBahanLaporan(baris: { itemId: string; itemName: string; qty: number }[]): BarisBahan[] {
  const peta = new Map<string, BarisBahan>();
  for (const b of baris) {
    const ada = peta.get(b.itemId);
    if (ada) ada.qty += b.qty;
    else peta.set(b.itemId, { itemId: b.itemId, itemName: b.itemName, qty: b.qty });
  }
  return [...peta.values()].filter((b) => b.qty > 0).sort((a, b) => a.itemName.localeCompare(b.itemName));
}

/** Rentang satu bulan kalender Jakarta, sebagai instant UTC [awal, akhir). */
export function rentangBulanWib(tahun: number, bulan: number): { awal: Date; akhir: Date } {
  const mm = (n: number) => String(n).padStart(2, "0");
  const berikut = bulan === 12 ? { t: tahun + 1, b: 1 } : { t: tahun, b: bulan + 1 };
  return {
    awal: new Date(`${tahun}-${mm(bulan)}-01T00:00:00+07:00`),
    akhir: new Date(`${berikut.t}-${mm(berikut.b)}-01T00:00:00+07:00`),
  };
}

export async function bahanLaporanSpg(cycleId: string): Promise<BarisBahan[] | null> {
  const siklus = await prisma.consignmentCycle.findUnique({
    where: { id: cycleId },
    select: { storeId: true, periodYear: true, periodMonth: true },
  });
  if (!siklus) return null;
  const { awal, akhir } = rentangBulanWib(siklus.periodYear, siklus.periodMonth);
  const [baris, kembali] = await Promise.all([
    prisma.spgSaleLine.findMany({
      where: { spgSale: { storeId: siklus.storeId, createdAt: { gte: awal, lt: akhir } } },
      select: { itemId: true, qty: true, item: { select: { nameId: true } } },
    }),
    // Laku BERSIH: barang yang dikembalikan pembeli di bulan itu mengurangi
    // barang yang sama. Dibaca menurut tanggal returnya, supaya bulan yang
    // laporannya sudah dikunci tidak berubah oleh retur sesudahnya.
    prisma.spgSaleReturnLine.findMany({
      where: { saleReturn: { storeId: siklus.storeId, createdAt: { gte: awal, lt: akhir } } },
      select: { itemId: true, qty: true, saleLine: { select: { item: { select: { nameId: true } } } } },
    }),
  ]);
  return susunBahanLaporan([
    ...baris.map((b) => ({ itemId: b.itemId, itemName: b.item.nameId, qty: b.qty })),
    ...kembali.map((k) => ({ itemId: k.itemId, itemName: k.saleLine.item.nameId, qty: -k.qty })),
  ]);
}
