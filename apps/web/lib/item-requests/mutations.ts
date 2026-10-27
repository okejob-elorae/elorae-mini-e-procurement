import { prisma, type Prisma } from "@elorae/db";
import { generateDocNumber } from "@/lib/docNumber";
import { createPurchaseOrder } from "@/lib/purchase-orders/mutations";
import { getWoShortages } from "./shortage";
import { deriveRequestStatus } from "./status";

/** A refusal the user can act on; its message is shown as-is. */
export class ItemRequestError extends Error {}

async function refreshHeaders(tx: Prisma.TransactionClient, requestIds: string[]) {
  for (const id of new Set(requestIds)) {
    const lines = await tx.itemRequestLine.findMany({ where: { requestId: id }, select: { status: true } });
    await tx.itemRequest.update({ where: { id }, data: { status: deriveRequestStatus(lines.map((l) => l.status)) } });
  }
}

/**
 * One request per DRAFT WO with a BOM shortage, a line per short material. Idempotent: while an
 * OPEN request for the WO exists it is returned instead of a second one.
 */
export async function createRequestFromWo(woId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    // Serializes a double click: the second caller sees the first one's request.
    await tx.$queryRaw`SELECT \`id\` FROM \`WorkOrder\` WHERE \`id\` = ${woId} FOR UPDATE`;
    const wo = await tx.workOrder.findUnique({
      where: { id: woId },
      select: { docNumber: true, status: true, finishedGoodId: true, plannedQty: true, outputMode: true, skuBreakdown: true, targetDate: true },
    });
    if (!wo) throw new ItemRequestError("Work Order tidak ditemukan");
    if (wo.status !== "DRAFT") throw new ItemRequestError("Request Item hanya bisa dibuat dari WO berstatus DRAFT");

    const existing = await tx.itemRequest.findFirst({
      where: { sourceWoId: woId, status: "OPEN" },
      select: { id: true, docNumber: true },
    });
    if (existing) return { ...existing, created: false };

    const shortages = await getWoShortages(wo);
    if (shortages.length === 0) throw new ItemRequestError("Tidak ada kekurangan bahan untuk WO ini");

    const docNumber = await generateDocNumber("ITEMREQ", tx);
    const request = await tx.itemRequest.create({
      data: {
        docNumber,
        sourceWoId: woId,
        neededBy: wo.targetDate,
        notes: `Kekurangan bahan ${wo.docNumber}`,
        createdById: userId,
        lines: { create: shortages.map((s) => ({ itemId: s.itemId, qty: s.shortage, uomId: s.uomId })) },
      },
      select: { id: true, docNumber: true },
    });
    return { ...request, created: true };
  });
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
      // Claim first: a line another user converts or cancels meanwhile fails the count check.
      const claimed = await tx.itemRequestLine.updateMany({
        where: { id: { in: lineIds }, status: "OPEN" },
        data: { status: "CONVERTED" },
      });
      if (claimed.count !== lineIds.length) throw new ItemRequestError("Sebagian baris sudah diproses, muat ulang halaman");

      const lines = await tx.itemRequestLine.findMany({
        where: { id: { in: lineIds } },
        select: { id: true, requestId: true, itemId: true, variantSku: true, qty: true, uomId: true, request: { select: { docNumber: true } } },
        orderBy: { createdAt: "asc" },
      });
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
