import { prisma } from "@elorae/db";
import { apiFetch, extractApiMessage } from "@/lib/internal-api";
import { collectResyncTargets } from "./resync-targets";

export type StartResyncResult =
  | { ok: true; batchId: string; seeded: number }
  | { ok: false; code: "NOT_FOUND" | "NO_TARGETS" | "API_ERROR"; message?: string };

/**
 * Seeds a Jubelio resync batch for everything the settlement still needs and stamps it on the row.
 * `resyncRematchedAt` is cleared so the rematch sweep picks the new batch up; a batch replaced by a
 * later press keeps running harmlessly, because the sweep only ever reads the stamped one.
 */
export async function startSettlementResync(
  settlementId: string,
  userId: string,
): Promise<StartResyncResult> {
  const exists = await prisma.settlement.findUnique({ where: { id: settlementId }, select: { id: true } });
  if (!exists) return { ok: false, code: "NOT_FOUND" };

  const salesorderNos = await collectResyncTargets(settlementId);
  if (salesorderNos.length === 0) return { ok: false, code: "NO_TARGETS" };

  const r = await apiFetch<{ batchId: string; seeded: number }>("POST", "/jubelio/salesorders/resync", {
    userId,
    body: { salesorderNos },
  });
  if (!r.ok || !r.data) {
    return {
      ok: false,
      code: "API_ERROR",
      message: extractApiMessage(r.error, `Resync trigger failed (${r.status})`),
    };
  }

  await prisma.settlement.update({
    where: { id: settlementId },
    data: { resyncBatchId: r.data.batchId, resyncSeededAt: new Date(), resyncRematchedAt: null },
  });
  return { ok: true, batchId: r.data.batchId, seeded: r.data.seeded };
}
