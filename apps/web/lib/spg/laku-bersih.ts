import { prisma, type Prisma } from "@elorae/db";
import { kunciBaris } from "./stok";
import { returPembeliBerlaku } from "./retur-pembeli-berlaku";
import { ENTITAS_RETUR_PEMBELI } from "./retur-pembeli-status";

/**
 * Laku BERSIH menurut buku stok toko — SATU definisi untuk setiap pembaca
 * kecepatan laku (stok di toko, pencocokan konsinyasi, dan pembaca lain yang
 * menyusul).
 *
 *   laku bersih = −(JUAL + RETUR_PEMBELI + retur tanpa baris buku)
 *
 * - JUAL: −qty per baris nota SPG (`recordSpgSale`).
 * - RETUR_PEMBELI: +qty barang LAYAK yang dikembalikan pembeli — kembali ke rak.
 *   Baris ini baru ada setelah kantor MENYETUJUI laporan returnya
 *   (`setujuiReturPembeli`), bertanggal saat retur dilaporkan.
 * - Retur tanpa baris buku — keduanya BUKAN penjualan, jadi di sini menjadi
 *   gerakan +qty bertanggal returnya, sama seperti RETUR_PEMBELI:
 *   - barang RUSAK/EXPIRED yang dikembalikan pembeli (tidak kembali ke rak);
 *   - barang LAYAK yang disetujui TANPA baris RETUR_PEMBELI karena opname toko
 *     sudah menghitungnya di rak sesudah retur dilaporkan (persetujuan tidak
 *     menambah buku dua kali). Opname itu memperbaiki SALDO lewat baris OPNAME,
 *     yang tidak dibaca laku — tanpa koreksi ini barang yang kembali tetap
 *     terbaca terjual.
 *   Hanya retur yang DISETUJUI (`returPembeliBerlaku`); yang masih menunggu,
 *   ditolak, atau ditarik tidak pernah mengurangi laku. Hanya untuk nota yang
 *   punya baris JUAL di buku untuk barang × ukuran itu, dan tidak melebihi
 *   JUAL-nya: penjualan tanpa sinyal yang sudah tertelan opname tidak pernah
 *   memotong buku, jadi returnya juga tidak boleh mengurangi laku.
 *
 * Saldo buku tidak berubah — gerakan retur tanpa baris buku di sini hanya untuk
 * angka laku.
 */

export type GerakLaku = { storeId: string; itemId: string; variantSku: string; qty: number; createdAt: Date };

export type ReturRusak = {
  /** `SpgSaleReturnLine.id`. */
  lineId: string;
  storeId: string;
  spgSaleId: string;
  itemId: string;
  variantSku: string;
  qty: number;
  createdAt: Date;
};

export type ReturRusakLaku = GerakLaku & { lineId: string };

/** Rentang satu toko. `kecuali`: rentang waktu yang dilewati (mis. bulan yang angka resminya sudah dikunci). */
export type CakupanLaku = { storeId: string; dari?: Date; sebelum?: Date; kecuali?: { awal: Date; akhir: Date }[] };

type Klien = Prisma.TransactionClient | typeof prisma;

// ---------------------------------------------------------------------------
// Bagian murni
// ---------------------------------------------------------------------------

/**
 * Retur rusak yang boleh mengurangi laku: notanya punya JUAL di buku untuk
 * barang × ukuran itu, dibatasi jumlah JUAL-nya (yang lebih awal didahulukan).
 */
export function returRusakBerbuku(
  rusak: readonly ReturRusak[],
  jual: readonly { refId: string | null; itemId: string; variantSku: string | null; qty: number }[],
): ReturRusakLaku[] {
  const kunci = (saleId: string, itemId: string, variantSku: string | null) => `${saleId}|${kunciBaris(itemId, variantSku)}`;
  const sisa = new Map<string, number>();
  for (const j of jual) {
    if (!j.refId || j.qty >= 0) continue;
    const k = kunci(j.refId, j.itemId, j.variantSku);
    sisa.set(k, (sisa.get(k) ?? 0) - j.qty);
  }
  const hasil: ReturRusakLaku[] = [];
  const urut = [...rusak].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.lineId.localeCompare(b.lineId));
  for (const r of urut) {
    if (r.qty <= 0) continue;
    const k = kunci(r.spgSaleId, r.itemId, r.variantSku);
    const ada = sisa.get(k) ?? 0;
    const qty = Math.min(ada, r.qty);
    if (qty <= 0) continue;
    sisa.set(k, ada - qty);
    hasil.push({ lineId: r.lineId, storeId: r.storeId, itemId: r.itemId, variantSku: r.variantSku ?? "", qty, createdAt: r.createdAt });
  }
  return hasil;
}

/** Σ gerakan laku sejak `sejak`, per toko lalu per `kunciBaris` (tanda buku: JUAL negatif). */
export function jumlahLakuPerKunci(gerak: readonly GerakLaku[], sejak: Date): Map<string, Map<string, number>> {
  const hasil = new Map<string, Map<string, number>>();
  for (const g of gerak) {
    if (g.createdAt < sejak) continue;
    let toko = hasil.get(g.storeId);
    if (!toko) hasil.set(g.storeId, (toko = new Map()));
    const k = kunciBaris(g.itemId, g.variantSku);
    toko.set(k, (toko.get(k) ?? 0) + g.qty);
  }
  return hasil;
}

// ---------------------------------------------------------------------------
// Pemuat basis data
// ---------------------------------------------------------------------------

function saringWaktu(c: CakupanLaku) {
  const createdAt = { ...(c.dari ? { gte: c.dari } : {}), ...(c.sebelum ? { lt: c.sebelum } : {}) };
  return {
    storeId: c.storeId,
    ...(c.dari || c.sebelum ? { createdAt } : {}),
    ...(c.kecuali?.length ? { NOT: c.kecuali.map((r) => ({ createdAt: { gte: r.awal, lt: r.akhir } })) } : {}),
  };
}

/**
 * Baris retur LAYAK yang TIDAK punya baris buku `RETUR_PEMBELI` (opname toko
 * sudah menghitungnya sesudah dilaporkan, jadi persetujuannya melewati buku).
 * Baris rusak/expired dibiarkan lewat. `bukuRetur`: baris `RETUR_PEMBELI`
 * (refType `SpgSaleReturn`) laporan-laporan itu. Keputusan melewati buku
 * diambil per barang × ukuran per laporan, jadi pencocokannya juga begitu.
 */
export function tanpaBarisBuku<T extends { returnId: string; itemId: string; variantSku: string | null; condition: string }>(
  baris: readonly T[],
  bukuRetur: readonly { refId: string | null; itemId: string; variantSku: string | null }[],
): T[] {
  const berbuku = new Set(bukuRetur.filter((g) => g.refId).map((g) => `${g.refId}|${kunciBaris(g.itemId, g.variantSku)}`));
  return baris.filter((b) => b.condition !== "LAYAK" || !berbuku.has(`${b.returnId}|${kunciBaris(b.itemId, b.variantSku)}`));
}

async function bacaReturTanpaBuku(cakupan: readonly CakupanLaku[], db: Klien, termasukLayak: boolean): Promise<ReturRusakLaku[]> {
  if (cakupan.length === 0) return [];
  const baris = await db.spgSaleReturnLine.findMany({
    where: {
      ...(termasukLayak ? {} : { condition: { not: "LAYAK" as const } }),
      qty: { gt: 0 },
      saleReturn: returPembeliBerlaku({ OR: cakupan.map(saringWaktu) }),
    },
    select: {
      id: true,
      returnId: true,
      itemId: true,
      variantSku: true,
      qty: true,
      condition: true,
      saleLine: { select: { spgSaleId: true } },
      saleReturn: { select: { storeId: true, createdAt: true } },
    },
  });
  if (baris.length === 0) return [];
  const idLayak = [...new Set(baris.filter((b) => b.condition === "LAYAK").map((b) => b.returnId))];
  const bukuRetur = idLayak.length
    ? await db.storeStockMovement.findMany({
        where: { kind: "RETUR_PEMBELI", refType: ENTITAS_RETUR_PEMBELI, refId: { in: idLayak } },
        select: { refId: true, itemId: true, variantSku: true },
      })
    : [];
  const pakai = tanpaBarisBuku(baris, bukuRetur);
  if (pakai.length === 0) return [];
  const notaIds = [...new Set(pakai.map((b) => b.saleLine.spgSaleId))];
  const jual = await db.storeStockMovement.findMany({
    where: { kind: "JUAL", refType: "SpgSale", refId: { in: notaIds } },
    select: { refId: true, itemId: true, variantSku: true, qty: true },
  });
  return returRusakBerbuku(
    pakai.map((b) => ({
      lineId: b.id,
      storeId: b.saleReturn.storeId,
      spgSaleId: b.saleLine.spgSaleId,
      itemId: b.itemId,
      variantSku: b.variantSku,
      qty: b.qty,
      createdAt: b.saleReturn.createdAt,
    })),
    jual,
  );
}

/**
 * Retur rusak/expired dari pembeli dalam cakupan (yang DISETUJUI), yang boleh
 * mengurangi laku — barangnya masih di toko tapi tidak di buku (pencocokan
 * memakainya untuk stok titipan). Lihat kepala berkas.
 */
export async function returRusakLaku(cakupan: readonly CakupanLaku[], db: Klien = prisma): Promise<ReturRusakLaku[]> {
  return bacaReturTanpaBuku(cakupan, db, false);
}

/**
 * Semua retur tanpa baris buku dalam cakupan: rusak/expired DITAMBAH LAYAK yang
 * disetujui tanpa `RETUR_PEMBELI` (sudah terhitung opname). Hanya untuk angka
 * LAKU — barang LAYAK itu sudah ada di saldo buku lewat baris OPNAME-nya, jadi
 * jangan memakainya sebagai "barang di toko di luar buku".
 */
export async function returTanpaBukuLaku(cakupan: readonly CakupanLaku[], db: Klien = prisma): Promise<ReturRusakLaku[]> {
  return bacaReturTanpaBuku(cakupan, db, true);
}

/**
 * Semua gerakan laku dalam cakupan, bertanda buku (JUAL negatif, retur positif):
 * JUAL + RETUR_PEMBELI dari buku, ditambah retur tanpa baris buku yang notanya berbuku.
 * Laku bersih sebuah kunci = −Σ qty-nya.
 */
export async function gerakLakuBersih(cakupan: readonly CakupanLaku[], db: Klien = prisma): Promise<GerakLaku[]> {
  if (cakupan.length === 0) return [];
  const [buku, rusak] = await Promise.all([
    db.storeStockMovement.findMany({
      where: { kind: { in: ["JUAL", "RETUR_PEMBELI"] }, OR: cakupan.map(saringWaktu) },
      select: { storeId: true, itemId: true, variantSku: true, qty: true, createdAt: true },
    }),
    returTanpaBukuLaku(cakupan, db),
  ]);
  return [
    ...buku.map((b) => ({ storeId: b.storeId, itemId: b.itemId, variantSku: b.variantSku ?? "", qty: b.qty, createdAt: b.createdAt })),
    ...rusak.map((r) => ({ storeId: r.storeId, itemId: r.itemId, variantSku: r.variantSku, qty: r.qty, createdAt: r.createdAt })),
  ];
}

/**
 * Σ laku bersih sejak `sejak` per toko lalu per `kunciBaris`, bertanda buku
 * (JUAL negatif) — untuk banyak toko sekaligus: gerakan buku dijumlah di basis
 * data (`groupBy`), retur tanpa baris buku (sedikit) ditambahkan di sini. Definisinya
 * sama dengan `gerakLakuBersih`.
 */
export async function jumlahLakuBersihSejak(storeIds: readonly string[], sejak: Date, db: Klien = prisma): Promise<Map<string, Map<string, number>>> {
  if (storeIds.length === 0) return new Map();
  const [grup, rusak] = await Promise.all([
    db.storeStockMovement.groupBy({
      by: ["storeId", "itemId", "variantSku"],
      where: { storeId: { in: [...storeIds] }, kind: { in: ["JUAL", "RETUR_PEMBELI"] }, createdAt: { gte: sejak } },
      _sum: { qty: true },
    }),
    returTanpaBukuLaku(storeIds.map((storeId) => ({ storeId, dari: sejak })), db),
  ]);
  return jumlahLakuPerKunci(
    [
      ...grup.map((g) => ({ storeId: g.storeId, itemId: g.itemId, variantSku: g.variantSku ?? "", qty: g._sum.qty ?? 0, createdAt: sejak })),
      ...rusak,
    ],
    sejak,
  );
}
