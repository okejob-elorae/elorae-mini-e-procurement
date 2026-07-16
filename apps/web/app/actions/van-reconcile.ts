"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { recordVanReconcile } from "@/lib/canvassing/reconcile-writer";

export type RecordVanReconcileActionResult =
  | { ok: true; docNo: string; totalReturned: number; totalVarianceQty: number }
  | { ok: false; reason: "FORBIDDEN" | "EMPTY_VAN" | "VARIANCE_NEEDS_REASON" | "COUNT_MISMATCH" | "VALIDATION" };

const schema = z.object({
  canvasserId: z.string().min(1),
  note: z.string().max(500).optional(),
  counts: z.array(z.object({ itemId: z.string().min(1), variantSku: z.string().nullable(), countedQty: z.number().min(0) })).min(1),
});

export async function recordVanReconcileAction(input: unknown): Promise<RecordVanReconcileActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "VALIDATION" };
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.CANVASSING_MANAGE)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  const res = await recordVanReconcile({ canvasserId: parsed.data.canvasserId, reconciledById: session.user.id, counts: parsed.data.counts, note: parsed.data.note });
  if (res.ok) {
    revalidatePath("/backoffice/canvassing");
    revalidatePath(`/backoffice/canvassing/${parsed.data.canvasserId}`);
    return { ok: true, docNo: res.docNo, totalReturned: res.totalReturned, totalVarianceQty: res.totalVarianceQty };
  }
  return { ok: false, reason: res.code };
}
