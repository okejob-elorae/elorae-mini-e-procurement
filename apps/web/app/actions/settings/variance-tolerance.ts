"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { requirePermission, PERMISSIONS } from "@/lib/rbac";
import {
  VARIANCE_TOLERANCE_SETTING_KEY,
  parseVarianceTolerance,
  validateVarianceToleranceInput,
} from "@/lib/finance/ar-settlement/variance-tolerance";

export async function getVarianceTolerance(): Promise<number> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  const row = await prisma.systemSetting.findUnique({
    where: { key: VARIANCE_TOLERANCE_SETTING_KEY },
    select: { value: true },
  });
  return parseVarianceTolerance(row?.value ?? null);
}

/**
 * Saves the settlement variance tolerance. The tolerance decides how large a cash gap finance may
 * approve without an override reason, so the write and its `AuditLog` row (who, the stored text
 * before, the stored text after) commit in one transaction — the gate never moves without a record
 * of who moved it. No upper bound is enforced: how large a tolerance is acceptable is a business
 * threshold, not a validation rule.
 */
export async function setVarianceTolerance(
  raw: string,
): Promise<{ ok: true; tolerance: number } | { ok: false; code: "EMPTY" | "INVALID" }> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.COLLECTIONS_MANAGE);

  const checked = validateVarianceToleranceInput(raw);
  if (!checked.ok) return checked;

  await prisma.$transaction(async (tx) => {
    const before = await tx.systemSetting.findUnique({
      where: { key: VARIANCE_TOLERANCE_SETTING_KEY },
      select: { value: true },
    });
    await tx.systemSetting.upsert({
      where: { key: VARIANCE_TOLERANCE_SETTING_KEY },
      create: { key: VARIANCE_TOLERANCE_SETTING_KEY, value: checked.value },
      update: { value: checked.value },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "SETTLEMENT_VARIANCE_TOLERANCE_UPDATE",
        entityType: "SystemSetting",
        entityId: VARIANCE_TOLERANCE_SETTING_KEY,
        changes: { before: { value: before?.value ?? null }, after: { value: checked.value } },
        reason: null,
      },
    });
  });
  revalidatePath("/backoffice/settings/piutang");
  return { ok: true, tolerance: parseVarianceTolerance(checked.value) };
}
