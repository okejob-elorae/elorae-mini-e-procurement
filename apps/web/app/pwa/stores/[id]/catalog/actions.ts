"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createFieldSalesOrder } from "@/lib/field-sales/writer";
import { NoActiveVisitError, MinQtyViolationError } from "@/lib/field-sales/errors";

const schema = z.object({
  storeId: z.string().min(1),
  note: z.string().optional(),
  lines: z.array(z.object({
    itemId: z.string().min(1),
    variantSku: z.string(),
    productName: z.string().min(1),
    qty: z.number().int().positive(),
    unitPrice: z.number().nonnegative(),
  })).min(1),
});

export type SubmitResult =
  | { ok: true; orderNo: string }
  | { ok: false; code: "UNAUTHORIZED" | "EMPTY" | "NO_ACTIVE_VISIT" }
  | { ok: false; code: "MIN_QTY"; violations: Array<{ itemId: string; requiredMin: number; actualQty: number }> };

export async function submitFieldSalesOrder(input: {
  storeId: string;
  note?: string;
  lines: Array<{ itemId: string; variantSku: string; productName: string; qty: number; unitPrice: number }>;
}): Promise<SubmitResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "EMPTY" };

  try {
    const { orderNo } = await createFieldSalesOrder({
      storeId: parsed.data.storeId,
      salesmanId: session.user.id,
      note: parsed.data.note,
      lines: parsed.data.lines,
    });
    revalidatePath(`/pwa/stores/${parsed.data.storeId}`);
    return { ok: true, orderNo };
  } catch (e) {
    if (e instanceof NoActiveVisitError) return { ok: false, code: "NO_ACTIVE_VISIT" };
    if (e instanceof MinQtyViolationError) return { ok: false, code: "MIN_QTY", violations: e.violations };
    throw e;
  }
}
