"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@elorae/db";
import { computeStorePrice } from "@elorae/db/pricing";
import { auth } from "@/lib/auth";
import { createFieldSalesOrder } from "@/lib/field-sales/writer";
import { NoActiveVisitError, MinQtyViolationError } from "@/lib/field-sales/errors";
import { getPackRatio } from "@/app/actions/settings/pack-ratio";
import { getSmartRequestHistory } from "@/lib/field-sales/queries";
import { loadSmartRequestCandidates } from "@/lib/field-sales/smart-request/load-candidates";
import { planSmartRequest, type PlanCategoryInput, type CategoryUnderfill } from "@/lib/field-sales/smart-request/plan";
import { variantDetailForSku } from "@/lib/items/variants";
import type { SubmitResult } from "@/app/pwa/stores/[id]/catalog/actions";

export type SmartRequestLine = {
  itemId: string;
  variantSku: string;
  variantLabel: string;
  size: string;
  productName: string;
  qty: number;
  unitPrice: number;
};
export type SmartRequestDrop = { categoryId: string; itemId: string; sku: string; reason: string; detail?: string };
export type BuildSmartRequestResult =
  | { ok: true; lines: SmartRequestLine[]; dropped: SmartRequestDrop[]; underfill: CategoryUnderfill[] }
  | { ok: false; code: "UNAUTHORIZED" | "NO_RATIO" | "EMPTY" };

const buildSchema = z.object({
  storeId: z.string().min(1),
  categories: z.array(z.object({ categoryId: z.string().min(1), packs: z.number().int().positive() })).min(1),
});

export async function buildSmartRequestAction(input: unknown): Promise<BuildSmartRequestResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  const parsed = buildSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "EMPTY" };

  const ratio = await getPackRatio();
  if (ratio.length === 0) return { ok: false, code: "NO_RATIO" };

  const categoryIds = parsed.data.categories.map((c) => c.categoryId);
  const candidatesByCat = await loadSmartRequestCandidates(categoryIds);
  const allItemIds = Array.from(candidatesByCat.values()).flat().map((c) => c.itemId);
  const history = await getSmartRequestHistory(parsed.data.storeId, allItemIds);

  const planInput: PlanCategoryInput[] = parsed.data.categories.map((c) => ({
    categoryId: c.categoryId,
    packs: c.packs,
    candidates: candidatesByCat.get(c.categoryId) ?? [],
  }));
  const plan = planSmartRequest(planInput, history, ratio);

  // Enrich for display: product name, variant label, putus unit price.
  const itemIds = Array.from(new Set(plan.lines.map((l) => l.itemId)));
  const items = await prisma.item.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, nameId: true, sellingPrice: true, variants: true },
  });
  const store = await prisma.store.findUnique({ where: { id: parsed.data.storeId }, select: { termsType: true, marginPercent: true } });
  const margin = store?.marginPercent == null ? null : Number(store.marginPercent);
  const itemById = new Map(items.map((i) => [i.id, i]));

  const lines: SmartRequestLine[] = plan.lines.map((l) => {
    const it = itemById.get(l.itemId);
    const sellingPrice = it?.sellingPrice == null ? null : Number(it.sellingPrice);
    const unitPrice = computeStorePrice({ sellingPrice, termsType: "PUTUS", marginPercent: margin }).price ?? 0;
    return {
      itemId: l.itemId,
      variantSku: l.variantSku,
      variantLabel: variantDetailForSku(it?.variants, l.variantSku) ?? l.size,
      size: l.size,
      productName: it?.nameId ?? "—",
      qty: l.qty,
      unitPrice,
    };
  });

  const dropped: SmartRequestDrop[] = plan.dropped.map((d) => ({ categoryId: d.categoryId, itemId: d.itemId, sku: d.sku, reason: d.reason, detail: d.detail }));
  return { ok: true, lines, dropped, underfill: plan.underfill };
}

const submitSchema = z.object({
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

export async function submitSmartRequestOrder(input: unknown): Promise<SubmitResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "EMPTY" };
  try {
    const { orderNo } = await createFieldSalesOrder({
      storeId: parsed.data.storeId,
      salesmanId: session.user.id,
      visitId: parsed.data.visitId,
      note: parsed.data.note,
      lines: parsed.data.lines,
      idempotencyKey: parsed.data.idempotencyKey,
      skipMinQty: true,
    });
    revalidatePath(`/pwa/stores/${parsed.data.storeId}`);
    return { ok: true, orderNo };
  } catch (e) {
    if (e instanceof NoActiveVisitError) return { ok: false, code: "NO_ACTIVE_VISIT" };
    if (e instanceof MinQtyViolationError) return { ok: false, code: "MIN_QTY", violations: e.violations };
    throw e;
  }
}
