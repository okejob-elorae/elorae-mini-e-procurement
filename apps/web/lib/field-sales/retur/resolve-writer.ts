import { runSerializable } from "@/lib/db/tx-retry";
import { FieldReturnError } from "./errors";

type ResolutionType = "SALESMAN_BEARS" | "INVESTIGATE" | "WRITE_OFF" | "ACCEPT_SURPLUS";

const SETTLING = new Set(["SALESMAN_BEARS", "WRITE_OFF", "ACCEPT_SURPLUS"]);

/**
 * Liability is recorded in units, never money — a resolution says who bears the piece count
 * discrepancy, not what it is worth.
 */
export function lineVariance(claimedQty: number, receivedQty: number | null): number {
  if (receivedQty === null) return 0;
  return receivedQty - claimedQty;
}

/**
 * INVESTIGATE is deliberately NOT settling. The card lists it as one of three resolution
 * options, but its own wording is "hold for re-check with store" — it records that someone is
 * going to look, and settles nothing. A line on that path keeps the retur in
 * MISMATCH_PENDING_RESOLUTION indefinitely, by design.
 */
export function isSettled(type: string | null): boolean {
  return type !== null && SETTLING.has(type);
}

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
}): Promise<{ ok: true; returnStatus: "MISMATCH_PENDING_RESOLUTION" | "PENDING_APPROVAL" }> {
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

    const allDiscrepantLinesSettled = siblingLines.every((l) => {
      if (lineVariance(l.qty, l.receivedQty) === 0) return true;
      return isSettled(l.resolutions[0]?.type ?? null);
    });

    const returnStatus = allDiscrepantLinesSettled ? "PENDING_APPROVAL" : "MISMATCH_PENDING_RESOLUTION";
    await tx.fieldReturn.update({
      where: { id: line.returnId },
      data: { status: returnStatus },
    });

    return { ok: true as const, returnStatus };
  });
}
