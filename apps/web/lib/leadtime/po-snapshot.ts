import type { Prisma } from "@elorae/db";
import {
  buildChainSnapshot,
  resolveChain,
  suggestEta,
  sumPcsQty,
} from "@/lib/leadtime/calculations";

type Tx = Prisma.TransactionClient;

type LineInput = {
  itemId: string;
  qty: number;
  uomId?: string;
};

/**
 * Build chain snapshot fields for a PO from supplier chain + line items.
 * Returns null fields when supplier has no chain.
 */
export async function resolvePoLeadTimeFields(
  tx: Tx,
  supplierId: string,
  lines: LineInput[],
  existingEta: Date | null | undefined
): Promise<{
  chainSnapshot: object | null;
  chainTotalDays: number | null;
  etaDate: Date | null | undefined;
}> {
  const steps = await tx.supplierProcess.findMany({
    where: { supplierId },
    include: { processTemplate: true },
    orderBy: { sequence: "asc" },
  });

  if (steps.length === 0) {
    return {
      chainSnapshot: null,
      chainTotalDays: null,
      etaDate: existingEta,
    };
  }

  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const items = await tx.item.findMany({
    where: { id: { in: itemIds } },
    select: {
      id: true,
      type: true,
      uomId: true,
      uom: { select: { code: true } },
    },
  });
  const itemById = new Map(items.map((i) => [i.id, i]));

  const uomIds = [
    ...new Set(
      lines.map((l) => l.uomId).filter((id): id is string => Boolean(id))
    ),
  ];
  const uoms =
    uomIds.length > 0
      ? await tx.uOM.findMany({
          where: { id: { in: uomIds } },
          select: { id: true, code: true },
        })
      : [];
  const uomById = new Map(uoms.map((u) => [u.id, u.code]));

  const pcsQty = sumPcsQty(
    lines.map((line) => {
      const item = itemById.get(line.itemId);
      const uomCode =
        (line.uomId ? uomById.get(line.uomId) : undefined) ??
        item?.uom.code ??
        null;
      return {
        qty: line.qty,
        uomCode,
        itemType: item?.type ?? null,
      };
    })
  );

  const resolved = resolveChain(steps);
  const { snapshot, totalDays } = buildChainSnapshot(
    resolved,
    pcsQty > 0 ? pcsQty : null
  );

  let etaDate = existingEta;
  if (etaDate == null && totalDays > 0) {
    etaDate = suggestEta(new Date(), totalDays);
  }

  return {
    chainSnapshot: snapshot,
    chainTotalDays: totalDays,
    etaDate,
  };
}
