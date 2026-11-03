"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { requirePermission, PERMISSIONS } from "@/lib/rbac";
import {
  OVERDUE_THRESHOLD_SETTING_KEY,
  parseOverdueThresholds,
} from "@/lib/finance/ar/overdue-thresholds";

/*
 * The page, both actions and its Settings hub card share ONE permission, `receivables:manage`
 * (owner decision Q14, 2026-11-02: the thresholds are set by "Kelola piutang" holders). RECEIVING
 * the reminder is a separate permission, `receivables:overdue_reminder` (P48), which opens nothing
 * here.
 */
export async function getOverdueThresholds(): Promise<number[]> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.RECEIVABLES_MANAGE);

  const row = await prisma.systemSetting.findUnique({
    where: { key: OVERDUE_THRESHOLD_SETTING_KEY },
    select: { value: true },
  });
  return parseOverdueThresholds(row?.value ?? null);
}

export async function setOverdueThresholds(
  raw: string,
): Promise<{ ok: true; thresholds: number[] } | { ok: false; code: "EMPTY" | "INVALID" }> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.RECEIVABLES_MANAGE);

  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, code: "EMPTY" };

  const parts = trimmed.split(",").map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length === 0 || !parts.every((p) => /^\d+$/.test(p))) {
    return { ok: false, code: "INVALID" };
  }

  await prisma.$transaction(async (tx) => {
    const before = await tx.systemSetting.findUnique({
      where: { key: OVERDUE_THRESHOLD_SETTING_KEY },
      select: { value: true },
    });
    await tx.systemSetting.upsert({
      where: { key: OVERDUE_THRESHOLD_SETTING_KEY },
      create: { key: OVERDUE_THRESHOLD_SETTING_KEY, value: trimmed },
      update: { value: trimmed },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "AR_OVERDUE_THRESHOLDS_UPDATE",
        entityType: "SystemSetting",
        entityId: OVERDUE_THRESHOLD_SETTING_KEY,
        changes: { before: { value: before?.value ?? null }, after: { value: trimmed } },
        reason: null,
      },
    });
  });
  revalidatePath("/backoffice/settings/piutang");
  return { ok: true, thresholds: parseOverdueThresholds(trimmed) };
}
