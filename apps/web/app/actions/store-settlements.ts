"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { submitSettlement } from "@/lib/finance/ar-settlement/submit-writer";
import { approveSettlement, type ApproveSettlementResult } from "@/lib/finance/ar-settlement/approve-writer";
import { rejectSettlement } from "@/lib/finance/ar-settlement/reject-writer";
import { SettlementError, type SettlementErrorCode } from "@/lib/finance/ar-settlement/errors";
import { PaymentError, type PaymentErrorCode } from "@/lib/finance/ar/errors";
import { postArJournalSafely } from "@/lib/finance/ar/post-ar-journal-safely";
import { postPaymentReceiptJournal } from "@/lib/finance/ar/payment-journal";

/**
 * Named `store-settlements.ts`, not `settlements.ts` — that path already exists and belongs to
 * the marketplace settlement module (`lib/finance/settlement/match` + `journal`). Colliding with
 * it would break a shipped money path.
 */
const DRAFT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StoreSettlementDeductionInput =
  | { type: "RETUR_OFFSET"; amount: number; fieldReturnId: string }
  | { type: "PROGRAM"; amount: number; proofUrl: string; proofR2Key: string; note?: string }
  | { type: "ADMIN_FEE"; percent: number; proofUrl: string; proofR2Key: string };

export type SubmitStoreSettlementInput = {
  draftId: string;
  storeId: string;
  invoices: Array<{ receivableId: string; amount: number }>;
  deductions: StoreSettlementDeductionInput[];
  actualAmount: number;
  note?: string;
};

/**
 * `SettlementErrorCode` already reads as a stable, screen-facing reason on its own — every
 * member names exactly what went wrong. Passing `e.code` straight through below (the same shape
 * `toCollectionResult` uses in `app/actions/collections.ts`) means there is no second
 * `Record<SettlementErrorCode, …>` map to keep exhaustive against `errors.ts`'s 26-member union,
 * and therefore nothing that can silently drift out of sync with it the way this repo's
 * most-repeated landmine does.
 */
export type SettlementActionReason =
  | SettlementErrorCode
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "UNEXPECTED";

export type SettlementActionResult =
  | { ok: true; settlementId: string; docNo: string; alreadySubmitted?: true }
  | { ok: false; reason: SettlementActionReason };

function isValidInvoice(input: unknown): input is { receivableId: string; amount: number } {
  if (typeof input !== "object" || input === null) return false;
  const i = input as Record<string, unknown>;
  return (
    typeof i.receivableId === "string" &&
    i.receivableId !== "" &&
    typeof i.amount === "number" &&
    Number.isFinite(i.amount) &&
    i.amount > 0
  );
}

function isValidDeduction(input: unknown): input is StoreSettlementDeductionInput {
  if (typeof input !== "object" || input === null) return false;
  const d = input as Record<string, unknown>;
  if (d.type === "RETUR_OFFSET") {
    return (
      typeof d.amount === "number" &&
      Number.isFinite(d.amount) &&
      d.amount > 0 &&
      typeof d.fieldReturnId === "string" &&
      d.fieldReturnId !== ""
    );
  }
  if (d.type === "PROGRAM") {
    return (
      typeof d.amount === "number" &&
      Number.isFinite(d.amount) &&
      d.amount > 0 &&
      typeof d.proofUrl === "string" &&
      d.proofUrl !== "" &&
      typeof d.proofR2Key === "string" &&
      d.proofR2Key !== "" &&
      (d.note === undefined || typeof d.note === "string")
    );
  }
  if (d.type === "ADMIN_FEE") {
    /**
     * `Number.isFinite`, never the global `isFinite` — the global coerces its argument first,
     * so `isFinite(null)` is `true` and a missing percent would silently pass as `0`.
     */
    return (
      typeof d.percent === "number" &&
      Number.isFinite(d.percent) &&
      d.percent >= 0 &&
      d.percent <= 100 &&
      typeof d.proofUrl === "string" &&
      d.proofUrl !== "" &&
      typeof d.proofR2Key === "string" &&
      d.proofR2Key !== ""
    );
  }
  return false;
}

function isValidInput(input: unknown): input is SubmitStoreSettlementInput {
  if (typeof input !== "object" || input === null) return false;
  const i = input as Record<string, unknown>;
  if (typeof i.draftId !== "string" || !DRAFT_ID_PATTERN.test(i.draftId)) return false;
  if (typeof i.storeId !== "string" || i.storeId === "") return false;
  if (typeof i.actualAmount !== "number" || !Number.isFinite(i.actualAmount) || i.actualAmount < 0) return false;
  if (!Array.isArray(i.invoices) || i.invoices.length === 0 || !i.invoices.every(isValidInvoice)) return false;
  if (!Array.isArray(i.deductions) || !i.deductions.every(isValidDeduction)) return false;
  if (i.note !== undefined && typeof i.note !== "string") return false;
  return true;
}

/**
 * An expired session and a revoked permission are different problems for the salesman standing
 * at a store's counter — the first is fixed by signing back in, the second by asking an admin
 * for access. Conflating them into one `FORBIDDEN` sent a salesman whose session lapsed
 * mid-form looking for an admin instead of logging back in.
 */
async function guard(): Promise<{ userId: string } | { ok: false; reason: "UNAUTHENTICATED" | "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, reason: "UNAUTHENTICATED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SETTLEMENTS_SUBMIT)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  return { userId: session.user.id };
}

function toResult(e: unknown): { ok: false; reason: SettlementActionReason } {
  if (e instanceof SettlementError) return { ok: false, reason: e.code };
  return { ok: false, reason: "UNEXPECTED" };
}

/**
 * Wraps `submitSettlement` for the PWA settlement entry screen. Every export of a `"use server"`
 * module is an independently callable endpoint regardless of what the screen withholds, so
 * shape validation here re-derives the same guards `submitSettlement` itself enforces rather than
 * trusting the caller — a raw request can send anything.
 */
export async function submitStoreSettlementAction(input: unknown): Promise<SettlementActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  if (!isValidInput(input)) return { ok: false, reason: "INVALID_REQUEST" };

  try {
    const result = await submitSettlement({
      draftId: input.draftId,
      storeId: input.storeId,
      salesmanId: g.userId,
      invoices: input.invoices,
      deductions: input.deductions,
      actualAmount: input.actualAmount,
      note: input.note,
    });
    revalidatePath("/pwa/pelunasan");
    revalidatePath(`/pwa/pelunasan/${input.storeId}`);
    return {
      ok: true,
      settlementId: result.settlementId,
      docNo: result.docNo,
      alreadySubmitted: result.alreadySubmitted,
    };
  } catch (e) {
    return toResult(e);
  }
}

/**
 * `approveSettlement` throws `SettlementError` for everything it refuses itself, and propagates
 * `PaymentError` unmodified from `recordPayment`/`applyReturnOffset` — two error classes with
 * overlapping code strings (`WRONG_STORE` means "this receivable isn't this store's" in both, but
 * they are still distinct types) and different `instanceof`. Passing `e.code` straight through,
 * same shape as `toResult` above and `toCollectionResult` in `app/actions/collections.ts`, needs
 * no second `Record<…>` map that could drift out of sync with either `errors.ts` union — but it
 * does need the `instanceof` check to run for BOTH classes, in order, rather than assuming every
 * thrown error is a `SettlementError`.
 */
export type SettlementApprovalActionReason =
  | SettlementErrorCode
  | PaymentErrorCode
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "UNEXPECTED";

export type ApproveSettlementActionResult =
  | { ok: true; paymentIds: string[]; alreadyApproved?: true }
  | { ok: false; reason: SettlementApprovalActionReason };

export type RejectSettlementActionResult =
  | { ok: true }
  | { ok: false; reason: SettlementApprovalActionReason };

/**
 * Both the approve and reject actions gate on `collections:manage` — it already exists, is
 * already seeded on production, and is ADMIN-only (see `PERMISSIONS.COLLECTIONS_MANAGE`'s other
 * callers in `app/actions/collections.ts`), so this ships working with no hand-run seed. A single
 * `FORBIDDEN` for both a missing session and a missing permission mirrors `guardManage` in that
 * same file — an ADMIN-only backoffice action, unlike the salesman-facing submit guard above,
 * which distinguishes an expired session from a missing permission for a very different audience.
 */
async function guardManage(): Promise<{ userId: string } | { ok: false; reason: "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.COLLECTIONS_MANAGE)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  return { userId: session.user.id };
}

function toApprovalResult(e: unknown): { ok: false; reason: SettlementApprovalActionReason } {
  if (e instanceof SettlementError) return { ok: false, reason: e.code };
  if (e instanceof PaymentError) return { ok: false, reason: e.code };
  return { ok: false, reason: "UNEXPECTED" };
}

function isValidApproveSettlementInput(
  input: unknown,
): input is { settlementId: string; overrideReason?: string } {
  if (typeof input !== "object" || input === null) return false;
  const i = input as Record<string, unknown>;
  if (typeof i.settlementId !== "string" || i.settlementId === "") return false;
  if (i.overrideReason !== undefined && typeof i.overrideReason !== "string") return false;
  return true;
}

function isValidRejectSettlementInput(input: unknown): input is { settlementId: string; reason: string } {
  if (typeof input !== "object" || input === null) return false;
  const i = input as Record<string, unknown>;
  if (typeof i.settlementId !== "string" || i.settlementId === "") return false;
  if (typeof i.reason !== "string") return false;
  return true;
}

/**
 * Approves a submitted settlement for the finance queue.
 *
 * `approveSettlement` posts NO journal itself and returns every payment id it created —
 * `paymentIds` holds up to four simple components (retur/program/admin-fee/cash) PLUS one per
 * retur deduction row, never just one. This loops `postArJournalSafely` over the WHOLE array —
 * copying `recordPaymentAction`'s single-payment shape here is the exact mistake this task exists
 * to avoid, since a settlement can post several payments where a plain payment posts one.
 *
 * The loop stays correct on an `alreadyApproved` resume: `postArJournalSafely` never throws, and
 * `generateAutoJournal`'s own `Journal @@unique([sourceType, sourceId])` makes a repeat call
 * report `created: false` instead of double-posting, so re-running the loop over the same ids is
 * safe rather than merely tolerated.
 */
export async function approveSettlementAction(input: unknown): Promise<ApproveSettlementActionResult> {
  const g = await guardManage();
  if ("ok" in g) return g;
  if (!isValidApproveSettlementInput(input)) return { ok: false, reason: "INVALID_REQUEST" };

  let result: ApproveSettlementResult;
  try {
    result = await approveSettlement({
      settlementId: input.settlementId,
      approvedById: g.userId,
      overrideReason: input.overrideReason,
    });
  } catch (e) {
    return toApprovalResult(e);
  }

  for (const paymentId of result.paymentIds) {
    await postArJournalSafely("ar_payment", paymentId, () => postPaymentReceiptJournal(paymentId, g.userId));
  }

  /*
   * Written only for the run that actually flips the status. A resumed call landing on
   * `alreadyApproved` reports the same payments again but must not create a second
   * `SETTLEMENT_APPROVE` row for the one approval that already happened — the writer's own
   * `SETTLEMENT_VARIANCE_OVERRIDE` row (written inside its status-flip transaction, only when an
   * override was actually needed) is the only other audit entry this feature writes, and this
   * action does not duplicate it.
   */
  if (!result.alreadyApproved) {
    await prisma.auditLog.create({
      data: {
        userId: g.userId,
        action: "SETTLEMENT_APPROVE",
        entityType: "StoreSettlement",
        entityId: input.settlementId,
        metadata: { paymentIds: result.paymentIds },
      },
    });
  }

  revalidatePath("/pwa/pelunasan");
  revalidatePath("/backoffice/finance/pelunasan");

  return { ok: true, paymentIds: result.paymentIds, alreadyApproved: result.alreadyApproved };
}

/**
 * Rejects a submitted settlement for the finance queue. `rejectSettlement` itself CAS-flips
 * `PENDING -> REJECTED` and enqueues the salesman's `NotificationQueue` row; this action owns the
 * `SETTLEMENT_REJECT` audit row, the same split as `approveSettlementAction` owning
 * `SETTLEMENT_APPROVE` above — the writer's docstring reasons through why that split exists.
 */
export async function rejectSettlementAction(input: unknown): Promise<RejectSettlementActionResult> {
  const g = await guardManage();
  if ("ok" in g) return g;
  if (!isValidRejectSettlementInput(input)) return { ok: false, reason: "INVALID_REQUEST" };

  try {
    await rejectSettlement({ settlementId: input.settlementId, rejectedById: g.userId, reason: input.reason });
  } catch (e) {
    return toApprovalResult(e);
  }

  await prisma.auditLog.create({
    data: {
      userId: g.userId,
      action: "SETTLEMENT_REJECT",
      entityType: "StoreSettlement",
      entityId: input.settlementId,
      reason: input.reason.trim(),
    },
  });

  revalidatePath("/pwa/pelunasan");
  revalidatePath("/backoffice/finance/pelunasan");

  return { ok: true };
}
