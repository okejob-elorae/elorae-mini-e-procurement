import type { Prisma } from "@elorae/db";
import {
  buildChainSnapshot,
  resolveChain,
} from "@/lib/leadtime/calculations";

type Tx = Prisma.TransactionClient | typeof import("@elorae/db").prisma;

/**
 * Build chain snapshot fields for a WO from vendor chain + plannedQty.
 * Returns null fields when vendor has no chain.
 */
export async function resolveWoLeadTimeFields(
  db: Tx,
  vendorId: string,
  plannedQty: number
): Promise<{
  chainSnapshot: object | null;
  chainTotalDays: number | null;
}> {
  const steps = await db.supplierProcess.findMany({
    where: { supplierId: vendorId },
    include: { processTemplate: true },
    orderBy: { sequence: "asc" },
  });

  if (steps.length === 0) {
    return { chainSnapshot: null, chainTotalDays: null };
  }

  const resolved = resolveChain(steps);
  const qty = plannedQty > 0 ? plannedQty : null;
  const { snapshot, totalDays } = buildChainSnapshot(resolved, qty);

  return {
    chainSnapshot: snapshot,
    chainTotalDays: totalDays,
  };
}
