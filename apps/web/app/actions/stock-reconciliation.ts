"use server";

import { revalidatePath } from "next/cache";
import { prisma, type ReconDirection, type ReconTrigger } from "@elorae/db";
import { auth } from "@/lib/auth";
import { requirePermission, PERMISSIONS } from "@/lib/rbac";
import {
  loadReconciliationConfig,
  resolveReconciliationItem as resolveItem,
  runReconciliation as runEngine,
  updateReconciliationSettings,
} from "@/lib/inventory/reconciliation-runner";

const RECON_PATH = "/backoffice/inventory/reconciliation";

export type SerializedReconciliationResult = {
  id: string;
  runId: string;
  itemId: string;
  variantSku: string | null;
  itemName: string;
  jubelioItemId: number | null;
  eloraeQty: number;
  jubelioQty: number;
  variance: number;
  action: string;
  resolvedAt: string | null;
  resolvedById: string | null;
  resolutionDirection: string | null;
};

export type SerializedReconciliationRun = {
  id: string;
  triggeredBy: string;
  status: string;
  totalScanned: number;
  inSync: number;
  autoCorrected: number;
  flagged: number;
  startedById: string | null;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
};

export type SerializedReconciliationRunDetail = SerializedReconciliationRun & {
  results: SerializedReconciliationResult[];
};

async function sessionUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user;
}

function serializeRow<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (v != null && typeof v === "object" && "toNumber" in (v as object)) {
      out[k] = Number(v);
    } else out[k] = v;
  }
  return out as T;
}

export async function runReconciliation(trigger: ReconTrigger = "MANUAL") {
  const user = await sessionUser();
  requirePermission(user.permissions ?? [], PERMISSIONS.INVENTORY_RECONCILIATION_MANAGE);

  const result = await runEngine(trigger, user.id);
  revalidatePath(RECON_PATH);
  return result;
}

export async function resolveReconciliationItem(data: {
  resultId: string;
  direction: ReconDirection;
}) {
  const user = await sessionUser();
  requirePermission(user.permissions ?? [], PERMISSIONS.INVENTORY_RECONCILIATION_MANAGE);
  const result = await resolveItem({
    resultId: data.resultId,
    direction: data.direction,
    userId: user.id,
  });
  revalidatePath(RECON_PATH);
  return result;
}

export async function getReconciliationRuns() {
  const user = await sessionUser();
  requirePermission(user.permissions ?? [], PERMISSIONS.INVENTORY_RECONCILIATION_VIEW);

  const rows = await prisma.reconciliationRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
  });
  return rows.map((r) => {
    const serialized = serializeRow(r as unknown as Record<string, unknown>);
    return serialized as unknown as SerializedReconciliationRun;
  });
}

export async function getReconciliationRunById(
  runId: string,
): Promise<SerializedReconciliationRunDetail | null> {
  const user = await sessionUser();
  requirePermission(user.permissions ?? [], PERMISSIONS.INVENTORY_RECONCILIATION_VIEW);

  const run = await prisma.reconciliationRun.findUnique({
    where: { id: runId },
    include: { results: { orderBy: { itemName: "asc" } } },
  });
  if (!run) return null;
  return {
    ...(serializeRow(run as unknown as Record<string, unknown>) as SerializedReconciliationRun),
    results: run.results.map(
      (r) => serializeRow(r as unknown as Record<string, unknown>) as SerializedReconciliationResult,
    ),
  };
}

export async function getReconciliationConfig() {
  const user = await sessionUser();
  requirePermission(user.permissions ?? [], PERMISSIONS.INVENTORY_RECONCILIATION_VIEW);
  return loadReconciliationConfig();
}

export async function updateReconciliationConfig(data: {
  threshold: number;
  direction: string;
  cronEnabled: boolean;
}) {
  const user = await sessionUser();
  requirePermission(user.permissions ?? [], PERMISSIONS.INVENTORY_RECONCILIATION_MANAGE);
  await updateReconciliationSettings(data.threshold, data.direction, data.cronEnabled);
  revalidatePath(RECON_PATH);
  return { success: true };
}

export async function runReconciliationCron() {
  return runEngine("CRON");
}
