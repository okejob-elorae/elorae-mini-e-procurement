"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { receiveFieldReturn } from "@/lib/field-sales/retur/receive-writer";
import { resolveFieldReturnLine } from "@/lib/field-sales/retur/resolve-writer";
import { approveFieldReturn } from "@/lib/field-sales/retur/approve-writer";
import { FieldReturnError, type FieldReturnErrorCode } from "@/lib/field-sales/retur/errors";

export type FieldReturnActionResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "FORBIDDEN"
        | "FORBIDDEN_WRITEOFF"
        | "NOT_FOUND"
        | "INVALID_STATE"
        | "SPLIT_MISMATCH"
        | "UNKNOWN_LINE"
        | "MISSING_LINE"
        | "DUPLICATE_LINE"
        | "NO_VARIANCE"
        | "UNRESOLVED_LINES"
        | "INVALID_REQUEST"
        | "ERROR";
    };

type ReceiveCount = { lineId: string; receivedQty: number; sellableQty: number; rejectedQty: number };

type ResolutionType = "SALESMAN_BEARS" | "INVESTIGATE" | "WRITE_OFF" | "ACCEPT_SURPLUS";

const RESOLUTION_TYPES: ReadonlySet<string> = new Set(["SALESMAN_BEARS", "INVESTIGATE", "WRITE_OFF", "ACCEPT_SURPLUS"]);

/**
 * Every `FieldReturnErrorCode` mapped explicitly, even the ones these three writers can never
 * actually throw (they belong to `createFieldReturn`, Task 1's writer) — a `Record` over the
 * whole union means a future code added to `errors.ts` fails TypeScript here instead of
 * silently falling through to `ERROR`. Shape errors map to `INVALID_REQUEST`, missing
 * documents to `NOT_FOUND`, wrong-state and split/line/variance codes keep their own name —
 * never a shape error onto a state error, or a missing document onto a wrong-state one.
 */
const ERROR_CODE_MAP: Record<FieldReturnErrorCode, Exclude<FieldReturnActionResult, { ok: true }>["code"]> = {
  NO_LINES: "INVALID_REQUEST",
  BAD_QTY: "INVALID_REQUEST",
  BAD_LINE_SHAPE: "INVALID_REQUEST",
  ITEM_NOT_FOUND: "NOT_FOUND",
  STORE_NOT_FOUND: "NOT_FOUND",
  VISIT_NOT_OWNED: "INVALID_REQUEST",
  MISSING_RESI: "INVALID_REQUEST",
  MISSING_EXPEDITION_NAME: "INVALID_REQUEST",
  MISSING_REASON_NOTE: "INVALID_REQUEST",
  INVALID_STATE: "INVALID_STATE",
  SPLIT_MISMATCH: "SPLIT_MISMATCH",
  UNKNOWN_LINE: "UNKNOWN_LINE",
  MISSING_LINE: "MISSING_LINE",
  NOT_FOUND: "NOT_FOUND",
  DUPLICATE_LINE: "DUPLICATE_LINE",
  NO_VARIANCE: "NO_VARIANCE",
  UNRESOLVED_LINES: "UNRESOLVED_LINES",
};

/**
 * A caught `FieldReturnError` keeps its own code via the map above; anything else (a network
 * hiccup, a programmer error) becomes `ERROR` rather than leaking a thrown message —
 * production digest-masking would swallow it anyway.
 */
function toResult(e: unknown): FieldReturnActionResult {
  if (e instanceof FieldReturnError) return { ok: false, code: ERROR_CODE_MAP[e.code] };
  return { ok: false, code: "ERROR" };
}

async function guard(): Promise<{ userId: string; permissions: string[] } | { ok: false; code: "FORBIDDEN" }> {
  const session = await auth();
  const permissions = session?.user?.permissions ?? [];
  if (!session?.user?.id || !hasPermission(permissions, PERMISSIONS.FIELD_RETURNS_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  return { userId: session.user.id, permissions };
}

function isValidReceiveInput(
  input: unknown
): input is { returnId: string; counts: ReceiveCount[] } {
  if (typeof input !== "object" || input === null) return false;
  const i = input as Record<string, unknown>;
  if (typeof i.returnId !== "string" || i.returnId === "") return false;
  if (!Array.isArray(i.counts)) return false;
  return i.counts.every((c) => {
    if (typeof c !== "object" || c === null) return false;
    const cc = c as Record<string, unknown>;
    return (
      typeof cc.lineId === "string" &&
      cc.lineId !== "" &&
      typeof cc.receivedQty === "number" &&
      typeof cc.sellableQty === "number" &&
      typeof cc.rejectedQty === "number"
    );
  });
}

function isValidResolveInput(
  input: unknown
): input is { lineId: string; type: ResolutionType; note?: string | null } {
  if (typeof input !== "object" || input === null) return false;
  const i = input as Record<string, unknown>;
  if (typeof i.lineId !== "string" || i.lineId === "") return false;
  if (typeof i.type !== "string" || !RESOLUTION_TYPES.has(i.type)) return false;
  if (i.note !== undefined && i.note !== null && typeof i.note !== "string") return false;
  return true;
}

export async function receiveAction(input: {
  returnId: string;
  counts: ReceiveCount[];
}): Promise<FieldReturnActionResult> {
  /*
   * guard() lives in this same try/catch as the writer call, not before it — auth() can throw
   * (a corrupted session cookie's JWT decrypt, a DB hiccup during the session lookup), and an
   * uncaught throw out of an action reaches the operator as an opaque production digest instead
   * of a typed ERROR. Shape validation and the writer call throw nothing of their own that
   * isn't a FieldReturnError, so folding them into the same guarded region is free.
   */
  try {
    const g = await guard();
    if ("ok" in g) return g;
    if (!isValidReceiveInput(input)) return { ok: false, code: "INVALID_REQUEST" };
    await receiveFieldReturn({ returnId: input.returnId, receivedById: g.userId, counts: input.counts });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/backoffice/field-returns");
  revalidatePath(`/backoffice/field-returns/${input.returnId}`);
  return { ok: true };
}

export async function resolveAction(input: {
  lineId: string;
  type: ResolutionType;
  note?: string | null;
}): Promise<FieldReturnActionResult> {
  let returnId = "";
  try {
    const g = await guard();
    if ("ok" in g) return g;
    if (!isValidResolveInput(input)) return { ok: false, code: "INVALID_REQUEST" };
    /*
     * A separate check and a separate code — the operator learns it is the WRITE_OFF option
     * that's blocked, not the whole screen. The other three resolution types need nothing
     * beyond field_returns:manage.
     */
    if (input.type === "WRITE_OFF" && !hasPermission(g.permissions, PERMISSIONS.FIELD_RETURNS_WRITEOFF)) {
      return { ok: false, code: "FORBIDDEN_WRITEOFF" };
    }
    const result = await resolveFieldReturnLine({
      lineId: input.lineId,
      type: input.type,
      note: input.note ?? null,
      createdById: g.userId,
    });
    returnId = result.returnId;
  } catch (e) {
    return toResult(e);
  }
  /*
   * The operator resolving a line is standing on the retur's detail page — that is the one
   * screen that must repaint, not just the list. resolveFieldReturnLine now returns the
   * returnId it already had in hand (it loads the line's parent inside the same transaction),
   * so both routes are revalidated here rather than pushing this back onto a client refresh.
   */
  revalidatePath("/backoffice/field-returns");
  revalidatePath(`/backoffice/field-returns/${returnId}`);
  return { ok: true };
}

export async function approveAction(returnId: string): Promise<FieldReturnActionResult> {
  try {
    const g = await guard();
    if ("ok" in g) return g;
    if (typeof returnId !== "string" || returnId === "") return { ok: false, code: "INVALID_REQUEST" };
    await approveFieldReturn({ returnId, approvedById: g.userId });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/backoffice/field-returns");
  revalidatePath(`/backoffice/field-returns/${returnId}`);
  return { ok: true };
}
