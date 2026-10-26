"use server";

import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { enqueueProductPushOnCreate } from "@/lib/jubelio/product-push";
import {
  jubelioCreateEligibility,
  type JubelioCreateEligibility,
} from "@/lib/items/jubelio-create-eligibility";

/* The item page's "Buat di Jubelio" button — for ERP finished goods that never reached Jubelio (e.g. imported with the Jubelio box unticked). */
export async function createItemInJubelio(
  itemId: string,
): Promise<{ ok: true } | { ok: false; reason: "forbidden" | Exclude<JubelioCreateEligibility, "eligible"> }> {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user.permissions, PERMISSIONS.ITEMS_EDIT)) {
    return { ok: false, reason: "forbidden" };
  }
  if (typeof itemId !== "string") return { ok: false, reason: "not_found" };
  const eligibility = await jubelioCreateEligibility(itemId);
  if (eligibility !== "eligible") return { ok: false, reason: eligibility };
  await enqueueProductPushOnCreate(itemId, session.user.id);
  return { ok: true };
}
