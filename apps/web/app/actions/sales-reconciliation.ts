"use server";

import { SalesChannel } from "@elorae/db";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";
import { loadReconciliationReport } from "@/lib/sales/load-reconciliation-report";
import type { ReconciliationReport } from "@/lib/sales/sales-reconciliation";

async function requireForecastView() {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.FORECAST_VIEW);
  return session;
}

export async function runSalesReconciliation(input: {
  channel: SalesChannel;
  periodMonth: number;
  periodYear: number;
}): Promise<{ success: boolean; report?: ReconciliationReport; error?: string }> {
  try {
    await requireForecastView();
    const report = await loadReconciliationReport(input);
    return { success: true, report };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Reconciliation failed",
    };
  }
}

export async function getReconciliationPeriods(): Promise<
  Array<{ channel: SalesChannel; periodMonth: number; periodYear: number }>
> {
  await requireForecastView();
  const imports = await prisma.salesHistoryImport.findMany({
    orderBy: [
      { periodYear: "desc" },
      { periodMonth: "desc" },
      { channel: "asc" },
    ],
    select: { channel: true, periodMonth: true, periodYear: true },
  });
  return imports;
}
