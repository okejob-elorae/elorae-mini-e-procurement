"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { submitSettlement } from "@/lib/finance/ar-settlement/submit-writer";
import { SettlementError, type SettlementErrorCode } from "@/lib/finance/ar-settlement/errors";

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
 * `Record<SettlementErrorCode, …>` map to keep exhaustive against `errors.ts`'s 23-member union,
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
