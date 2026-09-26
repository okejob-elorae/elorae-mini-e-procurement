import { runSerializable } from "@/lib/db/tx-retry";
import { SellThroughError } from "./errors";

/* The same bound the screens and `cancelSellThrough` put on a free-text reason; `voidReason` is TEXT. */
const REASON_MAX_LENGTH = 1000;

/* `AuditLog.reason` is a bare `String?`, i.e. VARCHAR(191); the full reason stays on the report. */
const AUDIT_REASON_MAX_LENGTH = 191;

export type VoidSellThroughInput = { id: string; voidedById: string; reason: string };

/**
 * Voids an APPROVED report — invoiced or baseline — so a corrected one can be created from the
 * same count. In one serializable transaction it flips the report to VOIDED and nulls
 * `stocktakeKey` and `chainKey`, which frees the closing count and the store's chain slot, voids
 * the receivable (outstanding to 0, original amount kept) and cancels the faktur from whatever
 * status it had reached. It moves no stock: the stocktakes already set the balances. Reversal
 * journals are posted by the action after commit.
 *
 * The status CAS runs first, so a double void and a void racing an approve are structurally
 * impossible; every refusal after it throws, which rolls it back. Only the store's latest live
 * report can be voided (`HAS_SUCCESSOR`): the next report opens from this one's closing figures.
 * A receivable that has taken money, or that a pending settlement or collection claims, refuses
 * until that is undone.
 */
export async function voidSellThrough(input: VoidSellThroughInput): Promise<{ id: string; closingStocktakeId: string }> {
  const reason = input.reason?.trim() ?? "";
  if (reason === "") throw new SellThroughError("VOID_REASON_REQUIRED");
  if (reason.length > REASON_MAX_LENGTH) throw new SellThroughError("VOID_REASON_REQUIRED", "REASON_TOO_LONG");

  return runSerializable(async (tx) => {
    const doc = await tx.konsiSellThrough.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        storeId: true,
        closingStocktakeId: true,
        receivable: { select: { id: true, status: true, paidAmount: true } },
        taxInvoice: { select: { id: true } },
      },
    });
    if (!doc) throw new SellThroughError("NOT_FOUND");

    const claimed = await tx.konsiSellThrough.updateMany({
      where: { id: doc.id, status: "APPROVED" },
      data: { status: "VOIDED", voidedById: input.voidedById, voidedAt: new Date(), voidReason: reason, stocktakeKey: null, chainKey: null },
    });
    if (claimed.count === 0) throw new SellThroughError("INVALID_STATE");

    /**
     * The live successor is found through `chainKey`, never `previousId`. A report's `chainKey` is
     * `${storeId}:${previousId ?? "root"}` and is non-null only while it is live (DRAFT or
     * APPROVED): cancel and void both null it. So for a live report `previousId = doc.id` holds
     * exactly when its `chainKey` is `${doc.storeId}:${doc.id}`, and `@unique` makes that a point
     * lookup, which a SERIALIZABLE transaction locks at that one key of the index instead of the
     * broad range a scan on the unindexed `previousId` would lock.
     */
    const successor = await tx.konsiSellThrough.findUnique({
      where: { chainKey: `${doc.storeId}:${doc.id}` },
      select: { docNo: true },
    });
    if (successor) throw new SellThroughError("HAS_SUCCESSOR", successor.docNo);

    const receivable = doc.receivable;
    if (receivable) {
      if (receivable.status === "WRITTEN_OFF") throw new SellThroughError("ALREADY_SETTLED");
      if (receivable.paidAmount.gt(0)) throw new SellThroughError("HAS_PAYMENTS");
      const claim = await tx.storeSettlementInvoice.findFirst({
        where: { receivableId: receivable.id, settlement: { status: "PENDING" } },
        select: { settlement: { select: { docNo: true } } },
      });
      if (claim) throw new SellThroughError("SETTLEMENT_PENDING", claim.settlement.docNo);
      const submission = await tx.collectionSubmission.findFirst({
        where: { receivableId: receivable.id, status: "PENDING" },
        select: { id: true },
      });
      if (submission) throw new SellThroughError("COLLECTION_PENDING");
      await tx.receivable.update({ where: { id: receivable.id }, data: { status: "VOIDED", outstandingAmount: 0 } });
    }

    if (doc.taxInvoice) await tx.taxInvoice.update({ where: { id: doc.taxInvoice.id }, data: { status: "CANCELLED" } });

    await tx.auditLog.create({
      data: {
        userId: input.voidedById,
        action: "KONSI_SELL_THROUGH_VOID",
        entityType: "KonsiSellThrough",
        entityId: doc.id,
        reason: Array.from(reason).slice(0, AUDIT_REASON_MAX_LENGTH).join(""),
      },
    });

    return { id: doc.id, closingStocktakeId: doc.closingStocktakeId };
  });
}
