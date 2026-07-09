"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { loadVan } from "@/lib/canvassing/writer";

export type LoadVanActionResult =
  | { ok: true; docNo: string }
  | { ok: false; reason: "FORBIDDEN" | "EMPTY" | "INSUFFICIENT_STOCK" | "VALIDATION"; shortLines?: Array<{ itemId: string; variantSku: string | null; requested: number; available: number }> };

const schema = z.object({
  canvasserId: z.string().min(1),
  note: z.string().max(500).optional(),
  lines: z.array(z.object({
    itemId: z.string().min(1),
    variantSku: z.string().nullable(),
    qty: z.number().positive(),
  })).min(1),
});

export async function loadVanAction(input: {
  canvasserId: string;
  lines: Array<{ itemId: string; variantSku: string | null; qty: number }>;
  note?: string;
}): Promise<LoadVanActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "VALIDATION" };
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.CANVASSING_MANAGE)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  const res = await loadVan({ canvasserId: parsed.data.canvasserId, loadedById: session.user.id, lines: parsed.data.lines, note: parsed.data.note });
  if (!res.ok) {
    if (res.code === "INSUFFICIENT_STOCK") return { ok: false, reason: "INSUFFICIENT_STOCK", shortLines: res.shortLines };
    return { ok: false, reason: "EMPTY" };
  }
  revalidatePath("/backoffice/canvassing");
  revalidatePath(`/backoffice/canvassing/${parsed.data.canvasserId}`);
  return { ok: true, docNo: res.docNo };
}
