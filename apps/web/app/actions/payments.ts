"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { recordPayment } from "@/lib/finance/ar/payment-writer";
import { voidPayment } from "@/lib/finance/ar/void-writer";
import { applyReturnOffset } from "@/lib/finance/ar/retur-offset-writer";
import { PaymentError, type PaymentErrorCode } from "@/lib/finance/ar/errors";
import { postArJournalSafely } from "@/lib/finance/ar/post-ar-journal-safely";
import { postPaymentReceiptJournal, postPaymentVoidJournal } from "@/lib/finance/ar/payment-journal";
import { isArJournalRetryable } from "@/lib/finance/ar/journal-pending";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";

export type PaymentActionReason =
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "INVALID_AMOUNT"
  | "NO_ALLOCATIONS"
  | "ALLOCATION_MISMATCH"
  | "OVER_ALLOCATED"
  | "WRONG_STORE"
  | "NOT_FOUND"
  | "ALREADY_SETTLED"
  | "DUPLICATE_ALLOCATION"
  | "NOT_RETRYABLE"
  | "STILL_PENDING"
  | "RETURN_NOT_APPROVED"
  | "NOT_VALUED"
  | "ALREADY_APPLIED"
  | "INSUFFICIENT_OUTSTANDING"
  | "PAYMENT_VOIDED"
  | "ERROR";

export type PaymentActionResult =
  | { ok: true; paymentId?: string; docNo?: string; alreadyVoided?: boolean }
  | { ok: false; reason: PaymentActionReason };

export type RecordPaymentActionInput = {
  storeId: string;
  paidAt: string;
  method: "CASH" | "TRANSFER";
  amount: number;
  allocations: Array<{ receivableId: string; amount: number }>;
  reference?: string;
  note?: string;
  proofUrl?: string;
  proofR2Key?: string;
  idempotencyKey?: string;
};

/**
 * A `YYYY-MM-DD` calendar day at WIB midnight, or null for anything that is not one.
 *
 * Copied from the private helper of the same name in `apps/web/app/actions/field-sales-deliveries.ts`
 * rather than imported — that function is not exported, and its only other consumer being a
 * sibling file is not reason enough to widen its contract. See that file's own comment for the
 * three separate rejections this closes (a non-string, a silently rolled-over date, and a year
 * outside MariaDB's `DATETIME` range).
 */
function parseCalendarDay(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const parsed = parseDateOnly(trimmed);
  if (!parsed) return null;
  return formatDateOnlyJakarta(parsed) === trimmed ? parsed : null;
}

async function guard(): Promise<{ userId: string } | { ok: false; reason: "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.PAYMENTS_MANAGE)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  return { userId: session.user.id };
}

/**
 * Every `PaymentErrorCode` mapped explicitly — a `Record` over the whole union means a future
 * code added to `errors.ts` fails TypeScript here instead of silently falling through to
 * `ERROR`. `MISSING_REASON` collapses onto `INVALID_REQUEST` rather than getting its own reason:
 * this action layer already rejects a blank void reason before the writer ever runs (see
 * `voidPaymentAction`), so the writer's own stricter check — it also refuses a reason made up
 * entirely of zero-width/format characters that survive `.trim()` — reaches an operator as the
 * same "that request was not valid" message the action-level guard already uses.
 */
const ERROR_CODE_MAP: Record<PaymentErrorCode, PaymentActionReason> = {
  INVALID_AMOUNT: "INVALID_AMOUNT",
  NO_ALLOCATIONS: "NO_ALLOCATIONS",
  ALLOCATION_MISMATCH: "ALLOCATION_MISMATCH",
  OVER_ALLOCATED: "OVER_ALLOCATED",
  WRONG_STORE: "WRONG_STORE",
  NOT_FOUND: "NOT_FOUND",
  ALREADY_SETTLED: "ALREADY_SETTLED",
  DUPLICATE_ALLOCATION: "DUPLICATE_ALLOCATION",
  MISSING_REASON: "INVALID_REQUEST",
  RETURN_NOT_APPROVED: "RETURN_NOT_APPROVED",
  NOT_VALUED: "NOT_VALUED",
  ALREADY_APPLIED: "ALREADY_APPLIED",
  INSUFFICIENT_OUTSTANDING: "INSUFFICIENT_OUTSTANDING",
  PAYMENT_VOIDED: "PAYMENT_VOIDED",
};

/**
 * A caught `PaymentError` keeps its own reason via the map above; anything else (a network
 * hiccup, `auth()` throwing on a corrupted session cookie) becomes `ERROR` rather than leaking a
 * thrown message — production digest-masking would swallow it anyway.
 */
function toResult(e: unknown): { ok: false; reason: PaymentActionReason } {
  if (e instanceof PaymentError) return { ok: false, reason: ERROR_CODE_MAP[e.code] };
  return { ok: false, reason: "ERROR" };
}

function isValidAllocation(a: unknown): a is { receivableId: string; amount: number } {
  if (typeof a !== "object" || a === null) return false;
  const aa = a as Record<string, unknown>;
  return typeof aa.receivableId === "string" && aa.receivableId !== "" && typeof aa.amount === "number" && Number.isFinite(aa.amount);
}

/**
 * Shape only — business rules (amount > 0, allocations sum to the amount, no duplicate
 * receivable, etc.) stay in `recordPayment` itself and reach the caller through
 * `ERROR_CODE_MAP`. An empty `allocations` array is intentionally allowed through here: the
 * writer's own `NO_ALLOCATIONS` throw is what reports it, so the request-shape guard and the
 * business guard each own exactly one thing.
 */
function isValidRecordPaymentInput(input: unknown): input is RecordPaymentActionInput {
  if (typeof input !== "object" || input === null) return false;
  const i = input as Record<string, unknown>;
  if (typeof i.storeId !== "string" || i.storeId === "") return false;
  if (typeof i.paidAt !== "string") return false;
  if (i.method !== "CASH" && i.method !== "TRANSFER") return false;
  if (typeof i.amount !== "number" || !Number.isFinite(i.amount)) return false;
  if (!Array.isArray(i.allocations) || !i.allocations.every(isValidAllocation)) return false;
  if (i.reference !== undefined && typeof i.reference !== "string") return false;
  if (i.note !== undefined && typeof i.note !== "string") return false;
  if (i.proofUrl !== undefined && typeof i.proofUrl !== "string") return false;
  if (i.proofR2Key !== undefined && typeof i.proofR2Key !== "string") return false;
  if (i.idempotencyKey !== undefined && typeof i.idempotencyKey !== "string") return false;
  return true;
}

/**
 * Records a payment against one or more of a store's receivables.
 *
 * The receipt journal is posted AFTER `recordPayment`'s transaction commits, not inside it —
 * everything the journal needs is fixed by rows that transaction just created, so posting inside
 * would only stretch an already serializable window for no correctness gain. Same pattern as
 * `recordDeliveryAction` in `field-sales-deliveries.ts`.
 */
export async function recordPaymentAction(input: RecordPaymentActionInput): Promise<PaymentActionResult> {
  let userId = "";
  let paymentId = "";
  let docNo = "";
  try {
    const g = await guard();
    if ("ok" in g) return g;
    userId = g.userId;

    if (!isValidRecordPaymentInput(input)) return { ok: false, reason: "INVALID_REQUEST" };
    const paidAt = parseCalendarDay(input.paidAt);
    if (!paidAt) return { ok: false, reason: "INVALID_REQUEST" };

    const res = await recordPayment({
      storeId: input.storeId,
      paidAt,
      method: input.method,
      amount: input.amount,
      recordedById: userId,
      allocations: input.allocations,
      reference: input.reference,
      note: input.note,
      proofUrl: input.proofUrl,
      proofR2Key: input.proofR2Key,
      idempotencyKey: input.idempotencyKey,
    });
    paymentId = res.paymentId;
    docNo = res.docNo;
  } catch (e) {
    return toResult(e);
  }

  await postArJournalSafely("ar_payment", paymentId, () => postPaymentReceiptJournal(paymentId, userId));

  revalidatePath("/backoffice/finance/piutang");
  revalidatePath("/backoffice/finance/payments");
  return { ok: true, paymentId, docNo };
}

/**
 * Voids a posted payment and restores what it settled.
 *
 * `voidPayment` returning `{ voided: false }` means the payment was already voided and nothing
 * changed — treated here as an idempotent success (no journal reversal posted, nothing to
 * revalidate) rather than an error, mirroring how this repo already treats a repeat
 * mark-paid/mark-unpaid as a no-op success elsewhere in Finance. The two outcomes are still
 * distinguished via `alreadyVoided` on the `ok: true` result: a bare `{ ok: true }` cannot tell
 * "voided just now" from "was already voided", and a caller branching on `.ok` alone would toast
 * a real cancellation for a double-click that changed nothing. `alreadyVoided: false` is set
 * explicitly (not omitted) on the real-void path so both branches of this function are equally
 * explicit about which case ran, rather than one being "true" and the other "absent".
 */
export async function voidPaymentAction(input: { paymentId: string; reason: string }): Promise<PaymentActionResult> {
  let userId = "";
  let paymentId = "";
  let voided = false;
  try {
    const g = await guard();
    if ("ok" in g) return g;
    userId = g.userId;

    /*
     * Every dereference sits behind its own typeof. A `reason` that throws on `.trim()` before
     * the guard that would have rejected it is a bug this repo has already shipped once (see
     * `updateDeliveryDatesAction` in `field-sales-deliveries.ts`).
     */
    if (typeof input.paymentId !== "string" || input.paymentId === "" || typeof input.reason !== "string") {
      return { ok: false, reason: "INVALID_REQUEST" };
    }
    const reason = input.reason.trim();
    if (reason === "") return { ok: false, reason: "INVALID_REQUEST" };
    paymentId = input.paymentId;

    const result = await voidPayment({ paymentId, reason, voidedById: userId });
    voided = result.voided;
  } catch (e) {
    return toResult(e);
  }

  if (voided) {
    await postArJournalSafely("ar_payment_void", paymentId, () => postPaymentVoidJournal(paymentId, userId));
    revalidatePath("/backoffice/finance/piutang");
    revalidatePath("/backoffice/finance/payments");
    return { ok: true, paymentId, alreadyVoided: false };
  }

  return { ok: true, paymentId, alreadyVoided: true };
}

/**
 * Retries the receipt journal for one payment.
 *
 * The ENTRY gate — attempt only when `isArJournalRetryable` says this payment was flagged — is
 * the only thing that gate is used for. Whether THIS attempt actually posted is read from
 * `postArJournalSafely`'s own returned outcome (`.ok`), never from re-checking the gate: it
 * matches any `JOURNAL_PENDING` notification for the pair and ignores `readAt`, and nothing in
 * production ever clears one of those rows, so it would read "still pending" forever — even
 * immediately after a retry that just succeeded. This exact bug was already found and fixed once
 * in `postFieldDeliveryJournalsAction`; it is not reintroduced here.
 */
export async function postPaymentJournalAction(paymentId: string): Promise<PaymentActionResult> {
  let userId = "";
  try {
    const g = await guard();
    if ("ok" in g) return g;
    userId = g.userId;

    if (typeof paymentId !== "string" || paymentId === "") return { ok: false, reason: "INVALID_REQUEST" };
    const retryable = await isArJournalRetryable("ar_payment", paymentId);
    if (!retryable) return { ok: false, reason: "NOT_RETRYABLE" };
  } catch (e) {
    return toResult(e);
  }

  const outcome = await postArJournalSafely("ar_payment", paymentId, () => postPaymentReceiptJournal(paymentId, userId));
  if (!outcome.ok) return { ok: false, reason: "STILL_PENDING" };

  revalidatePath("/backoffice/finance/piutang");
  revalidatePath("/backoffice/finance/payments");
  return { ok: true, paymentId };
}

/**
 * Retries the void reversal journal for one payment. Same entry-gate/outcome split as
 * `postPaymentJournalAction` above, against the `ar_payment_void` kind instead.
 *
 * A failed reversal leaves the payment VOIDED with its receipt journal still standing — the GL
 * overstates cash and understates AR until this succeeds. Nothing else in this file reaches that
 * state: `voidPaymentAction` only attempts the reversal once, immediately after `voidPayment`
 * itself succeeds, so this is the only path back to it.
 */
export async function postPaymentVoidJournalAction(paymentId: string): Promise<PaymentActionResult> {
  let userId = "";
  try {
    const g = await guard();
    if ("ok" in g) return g;
    userId = g.userId;

    if (typeof paymentId !== "string" || paymentId === "") return { ok: false, reason: "INVALID_REQUEST" };
    const retryable = await isArJournalRetryable("ar_payment_void", paymentId);
    if (!retryable) return { ok: false, reason: "NOT_RETRYABLE" };
  } catch (e) {
    return toResult(e);
  }

  const outcome = await postArJournalSafely("ar_payment_void", paymentId, () => postPaymentVoidJournal(paymentId, userId));
  if (!outcome.ok) return { ok: false, reason: "STILL_PENDING" };

  revalidatePath("/backoffice/finance/piutang");
  revalidatePath("/backoffice/finance/payments");
  return { ok: true, paymentId };
}

function isValidAllocation2(a: unknown): a is { receivableId: string; amount: number } {
  if (typeof a !== "object" || a === null) return false;
  const aa = a as Record<string, unknown>;
  return typeof aa.receivableId === "string" && aa.receivableId !== "" && typeof aa.amount === "number" && Number.isFinite(aa.amount);
}

/**
 * Settles a store's receivable(s) using an approved retur's frozen value instead of cash. A
 * SEPARATE action from `recordPaymentAction`, deliberately — that action's own input guard stays
 * narrowed to "CASH" | "TRANSFER" on purpose, so RETUR_OFFSET is never reachable through the cash
 * payment sheet's own endpoint.
 */
export async function applyReturnOffsetAction(input: {
  returnId: string;
  allocations: Array<{ receivableId: string; amount: number }>;
}): Promise<PaymentActionResult & { alreadyApplied?: boolean }> {
  try {
    const g = await guard();
    if ("ok" in g) return g;

    if (typeof input.returnId !== "string" || input.returnId === "") return { ok: false, reason: "INVALID_REQUEST" };
    if (!Array.isArray(input.allocations) || !input.allocations.every(isValidAllocation2)) {
      return { ok: false, reason: "INVALID_REQUEST" };
    }

    const result = await applyReturnOffset({
      returnId: input.returnId,
      allocations: input.allocations,
      appliedById: g.userId,
    });

    await postArJournalSafely("ar_payment", result.paymentId, () => postPaymentReceiptJournal(result.paymentId, g.userId));

    revalidatePath("/backoffice/finance/piutang");
    revalidatePath("/backoffice/finance/payments");
    revalidatePath("/backoffice/field-returns");
    revalidatePath(`/backoffice/field-returns/${input.returnId}`);
    return { ok: true, paymentId: result.paymentId, alreadyApplied: result.alreadyApplied ?? false };
  } catch (e) {
    return toResult(e);
  }
}
