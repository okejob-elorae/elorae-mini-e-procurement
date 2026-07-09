"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { recordVanSale } from "@/lib/canvassing/sale-writer";

export type RecordVanSaleActionResult =
  | { ok: true; saleId: string; docNo: string; changeAmount: number }
  | { ok: false; reason: "UNAUTHORIZED" | "EMPTY" | "NO_PRICE" | "INSUFFICIENT_PAYMENT" | "INSUFFICIENT_VAN_STOCK" | "VALIDATION"; shortLines?: Array<{ itemId: string; variantSku: string | null; requested: number; available: number }> };

const schema = z.object({
  storeId: z.string().nullable(),
  buyerName: z.string().max(191).nullable(),
  buyerPhone: z.string().max(64).nullable(),
  saleLat: z.number().min(-90).max(90).nullable(),
  saleLng: z.number().min(-180).max(180).nullable(),
  amountPaid: z.number().min(0),
  note: z.string().max(500).optional(),
  idempotencyKey: z.string().min(1),
  lines: z.array(z.object({ itemId: z.string().min(1), variantSku: z.string().nullable(), qty: z.number().positive() })).min(1),
});

export async function recordVanSaleAction(input: unknown): Promise<RecordVanSaleActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "VALIDATION" };
  const session = await auth();
  if (!session?.user?.id) return { ok: false, reason: "UNAUTHORIZED" };
  const d = parsed.data;
  const res = await recordVanSale({
    salesmanId: session.user.id, storeId: d.storeId, buyerName: d.buyerName, buyerPhone: d.buyerPhone,
    saleLat: d.saleLat, saleLng: d.saleLng, lines: d.lines, amountPaid: d.amountPaid, note: d.note, idempotencyKey: d.idempotencyKey,
  });
  if (res.ok) return { ok: true, saleId: res.saleId, docNo: res.docNo, changeAmount: res.changeAmount };
  if (res.code === "INSUFFICIENT_VAN_STOCK") return { ok: false, reason: "INSUFFICIENT_VAN_STOCK", shortLines: res.shortLines };
  return { ok: false, reason: res.code };
}
