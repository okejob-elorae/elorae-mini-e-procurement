import { runSerializable } from "@/lib/db/tx-retry";
import { round2 } from "./pricing-rules";
import { listPriceCandidates, resolveLinePrice } from "./pricing";

export type PriceApprovedLineInput =
  | { lineId: string; deliveryLineId: string; userId: string }
  | { lineId: string; manualUnitPrice: number; note: string; userId: string };

export type PriceApprovedLineResult =
  | { ok: true; valued: boolean }
  | {
      ok: false;
      code: "NOT_FOUND" | "INVALID_STATE" | "ALREADY_APPROVED" | "PRICE_NOT_AVAILABLE" | "AUTO_PRICE_AVAILABLE";
    };

const VALUATION_CONFLICT = "FIELD_RETURN_VALUATION_CONFLICT";

/**
 * Finishes the valuation of a retur that was approved while one or more of its lines could not
 * be priced. Approval stamps `creditedQty` on every line and never blocks on price, so such a
 * retur sits at `APPROVED` + `valuationStatus: PENDING` with a null `totalValue` — and a PENDING
 * retur cannot be drawn (`applyReturnOffset` refuses `NOT_VALUED`) and posts no GL until a draw,
 * so valuing it late moves no money that has already moved.
 *
 * Only a line that is still unpriced can be priced here: a line that already carries a
 * `lineValue` — priced before approval, or by an earlier call — is refused `ALREADY_APPROVED`,
 * so a PENDING retur's valued lines are as final as a VALUED retur's. The screen renders such a
 * line as final too, but every `"use server"` export is independently callable, so the writer
 * is the enforcement.
 *
 * One serializable transaction: every refusal returns before the first write; after a write the
 * only way out is a throw, so a refused header never leaves a priced line behind. The header
 * compare-and-swap on `status: APPROVED, valuationStatus: PENDING, appliedValue: 0` is the guard
 * on the VALUED flip — a second admin pricing the last line concurrently either serialises behind
 * this one (and is then refused `ALREADY_APPROVED` on its own read) or loses the CAS and rolls
 * back. Once VALUED the retur is frozen again for good: its value can now be drawn on.
 *
 * The unit price is re-verified server-side exactly as the pre-approval path does: a delivery
 * pick must be one of this line's own candidates, and a manual price is refused while the line
 * would auto-resolve. `unitPrice` is stored rounded as a REFERENCE only; `lineValue` is computed
 * from the unrounded delivery price, the same way `approveFieldReturn` does it.
 */
export async function priceApprovedReturnLine(input: PriceApprovedLineInput): Promise<PriceApprovedLineResult> {
  try {
    return await runSerializable<PriceApprovedLineResult>(async (tx) => {
      const line = await tx.fieldReturnLine.findUnique({
        where: { id: input.lineId },
        select: {
          id: true,
          qty: true,
          receivedQty: true,
          creditedQty: true,
          itemId: true,
          variantSku: true,
          unitPrice: true,
          lineValue: true,
          priceSource: true,
          priceDeliveryLineId: true,
          priceNote: true,
          resolutions: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { id: true, type: true },
          },
          returnDoc: { select: { id: true, status: true, valuationStatus: true, appliedValue: true, storeId: true } },
        },
      });
      if (!line) return { ok: false, code: "NOT_FOUND" };
      const ret = line.returnDoc;
      if (ret.status !== "APPROVED") return { ok: false, code: "INVALID_STATE" };
      /* A drawn retur is always VALUED, so the appliedValue arm is defense-in-depth against a
         header that drifted — never reprice a retur something has already been paid from. */
      if (ret.valuationStatus === "VALUED" || ret.appliedValue.toNumber() !== 0) {
        return { ok: false, code: "ALREADY_APPROVED" };
      }
      /* A line that already holds a value is final even while its siblings are still unpriced. */
      if (line.lineValue !== null) return { ok: false, code: "ALREADY_APPROVED" };
      const creditedQty = line.creditedQty;
      if (creditedQty === null) return { ok: false, code: "INVALID_STATE" };

      const scope = { storeId: ret.storeId, itemId: line.itemId, variantSku: line.variantSku };
      let unitPrice: number;
      let priceSource: "DELIVERY" | "MANUAL";
      let priceDeliveryLineId: string | null;
      let priceNote: string | null;

      if ("deliveryLineId" in input) {
        const candidates = await listPriceCandidates(tx, scope);
        const match = candidates.find((c) => c.deliveryLineId === input.deliveryLineId);
        if (!match) return { ok: false, code: "PRICE_NOT_AVAILABLE" };
        unitPrice = match.unitPrice;
        priceSource = "DELIVERY";
        priceDeliveryLineId = match.deliveryLineId;
        priceNote = null;
      } else {
        if (!Number.isFinite(input.manualUnitPrice) || input.manualUnitPrice <= 0) {
          return { ok: false, code: "INVALID_STATE" };
        }
        const note = input.note.trim();
        if (note === "") return { ok: false, code: "INVALID_STATE" };
        const resolved = await resolveLinePrice(tx, scope);
        if (resolved.kind === "AUTO") return { ok: false, code: "AUTO_PRICE_AVAILABLE" };
        /* Rounded before it multiplies, matching the pre-approval path: setLinePriceAction stores
           round2(manualUnitPrice) and approveFieldReturn values the line from that stored figure. */
        unitPrice = round2(input.manualUnitPrice);
        priceSource = "MANUAL";
        priceDeliveryLineId = null;
        priceNote = note;
      }

      const lineValue = round2(creditedQty * unitPrice);

      const siblings = await tx.fieldReturnLine.findMany({
        where: { returnId: ret.id },
        select: { id: true, lineValue: true },
      });
      const values = siblings.map((s) =>
        s.id === line.id ? lineValue : s.lineValue === null ? null : s.lineValue.toNumber(),
      );
      const allPriced = values.every((v) => v !== null);
      /* Every addend is already 2dp, but a float sum of several can still carry sub-cent residue. */
      const total = round2(values.reduce<number>((sum, v) => sum + (v ?? 0), 0));

      await tx.fieldReturnLine.update({
        where: { id: line.id },
        data: { unitPrice: round2(unitPrice), lineValue, priceSource, priceDeliveryLineId, priceNote },
      });

      /* Same rule approveFieldReturn applies at approval: the missing units at this per-unit price. */
      const latest = line.resolutions[0] ?? null;
      if (latest && (latest.type === "SALESMAN_BEARS" || latest.type === "WRITE_OFF")) {
        const missing = line.qty - (line.receivedQty ?? 0);
        await tx.fieldReturnResolution.update({
          where: { id: latest.id },
          data: { amount: round2(missing * unitPrice) },
        });
      }

      const swapped = await tx.fieldReturn.updateMany({
        where: { id: ret.id, status: "APPROVED", valuationStatus: "PENDING", appliedValue: 0 },
        data: {
          totalValue: allPriced ? total : null,
          valuationStatus: allPriced ? "VALUED" : "PENDING",
        },
      });
      /* Never a return here — the line write above must roll back with the refused header. */
      if (swapped.count !== 1) throw new Error(VALUATION_CONFLICT);

      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: "FIELD_RETURN_LINE_PRICED_AFTER_APPROVAL",
          entityType: "FieldReturn",
          entityId: ret.id,
          changes: {
            lineId: line.id,
            before: {
              unitPrice: line.unitPrice === null ? null : line.unitPrice.toNumber(),
              lineValue: line.lineValue === null ? null : line.lineValue.toNumber(),
              priceSource: line.priceSource,
            },
            after: { unitPrice: round2(unitPrice), lineValue, priceSource },
            valued: allPriced,
          },
          reason: null,
        },
      });

      return { ok: true, valued: allPriced };
    });
  } catch (e) {
    /* The transaction has rolled back by now; a lost CAS means another call valued it first. */
    if (e instanceof Error && e.message === VALUATION_CONFLICT) return { ok: false, code: "ALREADY_APPROVED" };
    throw e;
  }
}
