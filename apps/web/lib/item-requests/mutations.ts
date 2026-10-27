import { prisma, type Prisma } from "@elorae/db";
import { generateDocNumber } from "@/lib/docNumber";
import { createPurchaseOrder } from "@/lib/purchase-orders/mutations";
import { getWoShortages, type WoShortage } from "./shortage";
import { deriveRequestStatus } from "./status";

/** A refusal the user can act on; its message is shown as-is. */
export class ItemRequestError extends Error {}

async function refreshHeaders(tx: Prisma.TransactionClient, requestIds: string[]) {
  for (const id of new Set(requestIds)) {
    const lines = await tx.itemRequestLine.findMany({ where: { requestId: id }, select: { status: true } });
    await tx.itemRequest.update({ where: { id }, data: { status: deriveRequestStatus(lines.map((l) => l.status)) } });
  }
}

type Db = Pick<Prisma.TransactionClient, "itemRequestLine" | "pOItem">;

/** PO statuses that still have goods on the way. */
const INBOUND_PO_STATUSES = ["DRAFT", "SUBMITTED", "PARTIAL"] as const;

/**
 * The WO's live shortage less what its converted request lines still have on order. A DRAFT PO
 * adds no stock, so without this netting every shortage already bought for would be requested again.
 */
export async function getUncoveredShortages(db: Db, woId: string, shortages: WoShortage[]): Promise<WoShortage[]> {
  if (shortages.length === 0) return [];
  const converted = await db.itemRequestLine.findMany({
    where: { status: "CONVERTED", request: { sourceWoId: woId }, po: { status: { in: [...INBOUND_PO_STATUSES] } } },
    select: { itemId: true, variantSku: true, qty: true, poId: true },
  });
  // Grouped per PO and SKU, not per linked item: a PO edit may merge, split or cut same-SKU lines.
  const key = (poId: string | null, itemId: string, variantSku: string | null) => `${poId}|${itemId}|${variantSku ?? ""}`;
  const requested = new Map<string, { itemId: string; qty: number }>();
  for (const l of converted) {
    const k = key(l.poId, l.itemId, l.variantSku);
    requested.set(k, { itemId: l.itemId, qty: (requested.get(k)?.qty ?? 0) + Number(l.qty) });
  }
  const poIds = [...new Set(converted.map((l) => l.poId).filter((id): id is string => !!id))];
  const stillComing = new Map<string, number>();
  if (poIds.length > 0) {
    const poItems = await db.pOItem.findMany({
      where: { poId: { in: poIds } },
      select: { poId: true, itemId: true, variantSku: true, qty: true, receivedQty: true },
    });
    // Received qty is already on hand, so it is in the live shortage; only the rest is still coming.
    for (const i of poItems) {
      const k = key(i.poId, i.itemId, i.variantSku);
      stillComing.set(k, (stillComing.get(k) ?? 0) + Math.max(0, Number(i.qty) - Number(i.receivedQty)));
    }
  }
  const inbound = new Map<string, number>();
  for (const [k, r] of requested) {
    // This WO counts no more than it asked for, nor more than the PO still brings for that SKU.
    const outstanding = Math.min(r.qty, stillComing.get(k) ?? 0);
    inbound.set(r.itemId, (inbound.get(r.itemId) ?? 0) + outstanding);
  }
  return shortages
    .map((s) => ({ ...s, shortage: Math.round((s.shortage - (inbound.get(s.itemId) ?? 0)) * 100) / 100 }))
    .filter((s) => s.shortage > 0);
}

/** Makes an OPEN request's OPEN lines match the gap: resize, add, or cancel the ones no longer short. */
async function syncOpenLines(tx: Prisma.TransactionClient, requestId: string, gap: WoShortage[]) {
  const open = await tx.itemRequestLine.findMany({
    where: { requestId, status: "OPEN" },
    select: { id: true, itemId: true, qty: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const byItem = new Map(gap.map((g) => [g.itemId, g]));
  for (const line of open) {
    const g = byItem.get(line.itemId);
    if (!g) {
      await tx.itemRequestLine.update({ where: { id: line.id }, data: { status: "CANCELLED" } });
      continue;
    }
    byItem.delete(line.itemId);
    if (Number(line.qty) !== g.shortage) await tx.itemRequestLine.update({ where: { id: line.id }, data: { qty: g.shortage } });
  }
  for (const g of byItem.values()) {
    await tx.itemRequestLine.create({ data: { requestId, itemId: g.itemId, qty: g.shortage, uomId: g.uomId } });
  }
  await refreshHeaders(tx, [requestId]);
}

const woSelect = {
  docNumber: true,
  status: true,
  finishedGoodId: true,
  plannedQty: true,
  outputMode: true,
  skuBreakdown: true,
  targetDate: true,
} as const;

async function lockWo(tx: Prisma.TransactionClient, woId: string) {
  await tx.$queryRaw`SELECT \`id\` FROM \`WorkOrder\` WHERE \`id\` = ${woId} FOR UPDATE`;
}

/**
 * Keeps one OPEN request per DRAFT WO, sized to the uncovered gap: the oldest OPEN request is
 * synced, and OPEN lines on any later one are cancelled so purchasing never sees the gap twice.
 */
async function normalizeWoRequests(tx: Prisma.TransactionClient, woId: string) {
  await lockWo(tx, woId);
  const wo = await tx.workOrder.findUnique({ where: { id: woId }, select: woSelect });
  if (!wo || wo.status !== "DRAFT") return;
  const open = await tx.itemRequest.findMany({
    where: { sourceWoId: woId, status: "OPEN" },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (open.length === 0) return;
  const [keeper, ...extra] = open;
  if (extra.length > 0) {
    const extraIds = extra.map((r) => r.id);
    await tx.itemRequestLine.updateMany({ where: { requestId: { in: extraIds }, status: "OPEN" }, data: { status: "CANCELLED" } });
    await refreshHeaders(tx, extraIds);
  }
  await syncOpenLines(tx, keeper.id, await getUncoveredShortages(tx, woId, await getWoShortages(wo)));
}

/**
 * Puts CONVERTED lines whose PO no longer carries them back in the purchasing queue: OPEN for a
 * DRAFT WO or a request without one, CANCELLED when the WO moved on. Then re-establishes one
 * OPEN request per affected WO.
 */
async function releaseLines(tx: Prisma.TransactionClient, where: Prisma.ItemRequestLineWhereInput) {
  const lines = await tx.itemRequestLine.findMany({
    where: { ...where, status: "CONVERTED" },
    select: { id: true, requestId: true, request: { select: { sourceWoId: true, sourceWo: { select: { status: true } } } } },
  });
  if (lines.length === 0) return;
  for (const l of lines) {
    const reopen = !l.request.sourceWoId || l.request.sourceWo?.status === "DRAFT";
    await tx.itemRequestLine.update({
      where: { id: l.id },
      data: { status: reopen ? "OPEN" : "CANCELLED", poId: null, poItemId: null },
    });
  }
  await refreshHeaders(tx, lines.map((l) => l.requestId));
  const woIds = [...new Set(lines.map((l) => l.request.sourceWoId).filter((id): id is string => !!id))].sort();
  for (const woId of woIds) await normalizeWoRequests(tx, woId);
}

/**
 * One request per DRAFT WO with a BOM shortage, a line per short material not already on order.
 * Idempotent: an OPEN request for the WO is brought up to date and returned instead of a second one.
 */
export async function createRequestFromWo(woId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    // Serializes a double click: the second caller sees the first one's request.
    await lockWo(tx, woId);
    const wo = await tx.workOrder.findUnique({ where: { id: woId }, select: woSelect });
    if (!wo) throw new ItemRequestError("Work Order tidak ditemukan");
    if (wo.status !== "DRAFT") throw new ItemRequestError("Request Item hanya bisa dibuat dari WO berstatus DRAFT");

    const gap = await getUncoveredShortages(tx, woId, await getWoShortages(wo));
    const existing = await tx.itemRequest.findFirst({
      where: { sourceWoId: woId, status: "OPEN" },
      select: { id: true, docNumber: true },
    });
    if (existing) {
      await syncOpenLines(tx, existing.id, gap);
      return { ...existing, created: false };
    }
    if (gap.length === 0) throw new ItemRequestError("Tidak ada kekurangan bahan yang belum dipesan untuk WO ini");

    const docNumber = await generateDocNumber("ITEMREQ", tx);
    const request = await tx.itemRequest.create({
      data: {
        docNumber,
        sourceWoId: woId,
        neededBy: wo.targetDate,
        notes: `Kekurangan bahan ${wo.docNumber}`,
        createdById: userId,
        lines: { create: gap.map((s) => ({ itemId: s.itemId, qty: s.shortage, uomId: s.uomId })) },
      },
      select: { id: true, docNumber: true },
    });
    return { ...request, created: true };
  });
}

/** After a WO edit: brings its OPEN request's lines in line with the new plan. No request, no-op. */
export async function syncRequestForWo(woId: string) {
  await prisma.$transaction((tx) => normalizeWoRequests(tx, woId));
}

/**
 * A cancelled WO needs nothing bought: its OPEN request lines are cancelled with it. Call after
 * locking the WO row, the lock convert takes, so a conversion in flight finishes first.
 */
export async function cancelOpenLinesForWo(tx: Prisma.TransactionClient, woId: string) {
  const open = await tx.itemRequestLine.findMany({
    where: { status: "OPEN", request: { sourceWoId: woId } },
    select: { id: true, requestId: true },
  });
  if (open.length === 0) return;
  await tx.itemRequestLine.updateMany({ where: { id: { in: open.map((l) => l.id) } }, data: { status: "CANCELLED" } });
  await refreshHeaders(tx, open.map((l) => l.requestId));
}

/** A voided PO returns its request lines to the purchasing queue. Callers only void POs with no receipts. */
export async function releaseLinesOfCancelledPo(tx: Prisma.TransactionClient, poId: string) {
  await releaseLines(tx, { poId });
}

/** `updatePO` replaces every PO item; call before it deletes them, so the unique link is free. */
export async function unlinkPoItems(tx: Prisma.TransactionClient, poId: string) {
  await tx.itemRequestLine.updateMany({ where: { poId }, data: { poItemId: null } });
}

/**
 * After `updatePO` recreated the items: each linked line takes the first unused item of the same
 * SKU. A line whose SKU the edit removed from the PO is released back to the purchasing queue; one
 * whose SKU is still there but merged into a sibling's item stays CONVERTED on the PO, unlinked.
 */
export async function relinkPoItems(tx: Prisma.TransactionClient, poId: string) {
  const lines = await tx.itemRequestLine.findMany({
    where: { poId },
    select: { id: true, itemId: true, variantSku: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (lines.length === 0) return;
  const items = await tx.pOItem.findMany({ where: { poId }, select: { id: true, itemId: true, variantSku: true } });
  const sameSku = (i: (typeof items)[number], line: (typeof lines)[number]) =>
    i.itemId === line.itemId && (i.variantSku ?? "") === line.variantSku;
  const unused = [...items];
  const dropped: string[] = [];
  for (const line of lines) {
    const at = unused.findIndex((i) => sameSku(i, line));
    if (at < 0) {
      if (!items.some((i) => sameSku(i, line))) dropped.push(line.id);
      continue;
    }
    await tx.itemRequestLine.update({ where: { id: line.id }, data: { poItemId: unused.splice(at, 1)[0].id } });
  }
  if (dropped.length > 0) await releaseLines(tx, { id: { in: dropped } });
}

export async function cancelRequestLines(lineIds: string[]) {
  if (lineIds.length === 0) throw new ItemRequestError("Pilih baris yang akan dibatalkan");
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.itemRequestLine.updateMany({
      where: { id: { in: lineIds }, status: "OPEN" },
      data: { status: "CANCELLED" },
    });
    if (claimed.count !== lineIds.length) throw new ItemRequestError("Sebagian baris sudah diproses, muat ulang halaman");
    const lines = await tx.itemRequestLine.findMany({ where: { id: { in: lineIds } }, select: { requestId: true } });
    await refreshHeaders(tx, lines.map((l) => l.requestId));
  });
}

export type ConvertInput = {
  lineIds: string[];
  supplierId: string;
  /** Price per line id. */
  prices: Record<string, number>;
  etaDate?: Date | null;
};

/** Turns OPEN request lines into one DRAFT purchase order and links each line to its PO item. */
export async function convertLinesToPo(input: ConvertInput, userId: string) {
  const lineIds = [...new Set(input.lineIds)];
  if (lineIds.length === 0) throw new ItemRequestError("Pilih baris yang akan dibuat PO");

  return prisma.$transaction(
    async (tx) => {
      // Lock the source WOs first (the lock cancelWorkOrder takes), in id order so two
      // conversions cannot deadlock. A WO cancelled meanwhile has already cancelled its OPEN lines.
      const sources = await tx.itemRequestLine.findMany({
        where: { id: { in: lineIds } },
        select: { request: { select: { sourceWoId: true } } },
      });
      const woIds = [...new Set(sources.map((l) => l.request.sourceWoId).filter((id): id is string => !!id))].sort();
      for (const woId of woIds) await lockWo(tx, woId);

      // Claim first: a line another user converts or cancels meanwhile fails the count check.
      const claimed = await tx.itemRequestLine.updateMany({
        where: { id: { in: lineIds }, status: "OPEN" },
        data: { status: "CONVERTED" },
      });
      if (claimed.count !== lineIds.length) throw new ItemRequestError("Sebagian baris sudah diproses, muat ulang halaman");

      const lines = await tx.itemRequestLine.findMany({
        where: { id: { in: lineIds } },
        select: {
          id: true,
          requestId: true,
          itemId: true,
          variantSku: true,
          qty: true,
          uomId: true,
          request: { select: { docNumber: true, sourceWo: { select: { docNumber: true, status: true } } } },
        },
        orderBy: { createdAt: "asc" },
      });
      // Same rule as createRequestFromWo: only a DRAFT WO is still waiting on material.
      const movedOn = lines.find((l) => l.request.sourceWo && l.request.sourceWo.status !== "DRAFT")?.request.sourceWo;
      if (movedOn) throw new ItemRequestError(`${movedOn.docNumber} sudah tidak berstatus DRAFT, batalkan baris request-nya`);
      const po = await createPurchaseOrder(
        {
          supplierId: input.supplierId,
          etaDate: input.etaDate ?? undefined,
          notes: `Dari ${[...new Set(lines.map((l) => l.request.docNumber))].join(", ")}`,
          items: lines.map((l) => ({
            itemId: l.itemId,
            variantSku: l.variantSku || undefined,
            qty: Number(l.qty),
            price: input.prices[l.id] ?? 0,
            ppnIncluded: true,
            uomId: l.uomId,
            notes: l.request.docNumber,
          })),
        },
        userId,
        { tx }
      );

      // Identical lines are interchangeable, so each request line takes the first unused PO item that matches it.
      const unused = [...po.items];
      for (const line of lines) {
        const at = unused.findIndex(
          (i) => i.itemId === line.itemId && (i.variantSku ?? "") === line.variantSku && Number(i.qty) === Number(line.qty)
        );
        const poItem = at >= 0 ? unused.splice(at, 1)[0] : null;
        await tx.itemRequestLine.update({ where: { id: line.id }, data: { poId: po.id, poItemId: poItem?.id ?? null } });
      }
      await refreshHeaders(tx, lines.map((l) => l.requestId));
      return { id: po.id, docNumber: po.docNumber };
    },
    { timeout: 20_000 }
  );
}
