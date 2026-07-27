import { prisma } from "@elorae/db";
import type { SnapshotStep } from "@/lib/leadtime/calculations";
import { logAudit } from "@/lib/audit";

export type ChainDocType = "PO" | "WO";

export type ChainSignal =
  | { kind: "MATERIAL_ISSUE" }
  | { kind: "FG_PARTIAL" }
  | { kind: "FG_COMPLETE" };

function isProduction(step: SnapshotStep): boolean {
  return (
    step.type === "PER_QTY" || step.name.startsWith("PROSES PRODUKSI")
  );
}

function isShipping(step: SnapshotStep): boolean {
  return (
    step.name.startsWith("PENGIRIMAN") ||
    step.name.startsWith("PROSES PENGIRIMAN")
  );
}

/**
 * Resolve isApproval live by ProcessTemplate name; fallback ACC prefix.
 */
export async function resolveIsApprovalByNames(
  names: string[]
): Promise<Map<string, boolean>> {
  const unique = [...new Set(names)];
  if (unique.length === 0) return new Map();
  const rows = await prisma.processTemplate.findMany({
    where: { name: { in: unique } },
    select: { name: true, isApproval: true },
  });
  const map = new Map(rows.map((r) => [r.name, r.isApproval]));
  for (const name of unique) {
    if (!map.has(name)) {
      map.set(name, name.startsWith("ACC "));
    }
  }
  return map;
}

export async function resolveSopInstructionsByNames(
  names: string[]
): Promise<Map<string, string | null>> {
  const unique = [...new Set(names)];
  if (unique.length === 0) return new Map();
  const rows = await prisma.processTemplate.findMany({
    where: { name: { in: unique } },
    select: { name: true, sopInstructions: true },
  });
  return new Map(rows.map((r) => [r.name, r.sopInstructions]));
}

function findFirstMatching(
  snapshot: SnapshotStep[],
  fromIndex: number,
  pred: (s: SnapshotStep) => boolean
): number | null {
  for (let i = Math.max(0, fromIndex); i < snapshot.length; i++) {
    if (pred(snapshot[i])) return i;
  }
  return null;
}

function clampToApprovalBarrier(
  snapshot: SnapshotStep[],
  confirmedIndex: number | null,
  target: number,
  isApproval: Map<string, boolean>
): number {
  const start = (confirmedIndex ?? -1) + 1;
  for (let i = start; i <= target; i++) {
    const step = snapshot[i];
    if (!step) break;
    if (isApproval.get(step.name)) return i;
  }
  return target;
}

/**
 * Auto-advance confirmed chain position. Never moves backward.
 * Never crosses an unconfirmed approval step (parks AT it).
 * Call AFTER parent transaction commits; swallow errors at call site.
 */
export async function applyChainSignal(
  doc: { type: ChainDocType; id: string },
  signal: ChainSignal,
  userId?: string | null
): Promise<void> {
  if (doc.type === "PO") {
    // PO signals are terminal via GRN actualLeadDays; no position write.
    return;
  }

  const wo = await prisma.workOrder.findUnique({
    where: { id: doc.id },
    select: {
      id: true,
      status: true,
      chainSnapshot: true,
      chainConfirmedStepIndex: true,
      chainConfirmedSource: true,
    },
  });
  if (!wo?.chainSnapshot) return;
  if (
    wo.status === "DRAFT" ||
    wo.status === "CANCELLED" ||
    wo.status === "COMPLETED"
  ) {
    return;
  }

  const snapshot = wo.chainSnapshot as SnapshotStep[];
  if (!Array.isArray(snapshot) || snapshot.length === 0) return;

  const confirmedIndex = wo.chainConfirmedStepIndex;
  const from = (confirmedIndex ?? -1) + 1;
  let target: number | null = null;

  switch (signal.kind) {
    case "MATERIAL_ISSUE":
      target = findFirstMatching(snapshot, from, isProduction);
      break;
    case "FG_PARTIAL": {
      let lastProd = -1;
      for (let i = 0; i < snapshot.length; i++) {
        if (isProduction(snapshot[i])) lastProd = i;
      }
      const shipFrom = Math.max(from, lastProd + 1);
      target = findFirstMatching(snapshot, shipFrom, isShipping);
      break;
    }
    case "FG_COMPLETE":
      return;
    default: {
      const _exhaustive: never = signal;
      void _exhaustive;
      return;
    }
  }

  if (target == null) return;

  const approvalMap = await resolveIsApprovalByNames(
    snapshot.map((s) => s.name)
  );
  target = clampToApprovalBarrier(
    snapshot,
    confirmedIndex,
    target,
    approvalMap
  );

  if (
    wo.chainConfirmedSource === "MANUAL" &&
    confirmedIndex != null &&
    confirmedIndex >= target
  ) {
    return;
  }

  if (confirmedIndex != null && target <= confirmedIndex) {
    return;
  }

  await prisma.workOrder.update({
    where: { id: doc.id },
    data: {
      chainConfirmedStepIndex: target,
      chainConfirmedAt: new Date(),
      chainConfirmedSource: "AUTO",
    },
  });

  if (userId) {
    await logAudit({
      userId,
      action: "AUTO_CONFIRM_CHAIN",
      entityType: "WorkOrder",
      entityId: doc.id,
      changes: {
        after: { signal: signal.kind, target, stepName: snapshot[target]?.name },
      },
    });
  }
}
