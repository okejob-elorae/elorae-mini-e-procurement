import { prisma, type Prisma } from "@elorae/db";
import { kunciBaris } from "./stok";

/**
 * Laku BERSIH menurut buku stok toko — SATU definisi untuk setiap pembaca
 * kecepatan laku (stok di toko, pencocokan konsinyasi, dan pembaca lain yang
 * menyusul).
 *
 *   laku bersih = −(JUAL + RETUR_PEMBELI + retur rusak)
 *
 * - JUAL: −qty per baris nota SPG (`recordSpgSale`).
 * - RETUR_PEMBELI: +qty barang LAYAK yang dikembalikan pembeli — kembali ke rak.
 * - Retur rusak: barang RUSAK/EXPIRED yang dikembalikan pembeli. Tidak punya
 *   baris buku (tidak kembali ke rak), tapi juga BUKAN penjualan — di sini ia
 *   menjadi gerakan +qty bertanggal returnya, sama seperti RETUR_PEMBELI.
 *   Hanya untuk nota yang punya baris JUAL di buku untuk barang × ukuran itu,
 *   dan tidak melebihi JUAL-nya: penjualan tanpa sinyal yang sudah tertelan
 *   opname tidak pernah memotong buku, jadi returnya juga tidak boleh
 *   mengurangi laku.
 *
 * Saldo buku tidak berubah — gerakan retur rusak di sini hanya untuk angka laku.
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

/** Retur rusak/expired dari pembeli dalam cakupan, yang boleh mengurangi laku (lihat kepala berkas). */
export async function returRusakLaku(cakupan: readonly CakupanLaku[], db: Klien = prisma): Promise<ReturRusakLaku[]> {
  if (cakupan.length === 0) return [];
  const baris = await db.spgSaleReturnLine.findMany({
    where: { condition: { not: "LAYAK" }, qty: { gt: 0 }, saleReturn: { OR: cakupan.map(saringWaktu) } },
    select: {
      id: true,
      itemId: true,
      variantSku: true,
      qty: true,
      saleLine: { select: { spgSaleId: true } },
      saleReturn: { select: { storeId: true, createdAt: true } },
    },
  });
  if (baris.length === 0) return [];
  const notaIds = [...new Set(baris.map((b) => b.saleLine.spgSaleId))];
  const jual = await db.storeStockMovement.findMany({
    where: { kind: "JUAL", refType: "SpgSale", refId: { in: notaIds } },
    select: { refId: true, itemId: true, variantSku: true, qty: true },
  });
  return returRusakBerbuku(
    baris.map((b) => ({
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
 * Semua gerakan laku dalam cakupan, bertanda buku (JUAL negatif, retur positif):
 * JUAL + RETUR_PEMBELI dari buku, ditambah retur rusak yang berbuku.
 * Laku bersih sebuah kunci = −Σ qty-nya.
 */
export async function gerakLakuBersih(cakupan: readonly CakupanLaku[], db: Klien = prisma): Promise<GerakLaku[]> {
  if (cakupan.length === 0) return [];
  const [buku, rusak] = await Promise.all([
    db.storeStockMovement.findMany({
      where: { kind: { in: ["JUAL", "RETUR_PEMBELI"] }, OR: cakupan.map(saringWaktu) },
      select: { storeId: true, itemId: true, variantSku: true, qty: true, createdAt: true },
    }),
    returRusakLaku(cakupan, db),
  ]);
  return [
    ...buku.map((b) => ({ storeId: b.storeId, itemId: b.itemId, variantSku: b.variantSku ?? "", qty: b.qty, createdAt: b.createdAt })),
    ...rusak.map((r) => ({ storeId: r.storeId, itemId: r.itemId, variantSku: r.variantSku, qty: r.qty, createdAt: r.createdAt })),
  ];
}

/**
 * Σ laku bersih sejak `sejak` per toko lalu per `kunciBaris`, bertanda buku
 * (JUAL negatif) — untuk banyak toko sekaligus: gerakan buku dijumlah di basis
 * data (`groupBy`), retur rusak (sedikit) ditambahkan di sini. Definisinya
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
    returRusakLaku(storeIds.map((storeId) => ({ storeId, dari: sejak })), db),
  ]);
  return jumlahLakuPerKunci(
    [
      ...grup.map((g) => ({ storeId: g.storeId, itemId: g.itemId, variantSku: g.variantSku ?? "", qty: g._sum.qty ?? 0, createdAt: sejak })),
      ...rusak,
    ],
    sejak,
  );
}
