"use server";

import { z } from "zod";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { recordSpgSale } from "@/lib/spg/sale-writer";

export type RecordSpgSaleActionResult =
  | { ok: true; spgSaleId: string; docNo: string; changeGiven: number }
  | { ok: false; code: "FORBIDDEN" | "NO_ASSIGNED_STORE" | "EMPTY" | "STORE_NOT_FOUND" | "NO_PRICE" | "INSUFFICIENT_PAYMENT" | "VALIDATION" };

// storeId is NOT taken from the client — it's derived server-side from the SPG's
// fixed `assignedStoreId`, so an SPG can only ever record a sale at their own store.
const schema = z.object({
  cashReceived: z.number().min(0).optional(),
  saleLat: z.number().min(-90).max(90).nullable().optional(),
  saleLng: z.number().min(-180).max(180).nullable().optional(),
  note: z.string().max(500).optional(),
  idempotencyKey: z.string().min(1),
  lines: z.array(z.object({ itemId: z.string().min(1), variantSku: z.string().nullable(), qty: z.number().int().positive() })).min(1),
});

export async function recordSpgSaleAction(input: unknown): Promise<RecordSpgSaleActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_RECORD)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  // Authoritative store = the SPG's assigned store; never trust a client-supplied id.
  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { assignedStoreId: true } });
  if (!me?.assignedStoreId) return { ok: false, code: "NO_ASSIGNED_STORE" };
  const d = parsed.data;
  const res = await recordSpgSale({
    salesmanId: session.user.id,
    storeId: me.assignedStoreId,
    lines: d.lines,
    cashReceived: d.cashReceived,
    saleLat: d.saleLat ?? null,
    saleLng: d.saleLng ?? null,
    note: d.note,
    idempotencyKey: d.idempotencyKey,
  });
  if (res.ok) return { ok: true, spgSaleId: res.spgSaleId, docNo: res.docNo, changeGiven: res.changeGiven };
  return { ok: false, code: res.code };
}
