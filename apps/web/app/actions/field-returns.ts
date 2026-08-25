"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { receiveFieldReturn } from "@/lib/field-sales/retur/receive-writer";
import { resolveFieldReturnLine } from "@/lib/field-sales/retur/resolve-writer";
import { approveFieldReturn } from "@/lib/field-sales/retur/approve-writer";
import { listPriceCandidates, resolveLinePrice } from "@/lib/field-sales/retur/pricing";
import { round2 } from "@/lib/field-sales/retur/pricing-rules";
import { FieldReturnError, type FieldReturnErrorCode } from "@/lib/field-sales/retur/errors";
import { PRICEABLE_STATUSES, PRICEABLE_STATUS_SET } from "@/lib/field-sales/retur/queries";

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
        | "RESOLUTION_DIRECTION_MISMATCH"
        | "UNRESOLVED_LINES"
        | "PRICE_NOT_AVAILABLE"
        | "ALREADY_APPROVED"
        | "AUTO_PRICE_AVAILABLE"
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
  RESOLUTION_DIRECTION_MISMATCH: "RESOLUTION_DIRECTION_MISMATCH",
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

/** Request-shape guard: a non-negative integer, matching the writer's own BAD_QTY backstop. */
function isNonNegativeInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
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
      isNonNegativeInt(cc.receivedQty) &&
      isNonNegativeInt(cc.sellableQty) &&
      isNonNegativeInt(cc.rejectedQty)
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

type SetLinePriceInput =
  | { lineId: string; deliveryLineId: string }
  | { lineId: string; manualUnitPrice: number; note: string };

/**
 * The two shapes share `lineId`; whichever of `deliveryLineId` (a real string) or
 * `manualUnitPrice` discriminates which branch the action takes. A manual price must be a
 * POSITIVE finite number — `<= 0`, not just `< 0`, is rejected: a manual price of exactly 0
 * would still pass a Prisma `Decimal` truthiness check downstream and reads as a genuine,
 * complete valuation of zero rather than "no price was ever recorded" (the same GL-incident
 * class as a `cogs = 0` line that looked like real data). Its note must also be non-blank after
 * trimming — provenance is the entire point of the manual path, so an empty note is as invalid
 * as a missing price.
 */
function isValidSetLinePriceInput(input: unknown): input is SetLinePriceInput {
  if (typeof input !== "object" || input === null) return false;
  const i = input as Record<string, unknown>;
  if (typeof i.lineId !== "string" || i.lineId === "") return false;
  if (typeof i.deliveryLineId === "string") return i.deliveryLineId !== "";
  if (typeof i.manualUnitPrice === "number") {
    if (!Number.isFinite(i.manualUnitPrice) || i.manualUnitPrice <= 0) return false;
    return typeof i.note === "string" && i.note.trim() !== "";
  }
  return false;
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

/**
 * Lets an admin resolve a price the auto-resolve at approval could not pick on its own —
 * either by pointing at one of this line's own genuine delivery candidates, or by recording a
 * manual price with a required note. `resolveFieldReturnLine`'s own writer only touches
 * resolutions; this one writes the pricing columns directly since there is no dedicated
 * pricing writer file, matching this file's existing shape of guard + write inside one
 * try/catch so `auth()` can never escape uncaught.
 *
 * The delivery branch is the security-relevant one: `deliveryLineId` arrives from the client,
 * so it MUST be re-verified against `listPriceCandidates` for this exact line's store + item +
 * variant before it is trusted. Skipping that check would let an admin point a line at a
 * delivery from a different store entirely and inflate the retur's value — the one thing the
 * epic's acceptance criteria forbid.
 *
 * The MANUAL branch is EQUALLY security-relevant, for the same acceptance criterion, even
 * though the UI never renders a manual-price control on a line whose `priceState` is AUTO —
 * every export of a `"use server"` module is an independently callable endpoint regardless of
 * what the UI withholds. So this re-resolves the line's price server-side via
 * `resolveLinePrice` and refuses `AUTO_PRICE_AVAILABLE` unless the verdict is AMBIGUOUS or
 * UNPRICEABLE — a manual override is only for a line auto-resolve genuinely could not price
 * without help, never a lever to override a price that already resolves cleanly on its own.
 *
 *
 * The initial `findUnique` status check is a friendly early exit, not the real guard — it reads
 * and the actual write are two separate round trips, so a concurrent `approveFieldReturn` (which
 * runs inside its own serializable transaction) can freeze the line in between. The `updateMany`
 * below is the real guard: it repeats the same status condition as part of the write itself, and
 * a `count` of zero means the retur moved out from under this call, so nothing was written and
 * the caller is told `ALREADY_APPROVED` rather than a success that silently wrote nothing.
 */
export async function setLinePriceAction(input: SetLinePriceInput): Promise<FieldReturnActionResult> {
  try {
    const g = await guard();
    if ("ok" in g) return g;
    if (!isValidSetLinePriceInput(input)) return { ok: false, code: "INVALID_REQUEST" };

    const line = await prisma.fieldReturnLine.findUnique({
      where: { id: input.lineId },
      select: {
        id: true,
        itemId: true,
        variantSku: true,
        returnDoc: { select: { id: true, status: true, storeId: true } },
      },
    });
    if (!line) return { ok: false, code: "NOT_FOUND" };
    /* CANCELLED is not "already approved" — a wrong code sends whoever debugs this to the
       wrong place, so it keeps the existing generic wrong-state code instead. */
    if (line.returnDoc.status === "CANCELLED") return { ok: false, code: "INVALID_STATE" };
    if (!PRICEABLE_STATUS_SET.has(line.returnDoc.status)) return { ok: false, code: "ALREADY_APPROVED" };

    if ("deliveryLineId" in input) {
      const candidates = await listPriceCandidates(prisma, {
        storeId: line.returnDoc.storeId,
        itemId: line.itemId,
        variantSku: line.variantSku,
      });
      const match = candidates.find((c) => c.deliveryLineId === input.deliveryLineId);
      if (!match) return { ok: false, code: "PRICE_NOT_AVAILABLE" };
      const swapped = await prisma.fieldReturnLine.updateMany({
        where: { id: input.lineId, returnDoc: { status: { in: PRICEABLE_STATUSES } } },
        data: {
          priceSource: "DELIVERY",
          priceDeliveryLineId: input.deliveryLineId,
          unitPrice: null,
          priceNote: null,
        },
      });
      if (swapped.count === 0) return { ok: false, code: "ALREADY_APPROVED" };
    } else {
      const resolved = await resolveLinePrice(prisma, {
        storeId: line.returnDoc.storeId,
        itemId: line.itemId,
        variantSku: line.variantSku,
      });
      if (resolved.kind === "AUTO") return { ok: false, code: "AUTO_PRICE_AVAILABLE" };
      const swapped = await prisma.fieldReturnLine.updateMany({
        where: { id: input.lineId, returnDoc: { status: { in: PRICEABLE_STATUSES } } },
        data: {
          priceSource: "MANUAL",
          priceDeliveryLineId: null,
          unitPrice: round2(input.manualUnitPrice),
          priceNote: input.note.trim(),
        },
      });
      if (swapped.count === 0) return { ok: false, code: "ALREADY_APPROVED" };
    }

    revalidatePath("/backoffice/field-returns");
    revalidatePath(`/backoffice/field-returns/${line.returnDoc.id}`);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}
