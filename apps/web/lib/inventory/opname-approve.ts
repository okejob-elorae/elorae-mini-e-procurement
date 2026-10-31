import type { Prisma, StockAdjustmentSource, StockLedgerRefType } from "@elorae/db";
import { prisma, setMainStock } from "@elorae/db";
import { Decimal } from "decimal.js";
import { generateDocNumber } from "@/lib/docNumber";
import { apiFetch } from "@/lib/internal-api";
import {
  hasQtyDrift,
  normalizeVariantKey,
  shouldApplyAdjustment,
} from "./opname";
import { findExistingInventoryValueRow } from "./costing";
import { syncFabricAggregateQty } from "./opname-snapshot";

type Tx = Prisma.TransactionClient;

export type DriftRow = {
  opnameItemId?: string;
  opnameRollId?: string;
  label: string;
  snapshotQty: number;
  currentQty: number;
  kind: "item" | "roll";
};

function toNum(v: unknown): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : Number(v);
}

// Jubelio-ingested items store InventoryValue with variantSku = NULL, while
// normalizeVariantKey maps null/empty to "". A strict lookup on "" misses those NULL
// rows. For the pooled key, match both "" and NULL; for a real variant, match exactly.
function inventoryLookupWhere(itemId: string, variantKey: string) {
  return variantKey === ""
    ? { itemId, OR: [{ variantSku: "" }, { variantSku: null }] }
    : { itemId, variantSku: variantKey };
}

type OpnameItemRow = Awaited<ReturnType<Tx["stockOpnameItem"]["findMany"]>>[number];

/**
 * Baris hitung dikelompokkan per (barang, varian ternormalisasi). Opname yang
 * dibekukan sebelum snapshot digabung bisa punya DUA baris untuk barang tanpa
 * varian (stok null dan ""): keduanya satu kelompok — hitungan dan snapshotnya
 * dijumlah, dan penyesuaiannya ditulis SEKALI.
 */
function kelompokkanBaris(rows: OpnameItemRow[]): OpnameItemRow[][] {
  const kelompok = new Map<string, OpnameItemRow[]>();
  for (const row of rows) {
    const kunci = `${row.itemId}::${normalizeVariantKey(row.variantSku)}`;
    const ada = kelompok.get(kunci);
    if (ada) ada.push(row);
    else kelompok.set(kunci, [row]);
  }
  return [...kelompok.values()];
}

/**
 * Semua baris stok untuk satu kunci (null DAN "" untuk barang tanpa varian),
 * plus baris UTAMA — yang dipilih lookup toleran penulis lain
 * (`findExistingInventoryValueRow`, urutan pemilih yang sama), supaya hasil
 * opname mendarat di baris yang mereka baca.
 */
async function barisStok(tx: Tx, itemId: string, variantKey: string) {
  const where = inventoryLookupWhere(itemId, variantKey);
  const semua = await tx.inventoryValue.findMany({ where });
  const utama = semua.length > 1 ? await findExistingInventoryValueRow(tx, itemId, variantKey) : (semua[0] ?? null);
  const jumlah = semua.reduce((s, r) => s.plus(toNum(r.qtyOnHand)), new Decimal(0));
  const nilai = semua.reduce((s, r) => s.plus(toNum(r.totalValue)), new Decimal(0));
  return { semua, utama, jumlah: jumlah.toNumber(), nilai };
}

const jumlahDecimal = (rows: OpnameItemRow[], ambil: (r: OpnameItemRow) => unknown) =>
  rows.reduce((s, r) => s.plus(toNum(ambil(r))), new Decimal(0)).toNumber();

export async function detectItemDrift(
  tx: Tx,
  opnameId: string,
): Promise<DriftRow[]> {
  const items = await tx.stockOpnameItem.findMany({ where: { opnameId }, orderBy: { id: "asc" } });
  const drift: DriftRow[] = [];
  for (const kelompok of kelompokkanBaris(items)) {
    const row = kelompok[0];
    const { jumlah: currentQty } = await barisStok(tx, row.itemId, normalizeVariantKey(row.variantSku));
    const snapshotQty = jumlahDecimal(kelompok, (r) => r.snapshotQty);
    if (hasQtyDrift(currentQty, snapshotQty)) {
      drift.push({
        opnameItemId: row.id,
        label: row.itemName,
        snapshotQty,
        currentQty,
        kind: "item",
      });
    }
  }
  return drift;
}

export async function detectRollDrift(
  tx: Tx,
  opnameId: string,
): Promise<DriftRow[]> {
  const rolls = await tx.stockOpnameRoll.findMany({ where: { opnameId } });
  const drift: DriftRow[] = [];
  for (const row of rolls) {
    const fabricRoll = await tx.fabricRoll.findUnique({
      where: { id: row.fabricRollId },
      select: { remainingLength: true },
    });
    const currentQty = fabricRoll ? toNum(fabricRoll.remainingLength) : 0;
    const snapshotQty = toNum(row.snapshotLength);
    if (hasQtyDrift(currentQty, snapshotQty)) {
      drift.push({
        opnameRollId: row.id,
        label: `${row.itemName} / ${row.rollCode}`,
        snapshotQty,
        currentQty,
        kind: "roll",
      });
    }
  }
  return drift;
}

async function enqueueStockPush(itemId: string, userId: string): Promise<void> {
  const row = await prisma.jubelioOutbox.create({
    data: {
      entityType: "stock_push",
      entityId: itemId,
      payload: {},
      enqueuedById: userId,
    },
    select: { id: true },
  });
  void apiFetch("POST", `/jubelio/outbox/enqueue/${row.id}`, { userId }).catch(() => {});
}

export async function applyFgAccessoriesAdjustments(
  tx: Tx,
  opnameId: string,
  docNumber: string,
  userId: string,
  scope: "FINISHED_GOOD" | "ACCESSORIES",
): Promise<{ adjustmentCount: number; pushItemIds: string[] }> {
  const items = await tx.stockOpnameItem.findMany({ where: { opnameId }, orderBy: { id: "asc" } });
  let adjustmentCount = 0;
  const pushItemIds: string[] = [];

  for (const kelompok of kelompokkanBaris(items)) {
    const row = kelompok[0];
    const idKelompok = kelompok.map((r) => r.id);
    const countedQty = jumlahDecimal(kelompok, (r) => r.countedQty);
    const variantKey = normalizeVariantKey(row.variantSku);
    // Stok sekarang = jumlah SEMUA baris stok kunci ini (null dan "").
    const stok = await barisStok(tx, row.itemId, variantKey);
    const inv = stok.utama;
    const currentQty = stok.jumlah;
    const snapshotQty = jumlahDecimal(kelompok, (r) => r.snapshotQty);
    const hadDrift = hasQtyDrift(currentQty, snapshotQty);

    await tx.stockOpnameItem.updateMany({
      where: { id: { in: idKelompok } },
      data: {
        currentQtyAtApproval: currentQty,
        hadDriftWarning: hadDrift,
      },
    });

    if (!shouldApplyAdjustment(countedQty, currentQty) || !inv) continue;

    const prevQty = new Decimal(currentQty);
    const newQty = new Decimal(countedQty);
    const prevAvgCost = new Decimal(toNum(inv.avgCost));
    const qtyChange = newQty.minus(prevQty).abs();
    const type = newQty.gte(prevQty) ? "POSITIVE" : "NEGATIVE";
    const idempotencyKey = `opname:${opnameId}:${row.id}`;

    const existing = await tx.stockAdjustment.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) {
      await tx.stockOpnameItem.updateMany({
        where: { id: { in: idKelompok } },
        data: { adjustmentId: existing.id },
      });
      continue;
    }

    // Baris kembar (stok null + "") digabung ke baris utama: isinya pindah ke
    // baris utama, kembarannya dikosongkan — jumlahnya tetap = hitungan, tanpa
    // baris kembar yang tetap membawa isi lamanya. Harganya rata-rata gabungan
    // (nilai semua baris ÷ jumlahnya), supaya nilai persediaan tidak melompat.
    const kembar = stok.semua.filter(
      (r) => r.id !== inv.id && (toNum(r.qtyOnHand) !== 0 || toNum(r.totalValue) !== 0),
    );
    const cost =
      kembar.length > 0 && prevQty.gt(0)
        ? stok.nilai.div(prevQty).toDecimalPlaces(2)
        : prevAvgCost;
    const delta = newQty.minus(prevQty);

    const adjDoc = await generateDocNumber("ADJ", tx);
    const adjustment = await tx.stockAdjustment.create({
      data: {
        docNumber: adjDoc,
        itemId: row.itemId,
        type,
        qtyChange: qtyChange.toNumber(),
        reason: `Stock opname ${docNumber}`,
        prevQty: prevQty.toNumber(),
        newQty: newQty.toNumber(),
        prevAvgCost: prevAvgCost.toNumber(),
        newAvgCost: cost.toNumber(),
        approvedById: userId,
        createdById: userId,
        source: "ERP_OPNAME" satisfies StockAdjustmentSource,
        idempotencyKey,
        externalRef: opnameId,
      },
    });

    // Baris kembar dipindah ke baris utama dulu (isi dan nilainya), lalu hitungan
    // ditetapkan mutlak di baris utama: jumlah kunci ini = hitungan.
    const now = new Date();
    for (const k of kembar) {
      const q = toNum(k.qtyOnHand);
      const v = toNum(k.totalValue);
      await tx.inventoryValue.update({
        where: { id: k.id },
        data: { qtyOnHand: { decrement: q }, totalValue: { decrement: v }, lastUpdated: now },
      });
      await tx.inventoryValue.update({
        where: { id: inv.id },
        data: { qtyOnHand: { increment: q }, totalValue: { increment: v }, lastUpdated: now },
      });
    }
    const newTotalValue = newQty.mul(cost);

    // Computed here and passed straight into the ledger mover below as totalCost — this is the
    // figure the opname journal reads to post the inventory-variance GL entry.
    const totalCostAdj = delta.mul(cost).toNumber();

    /*
     * setMainStock, not moveMainStock: an opname line is an absolute physical count, and the
     * counted figure is what must land. Routed as a delta the row ends at prevActual + the
     * signed delta — which is NOT countedQty if anything moved between the read above and the
     * write — while the StockAdjustment row created just above records newQty: countedQty, so
     * the two disagree with nothing to reconcile them. The ledger type is wrong the same way:
     * ledgerTypeForDelta types a count IN or OUT, where every other count in this system writes
     * ADJUSTMENT, and the ledger is append-only so that spelling would be permanent.
     */
    await setMainStock(tx, {
      itemId: row.itemId,
      variantSku: variantKey,
      nextQty: newQty.toNumber(),
      ...(kembar.length > 0 ? { avgCost: cost.toNumber() } : {}),
      totalValue: newTotalValue.toNumber(),
      unitCost: cost.toNumber(),
      totalCost: totalCostAdj,
      balanceValue: newTotalValue.toNumber(),
      inventoryValueId: inv.id,
      refType: "StockOpname" satisfies StockLedgerRefType,
      refId: opnameId,
      refDocNumber: docNumber,
      createdById: userId,
    });

    await tx.stockMovement.create({
      data: {
        itemId: row.itemId,
        variantSku: variantKey,
        type: "ADJUSTMENT",
        refType: "OPNAME",
        refId: opnameId,
        refDocNumber: docNumber,
        qty: delta.toNumber(),
        unitCost: cost.toNumber(),
        totalCost: totalCostAdj,
        balanceQty: newQty.toNumber(),
        balanceValue: newTotalValue.toNumber(),
        notes: `Opname adjustment: ${docNumber}`,
      },
    });

    await tx.stockOpnameItem.updateMany({
      where: { id: { in: idKelompok } },
      data: { adjustmentId: adjustment.id },
    });

    adjustmentCount += 1;

    if (scope === "FINISHED_GOOD") {
      const mapping = await tx.jubelioProductMapping.findFirst({
        where: { itemId: row.itemId },
        select: { id: true },
      });
      if (mapping) pushItemIds.push(row.itemId);
    }
  }

  return { adjustmentCount, pushItemIds };
}

export async function applyFabricAdjustments(
  tx: Tx,
  opnameId: string,
  docNumber: string,
): Promise<{ adjustmentCount: number }> {
  const rolls = await tx.stockOpnameRoll.findMany({ where: { opnameId } });
  const itemIds = new Set<string>();
  let adjustmentCount = 0;

  for (const row of rolls) {
    /**
     * An uncounted roll is left as it is, like an uncounted line in a partial count. `toNum` would
     * read the null as 0 and close the roll. Submit already refuses a fabric opname with an
     * uncounted roll, so this only guards a caller that skips that check.
     */
    if (row.countedLength == null) continue;
    const countedLength = toNum(row.countedLength);
    const fabricRoll = await tx.fabricRoll.findUnique({
      where: { id: row.fabricRollId },
      select: { remainingLength: true, itemId: true, isClosed: true },
    });
    if (!fabricRoll) continue;

    const currentLength = toNum(fabricRoll.remainingLength);
    const snapshotLength = toNum(row.snapshotLength);
    if (!shouldApplyAdjustment(countedLength, currentLength)) continue;

    await tx.fabricRoll.update({
      where: { id: row.fabricRollId },
      data: {
        remainingLength: countedLength,
        /**
         * A count never reopens a closed roll. The only path that closes one mid-opname is a vendor
         * return, which already took the roll's length out of main stock, so reopening it would put
         * fabric that is back at the vendor on hand again.
         */
        isClosed: countedLength <= 0 ? true : fabricRoll.isClosed,
      },
    });

    itemIds.add(fabricRoll.itemId);
    adjustmentCount += 1;

    if (hasQtyDrift(currentLength, snapshotLength)) {
      // drift recorded implicitly via roll update
    }
  }

  for (const itemId of itemIds) {
    await syncFabricAggregateQty(tx, itemId, {
      refId: opnameId,
      refDocNumber: docNumber,
    });
  }

  return { adjustmentCount };
}

export async function pushFgStockAfterOpname(
  itemIds: string[],
  userId: string,
): Promise<void> {
  for (const itemId of [...new Set(itemIds)]) {
    try {
      await enqueueStockPush(itemId, userId);
    } catch {
      // local adjustment stands; outbox poller may retry on next manual push
    }
  }
}
