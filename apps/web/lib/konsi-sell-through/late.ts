import type { Prisma } from "@elorae/db";
import {
  deriveSellThroughLines,
  roundQty,
  UnknownLedgerRefTypeError,
  type DerivedLine,
  type LateMovement,
} from "./derive";
import { SellThroughError } from "./errors";
import { loadSellThroughInputs } from "./window";

/* `deriveSellThroughLines` with its one refusal mapped onto the writer's code — the single spelling for the current window and the previous report's re-derivation alike. */
export function deriveOrRefuse(input: Parameters<typeof deriveSellThroughLines>[0]): DerivedLine[] {
  try {
    return deriveSellThroughLines(input);
  } catch (e) {
    if (e instanceof UnknownLedgerRefTypeError) throw new SellThroughError("UNKNOWN_REF_TYPE", e.refType);
    throw e;
  }
}

export type StoredLineFigures = {
  itemId: string;
  variantSku: string;
  inQty: number;
  outQty: number;
  posSoldQty: number;
  gapQty: number;
  lateInQty: number;
  lateOutQty: number;
  latePosSoldQty: number;
  lateGapQty: number;
};

type WindowFigures = { itemId: string; variantSku: string; inQty: number; outQty: number; posSold: number; gap: number };

/**
 * The pure core of the carry-forward: per key, what a fresh re-derivation of the previous report's
 * window holds beyond what that report stored for its OWN window — its stored totals minus the late
 * figures it had itself carried in from ITS predecessor. Comparing against the bare totals would
 * treat those carried figures as a negative difference and bill them again, negated. A key missing
 * on either side counts as zero there. Only non-zero differences are returned, compared at 2dp.
 */
export function diffLateMovements(fresh: DerivedLine[], stored: StoredLineFigures[]): LateMovement[] {
  const keyOf = (itemId: string, variantSku: string) => `${itemId}::${variantSku}`;
  const storedWindow = new Map<string, WindowFigures>();
  for (const s of stored) {
    storedWindow.set(keyOf(s.itemId, s.variantSku), {
      itemId: s.itemId,
      variantSku: s.variantSku,
      inQty: roundQty(s.inQty - s.lateInQty),
      outQty: roundQty(s.outQty - s.lateOutQty),
      posSold: roundQty(s.posSoldQty - s.latePosSoldQty),
      gap: roundQty(s.gapQty - s.lateGapQty),
    });
  }
  const freshByKey = new Map(fresh.map((l) => [keyOf(l.itemId, l.variantSku), l]));
  const keys = new Set([...Array.from(storedWindow.keys()), ...Array.from(freshByKey.keys())]);

  const deltas: LateMovement[] = [];
  for (const key of keys) {
    const f = freshByKey.get(key);
    const s = storedWindow.get(key);
    const delta: LateMovement = {
      itemId: f?.itemId ?? s?.itemId ?? "",
      variantSku: f?.variantSku ?? s?.variantSku ?? "",
      inQty: roundQty((f?.inQty ?? 0) - (s?.inQty ?? 0)),
      outQty: roundQty((f?.outQty ?? 0) - (s?.outQty ?? 0)),
      posSold: roundQty((f?.posSoldQty ?? 0) - (s?.posSold ?? 0)),
      gap: roundQty((f?.gapQty ?? 0) - (s?.gap ?? 0)),
    };
    if (delta.inQty !== 0 || delta.outQty !== 0 || delta.posSold !== 0 || delta.gap !== 0) deltas.push(delta);
  }
  return deltas.sort((a, b) => (a.itemId === b.itemId ? a.variantSku.localeCompare(b.variantSku) : a.itemId.localeCompare(b.itemId)));
}

/**
 * The boundary race, closed one level deep. A store ledger row stamped at or before the previous
 * report's boundary by a transaction that committed only after that report was approved belongs to
 * no window — the next window starts strictly after the boundary. So each report re-derives its
 * previous report P's window with P's own inputs (openings from P's predecessor's stored
 * `closingQty`, P's boundary, P's snapshotted `method`) and carries the difference against P's
 * stored figures into its own derivation. P's approve proved fresh == stored inside its own
 * transaction, so any difference is rows that committed after it. P itself is never modified —
 * not its lines, not its invoice.
 *
 * `UNKNOWN_REF_TYPE` applies to P's re-derivation exactly as to the current window. A row that
 * commits after TWO reports are approved is caught by neither; that residual is logged in
 * docs/FOLLOWUPS.md. Callers pass their own transaction client: create and approve both run it
 * inside their serializable transaction, so approve's `STALE` comparison covers the late figures too.
 */
export async function computeLateMovements(
  client: Prisma.TransactionClient,
  storeId: string,
  previous: { id: string; closingStocktakeId: string } | null,
): Promise<LateMovement[]> {
  if (!previous) return [];

  const report = await client.konsiSellThrough.findUnique({
    where: { id: previous.id },
    select: {
      method: true,
      previousId: true,
      lines: {
        select: {
          itemId: true,
          variantSku: true,
          inQty: true,
          outQty: true,
          posSoldQty: true,
          gapQty: true,
          lateInQty: true,
          lateOutQty: true,
          latePosSoldQty: true,
          lateGapQty: true,
        },
      },
    },
  });
  if (!report) throw new SellThroughError("NOT_FOUND", "PREVIOUS_REPORT");

  /**
   * This check guards existence only; it never reads the status. The chain invariants are what keep
   * the report before APPROVED: cancel is DRAFT-only, and a void refuses while a live successor
   * exists, which this APPROVED report is. The missing-row throw is a guard, not a path.
   */
  const beforePrevious = report.previousId
    ? await client.konsiSellThrough.findUnique({ where: { id: report.previousId }, select: { id: true, closingStocktakeId: true } })
    : null;
  if (report.previousId && !beforePrevious) throw new SellThroughError("NOT_FOUND", "PREVIOUS_REPORT");

  const inputs = await loadSellThroughInputs(client, { storeId, closingStocktakeId: previous.closingStocktakeId, previous: beforePrevious });
  const fresh = deriveOrRefuse({ method: report.method, openings: inputs.openings, rows: inputs.rows, counted: inputs.counted });

  return diffLateMovements(
    fresh,
    report.lines.map((l) => ({
      itemId: l.itemId,
      variantSku: l.variantSku,
      inQty: roundQty(l.inQty.toNumber()),
      outQty: roundQty(l.outQty.toNumber()),
      posSoldQty: roundQty(l.posSoldQty.toNumber()),
      gapQty: roundQty(l.gapQty.toNumber()),
      lateInQty: roundQty(l.lateInQty.toNumber()),
      lateOutQty: roundQty(l.lateOutQty.toNumber()),
      latePosSoldQty: roundQty(l.latePosSoldQty.toNumber()),
      lateGapQty: roundQty(l.lateGapQty.toNumber()),
    })),
  );
}
