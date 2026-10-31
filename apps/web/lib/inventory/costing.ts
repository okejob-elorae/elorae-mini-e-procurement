/**
 * Stock-moving cost helpers, called only from inside server actions and lib writers. Deliberately
 * NOT a "use server" module: that directive would make every export here a network-callable action
 * that moves stock with no permission check. It also imports nothing from `@/lib/auth` — this file
 * sits on the stock movers' import chain, and next-auth cannot load under vitest, so a value import
 * here breaks every DB spec that reaches it. Gated reads live in `app/actions/inventory.ts`; client
 * components read the inventory value through `@/app/actions/nilai-persediaan`. Guarded by
 * `lib/tanpa-use-server.test.ts`.
 */
import { Decimal } from 'decimal.js';
import { Prisma, prisma, moveMainStock, lockMainInventoryValueRow, ConcurrentFirstReceiptError } from '@elorae/db';
import {
  filterAndSortStockItems,
  summarizeStockHealth,
  type StockSort,
  type StockStatus,
} from '@/lib/inventory/stock-status';
import { buildVariantStockChips } from '@/lib/inventory/variant-stock-label';

export interface CostCalculationResult {
  previousQty: Decimal;
  previousAvgCost: Decimal;
  previousTotalValue: Decimal;
  incomingQty: Decimal;
  incomingUnitCost: Decimal;
  incomingTotalValue: Decimal;
  newQty: Decimal;
  newAvgCost: Decimal;
  newTotalValue: Decimal;
}

export type StockRef = {
  refType: string;
  refId: string;
  refDocNumber?: string;
  createdById?: string | null;
  occurredAt?: Date;
};

/*
 * InventoryValue keys a variantless row as null OR "" — apps/web/lib/items/mutations.ts creates
 * ERP items with null, while some writers use "". A strict findUnique on the normalized ""
 * spelling misses a real null row, so this mirrors moveMainStock's own OR-tolerant lookup
 * exactly (same orderBy tie-break), and the resolved row's id is passed back to moveMainStock as
 * `inventoryValueId` so the write is guaranteed to land on the same row this read found.
 *
 * Exported so every on-hand-stock pre-check in apps/web reuses this exact lookup instead of a
 * hand-rolled spelling of it. The whole point is the tie-break, not just the OR: callers pass the
 * resolved id straight back into moveMainStock as inventoryValueId, so two callers reading the
 * same null/"" bucket must land on the same row or they interleave two independent balances under
 * one ledger key. Current callers: grn.ts's declineGRNByOwner insufficient-stock guard,
 * inventory.ts (getInventoryValue), vendor-returns.ts (vendor return valuation, create and
 * update), opname-snapshot.ts, opname-approve.ts,
 * canvassing/writer.ts, canvassing/reconcile-writer.ts,
 * field-sales/retur/approve-writer.ts, field-sales/konsi-push-writer.ts,
 * field-sales/writer.ts (konsi approve added lines), konsi-sell-through/writer.ts (a line's
 * unitCost fallback when the store row has no average), production/kembali-bahan-writer.ts
 * (material coming back from the CMT), and
 * reverseMovingAverage / calculateMovingAverage / reverseInventoryValue below — calculateMovingAverage
 * then takes packages/db's locking copy of the same row before it reads the cost it blends.
 * reconciliation-runner.ts's MATCH_JUBELIO path uses that locking copy,
 * lockMainInventoryValueRow, instead, because it must lock the row before reading it; and
 * konsi-transfer/writer.ts uses packages/db's resolveReservedInventory, because it draws down a
 * reservation and must act on the row that reservation was made against.
 *
 * packages/db cannot import this (it sits above apps/web), so it carries its own copies — and
 * there are FOUR, not two. moveMainStock and setMainStock in stock-balance.ts, the return-accept
 * restore in sales-return-writer.ts, and lockMainInventoryValueRow in stock-row-lock.ts (the raw
 * `SELECT … FOR UPDATE` behind applyJubelioStockAdjustment, MATCH_JUBELIO, moveMainStock's
 * first-receipt re-read, calculateMovingAverage's receipt read below and the superseded-item
 * retirement) all restate this shape, tie-break included. Change this helper, change all four —
 * calculateMovingAverage refuses a receipt whose locked row is not the row this lookup found.
 *
 * Two further packages/db lookups are deliberately a DIFFERENT shape and must not be
 * "harmonised" onto this one: reservation-writer.ts's findReservationInventory prefers an exact
 * "" row and only falls back to null, because a bare OR can decrement the sibling row and orphan
 * reservedQty on an item carrying both spellings; and item-price-writer.ts reads avgCost only,
 * item-level with no variant input at all, so it pins no row and needs no tie-break.
 */
export async function findExistingInventoryValueRow(
  prismaClient: any,
  itemId: string,
  variantSku: string | null | undefined
) {
  return variantSku
    ? prismaClient.inventoryValue.findFirst({
        where: { itemId, variantSku },
      })
    : prismaClient.inventoryValue.findFirst({
        where: { itemId, OR: [{ variantSku: null }, { variantSku: "" }] },
        orderBy: { id: "asc" },
      });
}

export interface HasilRataRataMasuk {
  qtyBaru: Decimal;
  avgBaru: Decimal;
  nilaiLama: Decimal;
  nilaiMasuk: Decimal;
  nilaiBaru: Decimal;
}

/**
 * Rata-rata bergerak saat barang MASUK (murni, diuji dengan angka).
 * Stok lama ≤ 0 tidak ikut ditimbang: barang minus sudah keluar dengan harga
 * lamanya, jadi yang tersisa di gudang bernilai harga masuk. Menimbang qty
 * negatif membuat rata-rata melambung (−5 @ 8.000 + 10 @ 9.000 → 10.000).
 */
export function hitungRataRataMasuk(p: {
  qtyLama: Decimal.Value;
  avgLama: Decimal.Value;
  qtyMasuk: Decimal.Value;
  hargaMasuk: Decimal.Value;
}): HasilRataRataMasuk {
  const qtyLama = new Decimal(p.qtyLama);
  const avgLama = new Decimal(p.avgLama);
  const qtyMasuk = new Decimal(p.qtyMasuk);
  const hargaMasuk = new Decimal(p.hargaMasuk);
  const qtyBaru = qtyLama.plus(qtyMasuk);
  const nilaiLama = qtyLama.mul(avgLama);
  const nilaiMasuk = qtyMasuk.mul(hargaMasuk);

  if (qtyLama.gt(0) && qtyBaru.gt(0)) {
    const nilaiBaru = nilaiLama.plus(nilaiMasuk);
    return { qtyBaru, avgBaru: nilaiBaru.div(qtyBaru), nilaiLama, nilaiMasuk, nilaiBaru };
  }
  // Stok lama ≤ 0 → harga masuk; stok lama > 0 tapi qty masuk negatif sampai habis → harga lama.
  const avgBaru = qtyLama.lte(0) ? hargaMasuk : avgLama;
  return { qtyBaru, avgBaru, nilaiLama, nilaiMasuk, nilaiBaru: qtyBaru.mul(avgBaru) };
}

/**
 * Baris stok tanpa varian di basis data bisa ber-`variantSku` null ATAU "" — terima keduanya.
 * SATU pencari untuk semua penulis di berkas ini (masuk DAN keluar): pencarian
 * ketat ke "" melewatkan baris bahan ber-null (retur ke pemasok kain/aksesori
 * dulu bernilai 0 lalu ditolak STOK_KURANG). Baris kembar null + "" tidak
 * dijumlah — urutan pemilihnya sama dengan `findExistingInventoryValueRow`.
 */
export async function cariBarisStok(client: any, itemId: string, variantSku?: string | null) {
  const v = variantSku?.trim() ?? '';
  return findExistingInventoryValueRow(client, itemId, v === '' ? null : variantSku);
}

/*
 * Antrean per klien (per transaksi). `createGRN` memanggil `calculateMovingAverage`
 * lewat `Promise.all` di SATU transaksi, jadi dua baris barang yang sama saling
 * selang di setiap `await`: barang baru → keduanya membuat baris (P2002, GRN
 * gagal); barang lama → baris kedua membaca rata-rata sebelum baris pertama
 * menulisnya (10 @ 1.000 + 10 @ 4.000 + 10 @ 7.000 berakhir 90.000, bukan 120.000).
 * Antrean tidak menyeberangi transaksi: penulis dari transaksi lain dijaga kunci baris.
 */
const antreanKlien = new WeakMap<object, Promise<unknown>>();

function berurutanPerKlien<T>(klien: object, kerja: () => Promise<T>): Promise<T> {
  const sebelumnya = antreanKlien.get(klien) ?? Promise.resolve();
  const hasil = sebelumnya.then(kerja);
  antreanKlien.set(klien, hasil.catch(() => undefined));
  return hasil;
}

/**
 * Barang MASUK pada rata-rata bergerak (GRN, penerimaan barang jadi, impor GRN lama). `ref` wajib:
 * kenaikan qty, rata-rata baru dan entri buku stok selalu ditulis `moveMainStock` dalam satu
 * pernyataan — tidak ada jalur tulis langsung ke `InventoryValue`.
 *
 * Dipanggil di dalam transaksi (`tx`): baris stok dikunci sebelum rata-ratanya dibaca, dan kunci
 * itu hanya bertahan sampai transaksinya selesai.
 */
export function calculateMovingAverage(
  itemId: string,
  incomingQty: Decimal,
  incomingCost: Decimal,
  tx: any,
  variantSku: string | null | undefined,
  ref: StockRef
): Promise<CostCalculationResult> {
  const prismaClient = tx || prisma;
  return berurutanPerKlien(prismaClient, () =>
    tulisRataRataMasuk(prismaClient, itemId, incomingQty, incomingCost, variantSku, ref)
  );
}

/*
 * The cost a receipt blends against must come from a LOCKED read. moveMainStock increments qtyOnHand
 * atomically but SETs avgCost/totalValue to the figures passed in, so two receipts of the same item
 * in separate transactions that both computed from an unlocked read would each write their own
 * average: under REPEATABLE READ, 10 @ 1.000 and 10 @ 3.000 end at 20 units @ 3.000 instead of
 * 20 @ 2.000. Taking the row lock first makes the second receipt wait for the first to commit and
 * blend against what it left behind.
 *
 * The plain lookup still runs first, on purpose. When it finds no row, moveMainStock's first-receipt
 * path compares its own lookup against this same snapshot and refuses a row a concurrent receipt
 * opened in the meantime (ConcurrentFirstReceiptError). Locking first would let that plain lookup run
 * after the other receipt committed, find its row, and SET an average computed as if nothing were on
 * hand. A locked read that disagrees with the lookup is the same race seen from the other side, and
 * is refused the same way.
 */
async function bacaBarisTerkunci(
  prismaClient: any,
  itemId: string,
  variantSku: string | null | undefined
): Promise<{ id: string; qtyOnHand: string; avgCost: string } | null> {
  const ditemukan = await findExistingInventoryValueRow(prismaClient, itemId, variantSku);
  if (!ditemukan) return null;
  const terkunci = await lockMainInventoryValueRow(prismaClient, itemId, variantSku);
  if (!terkunci || terkunci.id !== ditemukan.id) {
    throw new ConcurrentFirstReceiptError(itemId, variantSku);
  }
  return terkunci;
}

async function tulisRataRataMasuk(
  prismaClient: any,
  itemId: string,
  incomingQty: Decimal,
  incomingCost: Decimal,
  variantSku: string | null | undefined,
  ref: StockRef
): Promise<CostCalculationResult> {
  const current = await bacaBarisTerkunci(prismaClient, itemId, variantSku);

  const previousQty = current ? new Decimal(current.qtyOnHand) : new Decimal(0);
  const previousAvgCost = current ? new Decimal(current.avgCost) : new Decimal(0);
  const r = hitungRataRataMasuk({
    qtyLama: previousQty,
    avgLama: previousAvgCost,
    qtyMasuk: incomingQty,
    hargaMasuk: incomingCost,
  });

  // createIfMissing only fires when the OR-tolerant read above found no row at all (a genuine
  // never-before-stocked item, matching the upsert this replaced). When it did find a row,
  // inventoryValueId pins the write to that exact row instead of letting moveMainStock
  // re-resolve independently and potentially land on a sibling null/"" row.
  // totalCost/balanceValue are the incoming and new total values, computed above and passed
  // straight into the ledger mover below.
  await moveMainStock(prismaClient, {
    itemId,
    variantSku,
    qtyDelta: incomingQty.toNumber(),
    avgCost: r.avgBaru.toNumber(),
    totalValue: r.nilaiBaru.toNumber(),
    totalCost: r.nilaiMasuk.toNumber(),
    balanceValue: r.nilaiBaru.toNumber(),
    createIfMissing: true,
    inventoryValueId: current?.id,
    ...ref,
  });

  return {
    previousQty,
    previousAvgCost,
    previousTotalValue: r.nilaiLama,
    incomingQty,
    incomingUnitCost: incomingCost,
    incomingTotalValue: r.nilaiMasuk,
    newQty: r.qtyBaru,
    newAvgCost: r.avgBaru,
    newTotalValue: r.nilaiBaru,
  };
}

/**
 * Reverse inventory value for returns/negative adjustments.
 * Outgoing value is at current avg cost; throws if insufficient stock.
 * `outgoingValue` = nilai yang BENAR-BENAR keluar dari kartu stok (qty ×
 * rata-rata saat ini) — pencatat gerakan memakainya, bukan harga dokumen,
 * supaya saldo kartu stok dan jurnalnya sama.
 */
export async function reverseInventoryValue(
  itemId: string,
  outgoingQty: Decimal,
  outgoingUnitCost: Decimal,
  tx: any,
  variantSku: string | null | undefined,
  ref: StockRef
): Promise<{ newQty: Decimal; newAvgCost: Decimal; newTotalValue: Decimal; outgoingValue: Decimal }> {
  const prismaClient = tx || prisma;
  const current = await cariBarisStok(prismaClient, itemId, variantSku);

  if (!current) throw new Error('No inventory record found');

  const currentQty = new Decimal(current.qtyOnHand.toString());
  const currentAvgCost = new Decimal(current.avgCost.toString());

  if (currentQty.lt(outgoingQty)) {
    throw new Error('Insufficient stock');
  }

  const newQty = currentQty.minus(outgoingQty);
  const outgoingValue = outgoingQty.mul(currentAvgCost);
  const newTotalValue = new Decimal(current.totalValue.toString()).minus(outgoingValue);

  const newAvgCost = newQty.gt(0)
    ? newTotalValue.div(newQty)
    : new Decimal(0);

  // The `if (!current) throw` above already guards the missing-row case (the OR-tolerant read
  // finds the row regardless of null/"" spelling, so it fires only when neither spelling exists),
  // so this never legitimately creates a row — no createIfMissing. inventoryValueId pins the
  // write to the exact row `current` was just read from. totalCost is outgoingValue; balanceValue
  // is the new total — both passed straight into the ledger mover below.
  await moveMainStock(prismaClient, {
    itemId,
    variantSku,
    qtyDelta: outgoingQty.neg().toNumber(),
    avgCost: newAvgCost.toNumber(),
    totalValue: newTotalValue.toNumber(),
    totalCost: outgoingValue.toNumber(),
    balanceValue: newTotalValue.toNumber(),
    inventoryValueId: current.id,
    ...ref,
  });

  return { newQty, newAvgCost, newTotalValue, outgoingValue };
}

// Reverse calculation for returns (negative quantity) - uses passed cost
export async function reverseMovingAverage(
  itemId: string,
  outgoingQty: Decimal,
  outgoingCost: Decimal,
  tx: any,
  variantSku: string | null | undefined,
  ref: StockRef
): Promise<CostCalculationResult> {
  const prismaClient = tx || prisma;

  // Get current inventory state (toleran null/"", sama dengan penulis masuk)
  const current = await cariBarisStok(prismaClient, itemId, variantSku);
  if (!current) throw new Error('No inventory record found');

  const previousQty = current?.qtyOnHand ? new Decimal(current.qtyOnHand.toString()) : new Decimal(0);
  const previousAvgCost = current?.avgCost ? new Decimal(current.avgCost.toString()) : new Decimal(0);
  const previousTotalValue = previousQty.mul(previousAvgCost);

  // Calculate new totals (subtracting)
  const newTotalQty = previousQty.minus(outgoingQty);
  const outgoingTotalValue = outgoingQty.mul(outgoingCost);
  const newTotalValue = previousTotalValue.minus(outgoingTotalValue);

  // Average cost remains the same for outgoing (FIFO-like behavior)
  const newAvgCost = previousAvgCost;

  // inventoryValueId pins moveMainStock's write to the row the OR-tolerant read above resolved.
  // totalCost is outgoingTotalValue negated, matching the negated qtyDelta.
  await moveMainStock(prismaClient, {
    itemId,
    variantSku,
    qtyDelta: outgoingQty.neg().toNumber(),
    avgCost: newAvgCost.toNumber(),
    totalValue: newTotalValue.toNumber(),
    totalCost: outgoingTotalValue.neg().toNumber(),
    balanceValue: newTotalValue.toNumber(),
    inventoryValueId: current.id,
    ...ref,
  });

  return {
    previousQty,
    previousAvgCost,
    previousTotalValue,
    incomingQty: outgoingQty,
    incomingUnitCost: outgoingCost,
    incomingTotalValue: outgoingTotalValue,
    newQty: newTotalQty,
    newAvgCost,
    newTotalValue,
  };
}

// Get current inventory value for an item (or item+variant). Serialized for client.
export async function getInventoryValue(itemId: string, variantSku?: string | null) {
  const baris = await cariBarisStok(prisma, itemId, variantSku);
  if (!baris) return null;
  const v = await prisma.inventoryValue.findUnique({
    where: { id: baris.id },
    include: {
      item: {
        select: {
          sku: true,
          nameId: true,
          nameEn: true,
          uom: {
            select: {
              code: true,
              nameId: true,
            },
          },
        },
      },
    },
  });
  if (!v) return null;
  return {
    ...v,
    qtyOnHand: Number(v.qtyOnHand),
    avgCost: Number(v.avgCost),
    totalValue: Number(v.totalValue),
  };
}

const inventorySnapshotInclude = {
  item: {
    select: {
      sku: true,
      nameId: true,
      nameEn: true,
      type: true,
      reorderPoint: true,
      variants: true,
      uom: {
        select: {
          code: true,
          nameId: true
        }
      }
    }
  }
};

const inventorySnapshotOrderBy = {
  item: {
    sku: 'asc' as const
  }
};

type InventorySnapshotRow = Prisma.InventoryValueGetPayload<{
  include: typeof inventorySnapshotInclude;
}>;

type VariantChipAccum = {
  variantSku: string;
  qtyOnHand: number;
  reservedQty: number;
};

// Aggregate InventoryValue rows by itemId (one row per item; sum qty/reserved/value, weighted avg cost)
// Preserves factual per-variant chips from non-empty variantSku rows.
function aggregateSnapshotByItemId(
  values: InventorySnapshotRow[],
  toNum: (v: unknown) => number | null
) {
  const byItem = new Map<
    string,
    {
      qtyOnHand: number;
      reservedQty: number;
      totalValue: number;
      item: InventorySnapshotRow['item'];
      variantRows: VariantChipAccum[];
    }
  >();
  for (const v of values) {
    const qty = toNum(v.qtyOnHand) ?? 0;
    const reserved = toNum(v.reservedQty) ?? 0;
    const val = toNum(v.totalValue) ?? 0;
    const existing = byItem.get(v.itemId);
    if (existing) {
      existing.qtyOnHand += qty;
      existing.reservedQty += reserved;
      existing.totalValue += val;
      existing.variantRows.push({
        variantSku: v.variantSku ?? "",
        qtyOnHand: qty,
        reservedQty: reserved,
      });
    } else {
      byItem.set(v.itemId, {
        qtyOnHand: qty,
        reservedQty: reserved,
        totalValue: val,
        item: v.item,
        variantRows: [
          {
            variantSku: v.variantSku ?? "",
            qtyOnHand: qty,
            reservedQty: reserved,
          },
        ],
      });
    }
  }
  const rows = Array.from(byItem.entries()).map(([itemId, agg]) => {
    const reorderPoint =
      agg.item.reorderPoint != null ? toNum(agg.item.reorderPoint) : null;
    const { variants: itemVariantsJson, ...itemRest } = agg.item;
    const variants = buildVariantStockChips(agg.variantRows, itemVariantsJson);
    return {
      itemId,
      sku: agg.item.sku ?? "",
      qtyOnHand: agg.qtyOnHand,
      reservedQty: agg.reservedQty,
      available: agg.qtyOnHand - agg.reservedQty,
      totalValue: agg.totalValue,
      avgCost: agg.qtyOnHand > 0 ? agg.totalValue / agg.qtyOnHand : 0,
      reorderPoint,
      variants,
      item: {
        ...itemRest,
        reorderPoint,
      },
    };
  });
  return rows;
}

export type GetInventorySnapshotOpts = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: StockStatus;
  sort?: StockSort;
};

// Get inventory snapshot (one row per item, aggregated from variant-level rows)
export async function getInventorySnapshot(opts?: GetInventorySnapshotOpts) {
  const toNum = (v: unknown) => (v == null ? null : Number(v));

  const values = await prisma.inventoryValue.findMany({
    include: inventorySnapshotInclude,
    orderBy: inventorySnapshotOrderBy,
  });

  const allItems = aggregateSnapshotByItemId(values, toNum);
  // Portfolio summary (value / count / health) is always over the full set.
  const totalValue = allItems.reduce((sum, v) => sum + v.totalValue, 0);
  const health = summarizeStockHealth(
    allItems.map((v) => ({
      available: v.available,
      reorderPoint: v.item.reorderPoint,
    })),
  );
  // lowStockItems kept for callers; maps to menipis (excludes habis/negatif).
  const lowStockItems = health.menipisCount;

  // Search filters the list (server-side, across all rows — not just the current page).
  // Also matches against per-variant SKUs (e.g. "27000101P-BLK-XL") so a variant-code
  // search surfaces the article it belongs to.
  const q = opts?.search?.trim().toLowerCase();
  const searched = q
    ? allItems.filter(
        (v) =>
          v.item.sku.toLowerCase().includes(q) ||
          v.item.nameId.toLowerCase().includes(q) ||
          v.variants.some((variant) => variant.variantSku.toLowerCase().includes(q)),
      )
    : allItems;

  const matched = filterAndSortStockItems(searched, {
    status: opts?.status,
    sort: opts?.sort ?? "stock_desc",
  });

  const portfolio = {
    totalValue,
    totalItems: allItems.length,
    lowStockItems,
    totalAvailable: health.totalAvailable,
    menipisCount: health.menipisCount,
    habisCount: health.habisCount,
    negatifCount: health.negatifCount,
  };

  if (opts?.page != null && opts?.pageSize != null && opts.pageSize > 0) {
    const start = (opts.page - 1) * opts.pageSize;
    const items = matched.slice(start, start + opts.pageSize);
    return {
      items,
      totalCount: matched.length,
      ...portfolio,
    };
  }

  return {
    items: matched,
    totalCount: matched.length,
    ...portfolio,
  };
}
