"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  createSellThrough,
  resolveSellThroughLine,
  approveSellThrough,
  cancelSellThrough,
} from "@/lib/konsi-sell-through/writer";
import { SellThroughError, type SellThroughErrorCode } from "@/lib/konsi-sell-through/errors";
import type { SellThroughResolutionValue } from "@/lib/konsi-sell-through/derive";

const RESOLUTIONS: readonly SellThroughResolutionValue[] = ["BILL", "SHRINKAGE", "BILL_POS", "REDUCE"];

export type SellThroughActionReason = SellThroughErrorCode | "FORBIDDEN" | "INVALID_REQUEST" | "UNEXPECTED";

export type SellThroughActionResult = { ok: true } | { ok: false; reason: SellThroughActionReason };

export type CreateSellThroughActionResult =
  | { ok: true; id: string; docNo: string }
  | { ok: false; reason: SellThroughActionReason };

/**
 * A single ADMIN-facing gate for every write in this module — reads are gated on `stores:view`
 * in the backoffice pages themselves, never here, since this file exports no read action.
 */
async function guard(): Promise<{ userId: string } | { ok: false; reason: "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  return { userId: session.user.id };
}

/**
 * `SellThroughError.code` already reads as a stable, screen-facing reason on its own, so it is
 * passed straight through — same shape as `toResult` in `app/actions/store-settlements.ts` —
 * rather than keeping a second `Record<SellThroughErrorCode, …>` map that could drift out of sync
 * with `errors.ts`.
 */
function toResult(e: unknown): { ok: false; reason: SellThroughActionReason } {
  if (e instanceof SellThroughError) return { ok: false, reason: e.code };
  console.error("[konsi-sell-through] unexpected failure", e);
  return { ok: false, reason: "UNEXPECTED" };
}

function revalidateSellThrough(id: string, closingStocktakeId: string): void {
  revalidatePath("/backoffice/konsi-sell-through");
  revalidatePath(`/backoffice/konsi-sell-through/${id}`);
  revalidatePath(`/backoffice/store-stocktakes/${closingStocktakeId}`);
}

export async function createSellThroughAction(stocktakeId: unknown): Promise<CreateSellThroughActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  if (typeof stocktakeId !== "string" || stocktakeId === "") return { ok: false, reason: "INVALID_REQUEST" };

  try {
    const result = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: g.userId });
    revalidateSellThrough(result.id, stocktakeId);
    return { ok: true, id: result.id, docNo: result.docNo };
  } catch (e) {
    return toResult(e);
  }
}

function isValidResolveInput(
  input: unknown,
): input is { lineId: string; resolution: SellThroughResolutionValue; reason: string | null } {
  if (typeof input !== "object" || input === null) return false;
  const i = input as Record<string, unknown>;
  if (typeof i.lineId !== "string" || i.lineId === "") return false;
  if (typeof i.resolution !== "string" || !RESOLUTIONS.includes(i.resolution as SellThroughResolutionValue)) return false;
  if (i.reason !== null && typeof i.reason !== "string") return false;
  return true;
}

export async function resolveSellThroughLineAction(input: unknown): Promise<SellThroughActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  if (!isValidResolveInput(input)) return { ok: false, reason: "INVALID_REQUEST" };

  /**
   * Read BEFORE the writer runs only to learn which report/stocktake to revalidate — a missing
   * line still reaches `resolveSellThroughLine`, which throws the real `NOT_FOUND`, mapped by
   * `toResult` below; this lookup returning `null` just skips the revalidation calls.
   */
  const line = await prisma.konsiSellThroughLine.findUnique({
    where: { id: input.lineId },
    select: { sellThroughId: true, sellThrough: { select: { closingStocktakeId: true } } },
  });

  try {
    await resolveSellThroughLine({ lineId: input.lineId, resolution: input.resolution, reason: input.reason, userId: g.userId });
    if (line) revalidateSellThrough(line.sellThroughId, line.sellThrough.closingStocktakeId);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export async function approveSellThroughAction(id: unknown): Promise<SellThroughActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  if (typeof id !== "string" || id === "") return { ok: false, reason: "INVALID_REQUEST" };

  const doc = await prisma.konsiSellThrough.findUnique({ where: { id }, select: { closingStocktakeId: true } });

  try {
    await approveSellThrough({ id, approvedById: g.userId });
    if (doc) revalidateSellThrough(id, doc.closingStocktakeId);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export async function cancelSellThroughAction(id: unknown, reason: unknown): Promise<SellThroughActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  if (typeof id !== "string" || id === "") return { ok: false, reason: "INVALID_REQUEST" };
  if (typeof reason !== "string") return { ok: false, reason: "INVALID_REQUEST" };

  const doc = await prisma.konsiSellThrough.findUnique({ where: { id }, select: { closingStocktakeId: true } });

  try {
    await cancelSellThrough({ id, cancelledById: g.userId, reason });
    if (doc) revalidateSellThrough(id, doc.closingStocktakeId);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}
