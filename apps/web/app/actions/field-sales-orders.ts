"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { approveFieldSalesOrder, rejectFieldSalesOrder } from "@/lib/field-sales/writer";
import {
  InvalidOrderTransitionError,
  InsufficientStockError,
  InvalidAddedLineError,
  type InvalidAddedLineCode,
  type ShortLine,
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
        | "INVALID_ADDED_LINE";
      /* Only ever present on INSUFFICIENT_STOCK. Optional because rejectFieldSalesOrderAction shares this type. */
      shortLines?: ShortLine[];
      /* Only ever present on INVALID_ADDED_LINE. */
      addedLineCode?: InvalidAddedLineCode;
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
): Promise<ActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  if (!isValidFinalPrices(finalPrices)) return { ok: false, reason: "INVALID_FINAL_PRICE" };
  if (!isValidAddedLines(addedLines)) return { ok: false, reason: "INVALID_ADDED_LINE" };
  try {
    await approveFieldSalesOrder({ orderId, approvedById: g.userId, finalPrices, addedLines });
  } catch (e) {
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
