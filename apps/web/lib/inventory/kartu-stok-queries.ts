import { prisma } from "@elorae/db";
import {
  REF_BERPASANGAN,
  gabungGerakan,
  kunciPasanganMovement,
  kunciPasanganPenyesuaian,
  qtyBertandaPenyesuaian,
  susunKartuStok,
  type BarisMovementKartu,
  type BarisPenyesuaianKartu,
  type KartuStokTersusun,
} from "./kartu-stok";

/**
 * Pemuat kartu stok gudang dari basis data. Membaca SEMUA gerakan yang
 * menggerakkan `InventoryValue` (StockMovement + StockAdjustment semua sumber),
 * lalu menyusunnya dengan `susunKartuStok` (lib/inventory/kartu-stok.ts).
 *
 * Batas yang disengaja: `StockAdjustment` tidak punya kolom varian, jadi kartu
 * per varian hanya bisa memuat StockMovement varian itu. Penyesuaian yang
 * terlewat dihitung (`penyesuaianTanpaVarian`) supaya layar bisa
 * memperingatkan, dan `tanpaDokumen` dibiarkan null di mode itu.
 */

export type KartuStokBarang = KartuStokTersusun & {
  /**
   * Penyesuaian sejak `dari` (sampai sekarang) yang tidak bisa dipilah per varian
   * (hanya mode varian). Yang di dalam rentang tidak tampil; yang sesudahnya
   * menggeser saldo yang dijangkar ke stok sekarang.
   */
  penyesuaianTanpaVarian: number;
};

const toNum = (v: unknown): number => (v == null ? 0 : Number(v));

const pilihMovement = {
  id: true,
  itemId: true,
  variantSku: true,
  type: true,
  refType: true,
  refId: true,
  refDocNumber: true,
  qty: true,
  unitCost: true,
  notes: true,
  createdAt: true,
} as const;

const pilihPenyesuaian = {
  id: true,
  itemId: true,
  docNumber: true,
  type: true,
  qtyChange: true,
  prevQty: true,
  newQty: true,
  prevAvgCost: true,
  newAvgCost: true,
  source: true,
  externalRef: true,
  reason: true,
  createdAt: true,
} as const;

/** Saring varian yang toleran: "" dan null sama-sama berarti "tanpa varian". */
function saringVarian(variantSku: string) {
  return variantSku === "" ? { OR: [{ variantSku: null }, { variantSku: "" }] } : { variantSku };
}

/**
 * Muat kartu stok untuk sekumpulan barang dalam satu rentang.
 *
 * `sejakAwal` = baca seluruh riwayat (bukan hanya sejak `dari`), sehingga
 * `tanpaDokumen` bisa dihitung. Dipakai kartu satu barang; tampilan per jenis /
 * per kategori cukup sejak `dari`.
 */
export async function muatKartuStok(p: {
  itemIds: string[];
  dari: Date;
  sampai: Date;
  variantSku?: string;
  sejakAwal?: boolean;
}): Promise<Map<string, KartuStokBarang>> {
  const hasil = new Map<string, KartuStokBarang>();
  const itemIds = [...new Set(p.itemIds)].filter(Boolean);
  if (itemIds.length === 0) return hasil;

  const modeVarian = p.variantSku != null;
  const batasBawah = p.sejakAwal ? {} : { createdAt: { gte: p.dari } };
  const varian = modeVarian ? saringVarian(p.variantSku!) : {};

  const [saldo, movements, penyesuaian, pasangan] = await Promise.all([
    prisma.inventoryValue.groupBy({
      by: ["itemId"],
      where: { itemId: { in: itemIds }, ...varian },
      _sum: { qtyOnHand: true, totalValue: true },
    }),
    prisma.stockMovement.findMany({
      where: { itemId: { in: itemIds }, ...batasBawah, ...varian },
      select: pilihMovement,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.stockAdjustment.findMany({
      // Mode varian: penyesuaian tidak tampil, cukup dihitung sejak `dari` untuk peringatan.
      where: modeVarian
        ? { itemId: { in: itemIds }, createdAt: { gte: p.dari } }
        : { itemId: { in: itemIds }, ...batasBawah },
      select: pilihPenyesuaian,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.stockMovement.findMany({
      where: { itemId: { in: itemIds }, refType: { in: [...REF_BERPASANGAN] } },
      select: { refType: true, refId: true, itemId: true },
      distinct: ["refType", "refId", "itemId"],
    }),
  ]);

  const kunci = new Set<string>();
  for (const m of pasangan) {
    const k = kunciPasanganMovement(m);
    if (k) kunci.add(k);
  }

  const movPerBarang = new Map<string, BarisMovementKartu[]>();
  for (const m of movements) {
    const daftar = movPerBarang.get(m.itemId) ?? [];
    daftar.push({
      id: m.id,
      itemId: m.itemId,
      variantSku: m.variantSku,
      type: m.type,
      refType: m.refType,
      refId: m.refId,
      refDocNumber: m.refDocNumber,
      qty: toNum(m.qty),
      unitCost: m.unitCost == null ? null : Number(m.unitCost),
      notes: m.notes,
      createdAt: m.createdAt,
    });
    movPerBarang.set(m.itemId, daftar);
  }

  const adjPerBarang = new Map<string, BarisPenyesuaianKartu[]>();
  const tanpaVarian = new Map<string, number>();
  for (const a of penyesuaian) {
    const baris: BarisPenyesuaianKartu = {
      id: a.id,
      itemId: a.itemId,
      docNumber: a.docNumber,
      type: a.type,
      qtyChange: toNum(a.qtyChange),
      prevQty: a.prevQty == null ? null : Number(a.prevQty),
      newQty: a.newQty == null ? null : Number(a.newQty),
      prevAvgCost: toNum(a.prevAvgCost),
      newAvgCost: toNum(a.newAvgCost),
      source: a.source,
      externalRef: a.externalRef,
      reason: a.reason,
      createdAt: a.createdAt,
    };
    if (modeVarian) {
      if (!kunci.has(kunciPasanganPenyesuaian(baris)) && qtyBertandaPenyesuaian(baris) !== 0) {
        tanpaVarian.set(a.itemId, (tanpaVarian.get(a.itemId) ?? 0) + 1);
      }
      continue;
    }
    const daftar = adjPerBarang.get(a.itemId) ?? [];
    daftar.push(baris);
    adjPerBarang.set(a.itemId, daftar);
  }

  const saldoPerBarang = new Map(saldo.map((s) => [s.itemId, s._sum]));
  for (const itemId of itemIds) {
    const gerakan = gabungGerakan(movPerBarang.get(itemId) ?? [], adjPerBarang.get(itemId) ?? [], kunci);
    let qtySebelumDari: number | null = null;
    if (p.sejakAwal && !modeVarian) {
      qtySebelumDari = 0;
      for (const g of gerakan) {
        if (g.tanggal.getTime() >= p.dari.getTime()) break;
        qtySebelumDari += g.qty;
      }
    }
    const jumlah = saldoPerBarang.get(itemId);
    const kartu = susunKartuStok({
      gerakan,
      saldoSekarang: toNum(jumlah?.qtyOnHand),
      nilaiSekarang: toNum(jumlah?.totalValue),
      dari: p.dari,
      sampai: p.sampai,
      qtySebelumDari,
    });
    hasil.set(itemId, { ...kartu, penyesuaianTanpaVarian: tanpaVarian.get(itemId) ?? 0 });
  }
  return hasil;
}
