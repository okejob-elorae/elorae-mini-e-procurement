"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@elorae/db";
import { applyItemAggregatedPromos } from "@/lib/field-sales/promo-apply";
import { auth } from "@/lib/auth";
import { createFieldSalesOrder } from "@/lib/field-sales/writer";
import { NoActiveVisitError, MinQtyViolationError } from "@/lib/field-sales/errors";
import { fetchActivePromosForStore } from "@/lib/promos/queries";

const schema = z.object({
  storeId: z.string().min(1),
  visitId: z.string().optional(),
  note: z.string().optional(),
  lines: z.array(z.object({
    itemId: z.string().min(1),
    variantSku: z.string(),
    productName: z.string().min(1),
    qty: z.number().int().positive(),
    unitPrice: z.number().nonnegative(),
  })).min(1),
  idempotencyKey: z.string().optional(),
});

export type SubmitResult =
  | { ok: true; orderNo: string }
  | { ok: false; code: "UNAUTHORIZED" | "EMPTY" | "NO_ACTIVE_VISIT" }
  | { ok: false; code: "MIN_QTY"; violations: Array<{ itemId: string; requiredMin: number; actualQty: number }> };

export async function submitFieldSalesOrder(input: {
  storeId: string;
  visitId?: string;
  note?: string;
  lines: Array<{ itemId: string; variantSku: string; productName: string; qty: number; unitPrice: number }>;
  idempotencyKey?: string;
}): Promise<SubmitResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "EMPTY" };

  try {
    const { orderNo } = await createFieldSalesOrder({
      storeId: parsed.data.storeId,
      salesmanId: session.user.id,
      visitId: parsed.data.visitId,
      note: parsed.data.note,
      lines: parsed.data.lines,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    revalidatePath(`/pwa/stores/${parsed.data.storeId}`);
    return { ok: true, orderNo };
  } catch (e) {
    if (e instanceof NoActiveVisitError) return { ok: false, code: "NO_ACTIVE_VISIT" };
    if (e instanceof MinQtyViolationError) return { ok: false, code: "MIN_QTY", violations: e.violations };
    throw e;
  }
}

export type PromoPreviewResult = { lineDiscounts: number[]; orderDiscount: number; netTotal: number };

// Read-only compute (no persist) so the salesman sees the discounted quote before Kirim.
// Reuses the same computeOrderPromos engine as createFieldSalesOrder's honor-at-create promo block.
export async function previewFieldSalesPromos(input: {
  storeId: string;
  lines: Array<{ itemId: string; qty: number; unitPrice: number }>;
}): Promise<PromoPreviewResult> {
  const gross = input.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const zeros: PromoPreviewResult = { lineDiscounts: input.lines.map(() => 0), orderDiscount: 0, netTotal: gross };

  const session = await auth();
  if (!session?.user?.id) return zeros;
  if (input.lines.length === 0) return zeros;

  const store = await prisma.store.findUnique({ where: { id: input.storeId }, select: { termsType: true } });
  if (!store || store.termsType === "KONSI") return zeros;

  const itemIds = Array.from(new Set(input.lines.map((l) => l.itemId)));
  const invRows = await prisma.inventoryValue.findMany({
    where: { itemId: { in: itemIds } },
    select: { itemId: true, avgCost: true },
  });
  const avgCostById = new Map<string, number>();
  for (const row of invRows) {
    if (!avgCostById.has(row.itemId)) avgCostById.set(row.itemId, Number(row.avgCost));
  }

  const activePromos = await fetchActivePromosForStore(input.storeId, new Date());
  // Per-item aggregate + pro-rate — SAME helper as createFieldSalesOrder so the quote == the recorded order.
  const applied = applyItemAggregatedPromos(
    input.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitPrice: l.unitPrice, avgCost: avgCostById.get(l.itemId) ?? 0 })),
    activePromos,
  );
  const lineDiscounts = applied.lineDiscounts;
  const orderDiscount = applied.orderDiscountAmount;
  const netTotal = gross - lineDiscounts.reduce((s, d) => s + d, 0) - orderDiscount;

  return { lineDiscounts, orderDiscount, netTotal };
}
