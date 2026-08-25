"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { receiveFieldReturn } from "@/lib/field-sales/retur/receive-writer";
import { resolveFieldReturnLine } from "@/lib/field-sales/retur/resolve-writer";
import { approveFieldReturn } from "@/lib/field-sales/retur/approve-writer";
import { createFieldReturn } from "@/lib/field-sales/retur/writer";
import { listPriceCandidates, resolveLinePrice } from "@/lib/field-sales/retur/pricing";
import { round2 } from "@/lib/field-sales/retur/pricing-rules";
import { FieldReturnError, type FieldReturnErrorCode } from "@/lib/field-sales/retur/errors";
import { FIELD_RETURN_REASONS, type FieldReturnLineInput } from "@/lib/field-sales/retur/types";
import {
  PRICEABLE_STATUSES,
  PRICEABLE_STATUS_SET,
  previewKonsiReturStockImpact,
  type KonsiReturStockImpactLine,
} from "@/lib/field-sales/retur/queries";

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
        | "SALESMAN_BEARS_NOT_ALLOWED"
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
  MISSING_NOTA_PHOTO: "INVALID_REQUEST",
  MISSING_TRANSPORT: "INVALID_REQUEST",
  INVALID_STATE: "INVALID_STATE",
  SPLIT_MISMATCH: "SPLIT_MISMATCH",
  UNKNOWN_LINE: "UNKNOWN_LINE",
  MISSING_LINE: "MISSING_LINE",
  NOT_FOUND: "NOT_FOUND",
  DUPLICATE_LINE: "DUPLICATE_LINE",
  NO_VARIANCE: "NO_VARIANCE",
  RESOLUTION_DIRECTION_MISMATCH: "RESOLUTION_DIRECTION_MISMATCH",
  /*
   * NOT the same bucket as RESOLUTION_DIRECTION_MISMATCH or INVALID_REQUEST: this is a rule
   * refusal specific to who raised the return (no salesman exists to bear the shortfall on an
   * ADMIN-origin retur), not a malformed payload or a shortage/surplus direction error. Kept as
   * its own result code so the resolution card can tell an admin "that resolution does not
   * apply here" instead of "your request was invalid."
   */
  SALESMAN_BEARS_NOT_ALLOWED: "SALESMAN_BEARS_NOT_ALLOWED",
  UNRESOLVED_LINES: "UNRESOLVED_LINES",
};

/**
 * A caught `FieldReturnError` keeps its own code via the map above; anything else (a network
 * hiccup, a programmer error) becomes `ERROR` rather than leaking a thrown message —
 * production digest-masking would swallow it anyway.
 */
/*
 * Typed as the narrower error-only slice, not the full `FieldReturnActionResult` — it never
 * actually returns an `ok: true`, but returning the wider union would make `toResult(e)` fail to
 * satisfy `RaiseAdminReturnActionResult` below, whose own `ok: true` branch carries extra fields
 * `FieldReturnActionResult`'s does not.
 */
function toResult(e: unknown): Exclude<FieldReturnActionResult, { ok: true }> {
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

/**
 * Line shape for an admin-raised return, mirrored against the writer's own `assertLineShape`
 * so a malformed line is refused HERE as `INVALID_REQUEST` rather than reaching the writer and
 * coming back as `BAD_LINE_SHAPE`/`BAD_QTY` — both already map to the same result code, but the
 * action layer owning request shape (rather than leaning on the writer's backstop) keeps this
 * action's own tests meaningful about what "malformed" means at this boundary.
 */
function isValidRaiseAdminReturnLine(l: unknown): l is FieldReturnLineInput {
  if (typeof l !== "object" || l === null) return false;
  const ll = l as Record<string, unknown>;
  if (typeof ll.itemId !== "string" || ll.itemId === "") return false;
  if (typeof ll.variantSku !== "string") return false;
  if (typeof ll.qty !== "number" || !Number.isInteger(ll.qty) || ll.qty <= 0) return false;
  if (typeof ll.reason !== "string" || !(FIELD_RETURN_REASONS as readonly string[]).includes(ll.reason)) return false;
  if (ll.reasonNote !== undefined && ll.reasonNote !== null && typeof ll.reasonNote !== "string") return false;
  return true;
}

/**
 * No `transport`/`notaPhotoUrl`/`notaPhotoR2Key`/`visitId` fields at all — an admin raising a
 * return from the office has no nota to photograph, no carrier, and no field visit to attach.
 * The writer enforces that ADMIN origin needs none of those (Task 2); this action never even
 * accepts them as input, so there is no client-controlled way to smuggle a FIELD-only field in.
 */
function isValidRaiseAdminReturnInput(
  input: unknown
): input is { storeId: string; lines: FieldReturnLineInput[]; note?: string | null } {
  if (typeof input !== "object" || input === null) return false;
  const i = input as Record<string, unknown>;
  if (typeof i.storeId !== "string" || i.storeId === "") return false;
  if (i.note !== undefined && i.note !== null && typeof i.note !== "string") return false;
  if (!Array.isArray(i.lines) || i.lines.length === 0) return false;
  return i.lines.every(isValidRaiseAdminReturnLine);
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

/**
 * The `ok: true` branch carries `returnId`/`docNo` (Task 4's UI needs both — one to navigate to
 * the new return's detail page, the other to show the operator what got raised) so it cannot
 * reuse `FieldReturnActionResult`'s plain `{ ok: true }` shape. The error side reuses that
 * union's codes as-is rather than inventing a parallel set: every `FieldReturnErrorCode`
 * `createFieldReturn` can throw for an ADMIN-origin raise (`NO_LINES`, `BAD_QTY`,
 * `BAD_LINE_SHAPE`, `ITEM_NOT_FOUND`, `STORE_NOT_FOUND`, `MISSING_REASON_NOTE`) already has an
 * entry in `ERROR_CODE_MAP` above, so nothing new needs adding there for this action.
 */
export type RaiseAdminReturnActionResult =
  | { ok: true; returnId: string; docNo: string }
  | Exclude<FieldReturnActionResult, { ok: true }>;

/**
 * Lets an admin at the office raise a store return without a nota photo, a transport mode, or a
 * field visit — `createFieldReturn` (Task 2's writer) already refuses none of those for
 * `origin: "ADMIN"`; this action just never accepts them as input in the first place. Follows
 * this file's own shape: `guard()`, shape validation and the writer call all sit inside the one
 * try/catch so a throwing `auth()` returns a typed `ERROR` instead of escaping uncaught — the
 * exact bug this file shipped once, missed by three prior tests because each rejected the
 * *writer* mock instead of `auth()` itself.
 */
export async function raiseAdminReturnAction(input: {
  storeId: string;
  lines: FieldReturnLineInput[];
  note?: string | null;
}): Promise<RaiseAdminReturnActionResult> {
  let returnId = "";
  let docNo = "";
  try {
    const g = await guard();
    if ("ok" in g) return g;
    if (!isValidRaiseAdminReturnInput(input)) return { ok: false, code: "INVALID_REQUEST" };
    const created = await createFieldReturn({
      storeId: input.storeId,
      raisedById: g.userId,
      origin: "ADMIN",
      note: input.note ?? null,
      lines: input.lines,
    });
    returnId = created.returnId;
    docNo = created.docNo;
  } catch (e) {
    return toResult(e);
  }
  /*
   * The list, the new return's own detail page, and the store detail page all repaint — Task 4
   * puts the raise flow ON the store detail page, so a revalidate that skips it is a silent
   * no-op the moment that UI lands.
   */
  revalidatePath("/backoffice/field-returns");
  revalidatePath(`/backoffice/field-returns/${returnId}`);
  revalidatePath(`/backoffice/stores/${input.storeId}`);
  return { ok: true, returnId, docNo };
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
        where: { id: input.lineId, returnDoc: { status: { in: [...PRICEABLE_STATUSES] } } },
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
        where: { id: input.lineId, returnDoc: { status: { in: [...PRICEABLE_STATUSES] } } },
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

export type PreviewKonsiReturStockImpactResult =
  | { ok: true; rows: KonsiReturStockImpactLine[] }
  | { ok: false; code: "FORBIDDEN" | "NOT_FOUND" | "ERROR" };

/**
 * Read-only — no write, no revalidation. Lets the approve confirm dialog show the approver what
 * a KONSI retur's decrement would do to the store's stock BEFORE they commit, rather than only
 * discovering a negative row afterwards on the store page. Gated the same as every other action
 * in this file (field_returns:manage) since it exposes a store's stock figures; the dialog that
 * calls this only renders for a manager anyway, but every export here is an independently
 * callable endpoint regardless of what the UI withholds.
 *
 * `previewKonsiReturStockImpact` returns `null` for a nonexistent returnId and `[]` for "no
 * impact" (non-KONSI store, or a KONSI store with nothing that would go negative) — those two
 * must not be conflated, so `null` maps to NOT_FOUND and `[]` passes through as `{ ok: true, rows:
 * [] }`.
 */
export async function previewKonsiReturStockImpactAction(
  returnId: string,
): Promise<PreviewKonsiReturStockImpactResult> {
  try {
    const g = await guard();
    if ("ok" in g) return g;
    if (typeof returnId !== "string" || returnId === "") return { ok: false, code: "NOT_FOUND" };
    const rows = await previewKonsiReturStockImpact(returnId);
    if (rows === null) return { ok: false, code: "NOT_FOUND" };
    return { ok: true, rows };
  } catch {
    return { ok: false, code: "ERROR" };
  }
}
