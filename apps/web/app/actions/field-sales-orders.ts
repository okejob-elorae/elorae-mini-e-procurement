"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { approveFieldSalesOrder, rejectFieldSalesOrder } from "@/lib/field-sales/writer";
import { createKonsiPushOrder, type CreateKonsiPushOrderInput, type KonsiPushLine } from "@/lib/field-sales/konsi-push-writer";
import {
  InvalidOrderTransitionError,
  InsufficientStockError,
  InvalidAddedLineError,
  CreditLimitExceededError,
  KonsiPushError,
  type InvalidAddedLineCode,
  type ShortLine,
  type KonsiPushErrorCode,
} from "@/lib/field-sales/errors";

export type ActionResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "INVALID_TRANSITION"
        | "INSUFFICIENT_STOCK"
        | "INVALID_FINAL_PRICE"
        | "INVALID_ADDED_LINE"
        | "CREDIT_LIMIT_EXCEEDED";
      /* Only ever present on INSUFFICIENT_STOCK. Optional because rejectFieldSalesOrderAction shares this type. */
      shortLines?: ShortLine[];
      /* Only ever present on INVALID_ADDED_LINE. */
      addedLineCode?: InvalidAddedLineCode;
      /* Only ever present on CREDIT_LIMIT_EXCEEDED. */
      credit?: {
        exposure: { receivableOutstanding: number; undeliveredOrderResidual: number; total: number };
        creditLimit: number;
        orderTotal: number;
      };
    };

function isValidFinalPrices(finalPrices: unknown): finalPrices is Array<{ lineId: string; finalUnitPrice: number }> {
  if (finalPrices === undefined) return true;
  if (!Array.isArray(finalPrices)) return false;
  return finalPrices.every(
    (f) =>
      typeof f === "object" &&
      f !== null &&
      typeof (f as { lineId?: unknown }).lineId === "string" &&
      (f as { lineId: string }).lineId.trim() !== "" &&
      Number.isFinite((f as { finalUnitPrice?: unknown }).finalUnitPrice) &&
      (f as { finalUnitPrice: number }).finalUnitPrice >= 0,
  );
}

function isValidAddedLines(
  addedLines: unknown,
): addedLines is Array<{ itemId: string; variantSku: string; qty: number }> {
  if (addedLines === undefined) return true;
  if (!Array.isArray(addedLines)) return false;
  return addedLines.every(
    (a) =>
      typeof a === "object" &&
      a !== null &&
      typeof (a as { itemId?: unknown }).itemId === "string" &&
      (a as { itemId: string }).itemId.trim() !== "" &&
      typeof (a as { variantSku?: unknown }).variantSku === "string" &&
      Number.isInteger((a as { qty?: unknown }).qty) &&
      (a as { qty: number }).qty > 0,
  );
}

async function guard(): Promise<{ userId: string } | { ok: false; reason: "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  return { userId: session.user.id };
}

export async function approveFieldSalesOrderAction(
  orderId: string,
  finalPrices?: Array<{ lineId: string; finalUnitPrice: number }>,
  addedLines?: Array<{ itemId: string; variantSku: string; qty: number }>,
  creditOverrideReason?: string,
): Promise<ActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  if (!isValidFinalPrices(finalPrices)) return { ok: false, reason: "INVALID_FINAL_PRICE" };
  if (!isValidAddedLines(addedLines)) return { ok: false, reason: "INVALID_ADDED_LINE" };
  if (creditOverrideReason && creditOverrideReason.trim()) {
    const session = await auth();
    if (!hasPermission(session?.user?.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_CREDIT_OVERRIDE)) {
      return { ok: false, reason: "FORBIDDEN" };
    }
  }
  try {
    await approveFieldSalesOrder({ orderId, approvedById: g.userId, finalPrices, addedLines, creditOverrideReason });
  } catch (e) {
    if (e instanceof CreditLimitExceededError) {
      return {
        ok: false,
        reason: "CREDIT_LIMIT_EXCEEDED",
        credit: { exposure: e.exposure, creditLimit: e.creditLimit, orderTotal: e.orderTotal },
      };
    }
    if (e instanceof InsufficientStockError) {
      return { ok: false, reason: "INSUFFICIENT_STOCK", shortLines: e.shortLines };
    }
    if (e instanceof InvalidAddedLineError) {
      return { ok: false, reason: "INVALID_ADDED_LINE", addedLineCode: e.code };
    }
    if (e instanceof InvalidOrderTransitionError) {
      return { ok: false, reason: e.from === "MISSING" ? "NOT_FOUND" : "INVALID_TRANSITION" };
    }
    throw e;
  }
  revalidatePath("/backoffice/field-sales-orders");
  revalidatePath(`/backoffice/field-sales-orders/${orderId}`);
  return { ok: true };
}

/* The line qty column is a 32-bit Int; a value above this overflows it at the database. */
const MAX_INT32 = 2147483647;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

export type CreateKonsiPushOrderInputWithoutActor = Omit<CreateKonsiPushOrderInput, "pushedById">;

export type KonsiPushActionResult =
  | { ok: true; orderId: string; orderNo: string }
  | {
      ok: false;
      reason: KonsiPushErrorCode | "INSUFFICIENT_STOCK" | "FORBIDDEN" | "INVALID_REQUEST" | "UNEXPECTED";
      /* Only ever present on a KonsiPushError code that carries one. */
      detail?: string;
      /* Only ever present on INSUFFICIENT_STOCK. */
      shortLines?: ShortLine[];
    };

function parseKonsiPushInput(input: unknown): CreateKonsiPushOrderInputWithoutActor | null {
  if (typeof input !== "object" || input === null) return null;
  const req = input as Record<string, unknown>;
  if (!isNonEmptyString(req.storeId)) return null;
  if (!isNonEmptyString(req.salesmanId)) return null;
  if (!isNonEmptyString(req.idempotencyKey) || !UUID_SHAPE.test(req.idempotencyKey)) return null;
  if (req.note !== undefined && typeof req.note !== "string") return null;
  if (!Array.isArray(req.lines)) return null;

  const lines: KonsiPushLine[] = [];
  for (const raw of req.lines) {
    if (typeof raw !== "object" || raw === null) return null;
    const line = raw as Record<string, unknown>;
    if (!isNonEmptyString(line.itemId)) return null;
    if (typeof line.variantSku !== "string") return null;
    if (!Number.isInteger(line.qty) || (line.qty as number) > MAX_INT32) return null;
    lines.push({ itemId: line.itemId, variantSku: line.variantSku, qty: line.qty as number });
  }

  return {
    storeId: req.storeId,
    salesmanId: req.salesmanId,
    idempotencyKey: req.idempotencyKey,
    note: req.note as string | undefined,
    lines,
  };
}

export async function createKonsiPushOrderAction(input: unknown): Promise<KonsiPushActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  const req = parseKonsiPushInput(input);
  if (!req) return { ok: false, reason: "INVALID_REQUEST" };
  try {
    const result = await createKonsiPushOrder({ ...req, pushedById: g.userId });
    revalidatePath(`/backoffice/stores/${req.storeId}`);
    revalidatePath("/backoffice/field-sales-orders");
    revalidatePath(`/backoffice/field-sales-orders/${result.orderId}`);
    return { ok: true, ...result };
  } catch (e) {
    if (e instanceof KonsiPushError) return e.detail ? { ok: false, reason: e.code, detail: e.detail } : { ok: false, reason: e.code };
    if (e instanceof InsufficientStockError) return { ok: false, reason: "INSUFFICIENT_STOCK", shortLines: e.shortLines };
    console.error("[konsi-push] unexpected failure", e);
    return { ok: false, reason: "UNEXPECTED" };
  }
}

export async function rejectFieldSalesOrderAction(orderId: string, reason: string): Promise<ActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  try {
    await rejectFieldSalesOrder({ orderId, rejectedById: g.userId, reason: reason.trim() || undefined });
  } catch (e) {
    if (e instanceof InvalidOrderTransitionError) {
      return { ok: false, reason: e.from === "MISSING" ? "NOT_FOUND" : "INVALID_TRANSITION" };
    }
    throw e;
  }
  revalidatePath("/backoffice/field-sales-orders");
  revalidatePath(`/backoffice/field-sales-orders/${orderId}`);
  return { ok: true };
}
