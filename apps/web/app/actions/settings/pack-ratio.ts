"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { parsePackRatio, validatePackRatio, type PackRatioRow } from "@elorae/db/pack-ratio";
import { auth } from "@/lib/auth";
import { requirePermission, PERMISSIONS } from "@/lib/rbac";

const KEY = "putus.packRatio";

export async function getPackRatio(): Promise<PackRatioRow[]> {
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY }, select: { value: true } });
  return parsePackRatio(row?.value ?? null);
}

export async function setPackRatio(
  rows: PackRatioRow[],
): Promise<{ ok: true } | { ok: false; code: "EMPTY" | "BAD_SIZE" | "DUP_SIZE" | "BAD_QTY" }> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_PACK_RATIO_MANAGE);

  const validated = validatePackRatio(rows);
  if (!validated.ok) return { ok: false, code: validated.code };

  const value = JSON.stringify(validated.rows);
  await prisma.systemSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value },
    update: { value },
  });
  revalidatePath("/backoffice/settings/pack-ratio");
  return { ok: true };
}
