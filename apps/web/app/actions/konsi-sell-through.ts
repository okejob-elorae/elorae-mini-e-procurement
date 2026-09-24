"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseDateOnly } from "@/lib/date-only";
import { postArJournalSafely } from "@/lib/finance/ar/post-ar-journal-safely";
import { variantDetailForSku } from "@/lib/items/variants";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import type { BuildKonsiSellThroughNotaOptions } from "@/lib/print/konsi-sell-through-nota-html";
import {
  createSellThrough,
  resolveSellThroughLine,
  approveSellThrough,
  cancelSellThrough,
  type ApproveSellThroughInput,
} from "@/lib/konsi-sell-through/writer";
import { SellThroughError, type SellThroughErrorCode } from "@/lib/konsi-sell-through/errors";
import { SELL_THROUGH_RESOLUTIONS, type SellThroughResolutionValue } from "@/lib/konsi-sell-through/derive";
import {
  SELL_THROUGH_JOURNAL_KINDS,
  SELL_THROUGH_JOURNAL_POSTERS,
  sellThroughJournalGaps,
  type SellThroughJournalKind,
} from "@/lib/konsi-sell-through/journal";
import { logPrint } from "./audit";

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

/* A plain `Omit` over a union keeps only the keys every member shares, so it would drop `reason`, `invoiceDate` and `salesmanId`. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type ApproveRequest = DistributiveOmit<ApproveSellThroughInput, "approvedById">;

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
 * `postArJournalSafely`, so an unmapped account degrades to a JOURNAL_PENDING flag and a journal
 * still missing, which the report page offers to retry, never a failed approve. `NOTHING_TO_POST`
 * counts as posted on both the approve path and the retry path — there is nothing left for that
 * kind to post, so it is done either way.
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
 * Posts the sell-through journals a report still owes. The entry gate is the missing journal
 * itself (`sellThroughJournalGaps`), not a JOURNAL_PENDING flag: a flag never clears, and a crash
 * between the approve commit and the posts leaves none at all. That gate is safe here because every
 * report approved before invoicing existed is a baseline, which owes nothing — unlike the delivery
 * sibling in `app/actions/field-sales-deliveries.ts`, whose backfilled receivables carry no journal
 * by construction and so must stay gated on the flag. Each post still goes through
 * `postArJournalSafely`, so a retry that fails again writes a flag like the first attempt did.
 */
export async function retrySellThroughJournalsAction(id: unknown): Promise<RetrySellThroughJournalsResult> {
  const g = await guard();
  if ("ok" in g) return g;
  if (typeof id !== "string" || id === "") return { ok: false, reason: "INVALID_REQUEST" };

  const owed = await sellThroughJournalGaps(id);
  if (owed.length === 0) return { ok: false, reason: "NOT_RETRYABLE" };

  const result = await postSellThroughJournals(id, g.userId, owed);
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

export type SellThroughNotaResult =
  | { ok: true; nota: Omit<BuildKonsiSellThroughNotaOptions, "labels"> }
  | SellThroughActionFailure;

/**
 * A nota tagihan only exists for an invoiced report — a baseline approval and a report that
 * billed nothing both leave `total` at null or zero, so `INVALID_STATE` covers both rather than
 * a dedicated code for each.
 */
export async function getSellThroughNotaAction(id: unknown): Promise<SellThroughNotaResult> {
  const g = await guard();
  if ("ok" in g) return g;
  if (typeof id !== "string" || id === "") return { ok: false, reason: "INVALID_REQUEST" };

  const report = await prisma.konsiSellThrough.findUnique({
    where: { id },
    select: {
      docNo: true,
      status: true,
      baseline: true,
      periodStart: true,
      periodEnd: true,
      invoiceDate: true,
      dueDate: true,
      total: true,
      store: { select: { name: true, address: true, npwp: true } },
      salesman: { select: { name: true } },
      lines: {
        where: { billedQty: { gt: 0 } },
        orderBy: { id: "asc" },
        select: {
          productName: true,
          variantSku: true,
          billedQty: true,
          unitPrice: true,
          lineTotal: true,
          item: { select: { variants: true } },
        },
      },
    },
  });
  if (!report) return { ok: false, reason: "NOT_FOUND" };
  if (report.status !== "APPROVED" || report.baseline || report.total === null || Number(report.total) <= 0) {
    return { ok: false, reason: "INVALID_STATE" };
  }

  return {
    ok: true,
    nota: {
      docNo: report.docNo,
      storeName: report.store.name,
      storeAddress: report.store.address,
      storeNpwp: report.store.npwp,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      invoiceDate: report.invoiceDate as Date,
      dueDate: report.dueDate as Date,
      salesmanName: report.salesman?.name ?? "",
      lines: report.lines.map((l) => ({
        productName: l.productName,
        variantLabel: variantDetailForSku(l.item.variants, l.variantSku),
        variantSku: l.variantSku,
        billedQty: Number(l.billedQty),
        unitPrice: Number(l.unitPrice),
        lineTotal: Number(l.lineTotal),
      })),
      total: Number(report.total),
    },
  };
}

/**
 * Stamps the first print of a konsi sell-through nota tagihan and pings finance that a faktur
 * pajak is now due — the sell-through counterpart of `recordNotaTagihanPrinted` in
 * `app/actions/field-sales-deliveries.ts`, same shape for the same reasons.
 *
 * Compare-and-swap, not read-then-write: a double-click on the print button would otherwise pass
 * a read-then-check twice before either write lands, notifying finance twice for the same
 * document. `updateMany`'s `count` says whether THIS call was the one that flipped
 * `notaPrintedAt` from null — 1 means it genuinely won the first print, 0 means somebody already
 * had (a reprint), which must audit but never notify again.
 *
 * Gated on `STORES_MANAGE` directly via `hasPermission` rather than this module's `guard()`
 * helper: `guard()` returns an error result, but this function returns void and must never
 * throw or resolve to anything a caller could branch on.
 *
 * The whole body is one try/catch returning void: the nota is already printed by the time this
 * runs, so a ping failure (or any other failure here) must never surface as a print failure.
 *
 * `logPrint` is wrapped in its OWN try/catch, separate from the outer one: it is the least
 * important write here, but it runs before the CAS, so an unguarded throw from it would abort
 * the whole function and leave `notaPrintedAt` null — vetoing both the stamp and the finance
 * notification because the audit trail hiccuped. Left in its current position (before the CAS)
 * on purpose, so a reprint still gets its own audit row; moving it after the early return would
 * silently stop reprints being audited at all.
 */
export async function recordSellThroughNotaPrinted(id: string): Promise<void> {
  try {
    const session = await auth();
    if (!session?.user?.id) return;
    if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE)) return;

    try {
      await logPrint("KonsiSellThroughNota", id);
    } catch (err) {
      console.error("[konsi-sell-through-nota-print] failed to write the print audit row", err);
    }

    const swapped = await prisma.taxInvoice.updateMany({
      where: { sellThroughId: id, notaPrintedAt: null },
      data: { notaPrintedAt: new Date(), notaPrintedById: session.user.id },
    });
    if (swapped.count !== 1) return;

    const report = await prisma.konsiSellThrough.findUnique({
      where: { id },
      select: { docNo: true, store: { select: { name: true } } },
    });
    if (!report) return;

    const storeName = report.store.name;
    const notification = await prisma.adminNotification.create({
      data: {
        category: "TAX_INVOICE_PENDING",
        severity: "INFO",
        title: `Nota ${report.docNo} sudah di-print`,
        message: `Nota ${report.docNo} untuk toko ${storeName} sudah di-print. Pastikan buat faktur pajak.`,
        metadata: { sellThroughId: id, docNo: report.docNo, storeName },
      },
    });

    void fanOutAdminNotification(notification);
  } catch (err) {
    /* Best-effort: the nota is already printed by the time this runs, so a ping must never fail a print. */
    console.error("[konsi-sell-through-nota-print] failed to record print", err);
  }
}
