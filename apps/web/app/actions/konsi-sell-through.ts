"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseDateOnly } from "@/lib/date-only";
import { postArJournalSafely } from "@/lib/finance/ar/post-ar-journal-safely";
import { isArJournalRetryable } from "@/lib/finance/ar/journal-pending";
import {
  createSellThrough,
  resolveSellThroughLine,
  approveSellThrough,
  cancelSellThrough,
  type ApproveSellThroughInput,
} from "@/lib/konsi-sell-through/writer";
import { SellThroughError, type SellThroughErrorCode } from "@/lib/konsi-sell-through/errors";
import { SELL_THROUGH_RESOLUTIONS, type SellThroughResolutionValue } from "@/lib/konsi-sell-through/derive";
import { SELL_THROUGH_JOURNAL_KINDS, SELL_THROUGH_JOURNAL_POSTERS, type SellThroughJournalKind } from "@/lib/konsi-sell-through/journal";

export type SellThroughActionReason = SellThroughErrorCode | "FORBIDDEN" | "INVALID_REQUEST" | "UNEXPECTED" | "NOT_RETRYABLE";

export type SellThroughActionFailure = { ok: false; reason: SellThroughActionReason; detail?: string };

export type SellThroughActionResult = { ok: true } | SellThroughActionFailure;

export type CreateSellThroughActionResult = { ok: true; id: string; docNo: string } | SellThroughActionFailure;

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
 * with `errors.ts`. `detail` travels with it because two screens read it: the retur docNos a
 * `RETUR_IN_FLIGHT` refusal names, and `REASON_TOO_LONG`, which gets its own copy instead of the
 * generic code's.
 */
function toResult(e: unknown): SellThroughActionFailure {
  if (e instanceof SellThroughError) return e.detail ? { ok: false, reason: e.code, detail: e.detail } : { ok: false, reason: e.code };
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
  if (typeof i.resolution !== "string" || !SELL_THROUGH_RESOLUTIONS.includes(i.resolution as SellThroughResolutionValue)) return false;
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

type ApproveRequest = Omit<ApproveSellThroughInput, "approvedById">;

function parseApproveRequest(input: unknown): ApproveRequest | null {
  if (typeof input !== "object" || input === null) return null;
  const i = input as Record<string, unknown>;
  if (typeof i.id !== "string" || i.id === "") return null;
  if (i.mode === "BASELINE") {
    if (typeof i.reason !== "string") return null;
    return { id: i.id, mode: "BASELINE", reason: i.reason };
  }
  if (i.mode === "INVOICE") {
    if (typeof i.invoiceDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(i.invoiceDate)) return null;
    const invoiceDate = parseDateOnly(i.invoiceDate);
    if (!invoiceDate) return null;
    if (i.salesmanId !== null && (typeof i.salesmanId !== "string" || i.salesmanId === "")) return null;
    return { id: i.id, mode: "INVOICE", invoiceDate, salesmanId: i.salesmanId as string | null };
  }
  return null;
}

/**
 * Posts every sell-through journal after the approve has committed. Each goes through
 * `postArJournalSafely`, so an unmapped account degrades to a JOURNAL_PENDING flag the report page
 * offers to retry, never a failed approve. `NOTHING_TO_POST` counts as posted on both the approve
 * path and the retry path — there is nothing left for that kind to post, so it is done either way.
 */
async function postSellThroughJournals(id: string, userId: string, kinds: readonly SellThroughJournalKind[]) {
  const posted: SellThroughJournalKind[] = [];
  const stillPending: SellThroughJournalKind[] = [];
  for (const kind of kinds) {
    const outcome = await postArJournalSafely(kind, id, () => SELL_THROUGH_JOURNAL_POSTERS[kind](id, userId));
    if (outcome.ok || outcome.code === "NOTHING_TO_POST") posted.push(kind);
    else stillPending.push(kind);
  }
  return { posted, stillPending };
}

export async function approveSellThroughAction(input: unknown): Promise<SellThroughActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  const req = parseApproveRequest(input);
  if (!req) return { ok: false, reason: "INVALID_REQUEST" };

  const doc = await prisma.konsiSellThrough.findUnique({ where: { id: req.id }, select: { closingStocktakeId: true } });

  try {
    const result = await approveSellThrough({ ...req, approvedById: g.userId });
    if (result.invoiced) await postSellThroughJournals(req.id, g.userId, SELL_THROUGH_JOURNAL_KINDS);
    if (doc) revalidateSellThrough(req.id, doc.closingStocktakeId);
    revalidatePath("/backoffice/finance/piutang");
    revalidatePath("/backoffice/finance/faktur-pajak");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export type RetrySellThroughJournalsResult =
  | { ok: true; posted: SellThroughJournalKind[]; stillPending: SellThroughJournalKind[] }
  | SellThroughActionFailure;

/**
 * Re-posts the sell-through journals a JOURNAL_PENDING flag says failed. The entry gate is the
 * flag, never a missing journal: a report whose journal simply has nothing to post has none by
 * construction. Success is read from `postArJournalSafely`'s outcome, not a re-check of the gate,
 * which reads "still pending" forever once a kind has failed once.
 */
export async function retrySellThroughJournalsAction(id: unknown): Promise<RetrySellThroughJournalsResult> {
  const g = await guard();
  if ("ok" in g) return g;
  if (typeof id !== "string" || id === "") return { ok: false, reason: "INVALID_REQUEST" };

  const retryable: SellThroughJournalKind[] = [];
  for (const kind of SELL_THROUGH_JOURNAL_KINDS) {
    if (await isArJournalRetryable(kind, id)) retryable.push(kind);
  }
  if (retryable.length === 0) return { ok: false, reason: "NOT_RETRYABLE" };

  const result = await postSellThroughJournals(id, g.userId, retryable);
  revalidatePath(`/backoffice/konsi-sell-through/${id}`);
  return { ok: true, ...result };
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
