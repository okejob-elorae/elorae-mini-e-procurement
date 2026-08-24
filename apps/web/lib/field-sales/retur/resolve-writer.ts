import { runSerializable } from "@/lib/db/tx-retry";
import { FieldReturnError } from "./errors";
import { lineVariance, allDiscrepantLinesSettled, isValidResolutionDirection } from "./variance";

type ResolutionType = "SALESMAN_BEARS" | "INVESTIGATE" | "WRITE_OFF" | "ACCEPT_SURPLUS";

/**
 * Resolutions are append-only (decision D5): a resolution stays correctable by appending a new
 * one, right up until the retur is approved. So this accepts a parent in EITHER
 * MISMATCH_PENDING_RESOLUTION or PENDING_APPROVAL, and recomputes the parent status in BOTH
 * directions after appending — an amendment that unsettles a line must drop the retur back out
 * of the approval queue, not just settle it further in.
 */
export async function resolveFieldReturnLine(input: {
  lineId: string;
  type: ResolutionType;
  note?: string | null;
  createdById: string;
}): Promise<{ ok: true; returnId: string; returnStatus: "MISMATCH_PENDING_RESOLUTION" | "PENDING_APPROVAL" }> {
  return runSerializable(async (tx) => {
    const line = await tx.fieldReturnLine.findUnique({
      where: { id: input.lineId },
      select: {
        id: true,
        qty: true,
        receivedQty: true,
        returnId: true,
        returnDoc: { select: { status: true } },
      },
    });
    if (!line) throw new FieldReturnError("NOT_FOUND");
    if (line.returnDoc.status !== "MISMATCH_PENDING_RESOLUTION" && line.returnDoc.status !== "PENDING_APPROVAL") {
      throw new FieldReturnError("INVALID_STATE");
    }

    const variance = lineVariance(line.qty, line.receivedQty);
    if (variance === 0) throw new FieldReturnError("NO_VARIANCE");

    /*
     * Direction is enforced here, not just in the client's SHORTAGE_TYPES/SURPLUS_TYPES —
     * every export of a "use server" module is an independently callable endpoint, so a caller
     * that skips the UI (or a user without field_returns:writeoff reaching for ACCEPT_SURPLUS
     * instead of the write-off option the UI withheld) must not be able to settle a shortage
     * line as a surplus or vice versa.
     */
    if (!isValidResolutionDirection(input.type, variance)) {
      throw new FieldReturnError("RESOLUTION_DIRECTION_MISMATCH");
    }

    await tx.fieldReturnResolution.create({
      data: {
        lineId: line.id,
        type: input.type,
        qty: Math.abs(variance),
        note: input.note ?? null,
        createdById: input.createdById,
      },
    });

    const siblingLines = await tx.fieldReturnLine.findMany({
      where: { returnId: line.returnId },
      select: {
        qty: true,
        receivedQty: true,
        resolutions: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { type: true },
        },
      },
    });

    const returnStatus = allDiscrepantLinesSettled(siblingLines) ? "PENDING_APPROVAL" : "MISMATCH_PENDING_RESOLUTION";
    await tx.fieldReturn.update({
      where: { id: line.returnId },
      data: { status: returnStatus },
    });

    return { ok: true as const, returnId: line.returnId, returnStatus };
  });
}
