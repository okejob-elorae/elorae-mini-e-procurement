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

export async function setVarianceTolerance(
  raw: string,
): Promise<{ ok: true; tolerance: number } | { ok: false; code: "EMPTY" | "INVALID" }> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.COLLECTIONS_MANAGE);

  const checked = validateVarianceToleranceInput(raw);
  if (!checked.ok) return checked;

  await prisma.systemSetting.upsert({
    where: { key: VARIANCE_TOLERANCE_SETTING_KEY },
    create: { key: VARIANCE_TOLERANCE_SETTING_KEY, value: checked.value },
    update: { value: checked.value },
  });
  revalidatePath("/backoffice/settings/piutang");
  return { ok: true, tolerance: parseVarianceTolerance(checked.value) };
}
