import { prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { isUniqueViolationOn } from "@/lib/db/unique-violation";
import { generateDocNumber } from "@/lib/docNumber";
import { findExistingInventoryValueRow } from "@/lib/inventory/costing";
import { isStockableVariantKey } from "@/lib/items/variants";
import { isSellThroughSalesmanCandidate } from "@/lib/konsi-sell-through/salesman-candidates";
import { approveKonsiOrderInTx } from "./writer";
import { KonsiPushError } from "./errors";

export type KonsiPushLine = { itemId: string; variantSku: string; qty: number };

export type CreateKonsiPushOrderInput = {
  storeId: string;
  salesmanId: string;
  pushedById: string;
  lines: KonsiPushLine[];
  note?: string;
  idempotencyKey: string;
  /* Required only when the store's credit exposure is over its limit; see `approveKonsiOrderInTx`. */
  creditOverrideReason?: string;
};

type PushResult = { orderId: string; orderNo: string };

/**
 * A key already spent on another store, or on a salesman's own order, is never handed back as
 * this push. A key on this store's own push is a replay only when it carries the same salesman
 * and the same lines (product, variant and qty, in any order); a changed retry is refused with
 * the recorded order number rather than answered with an order that does not match what was sent.
 * The note is not compared.
 */
function replayOrConflict(existing: ExistingPush, input: CreateKonsiPushOrderInput): PushResult {
  if (existing.storeId !== input.storeId || existing.origin !== "ADMIN") throw new KonsiPushError("KEY_CONFLICT");
  const lineKey = (l: { itemId: string; variantSku: string | null }) => `${l.itemId}::${l.variantSku ?? ""}`;
  const recorded = new Map(existing.lines.map((l) => [lineKey(l), Number(l.qty)]));
  const sent = new Map(input.lines.map((l) => [lineKey(l), Number(l.qty)]));
  const sameLines = recorded.size === sent.size && existing.lines.length === input.lines.length
    && Array.from(sent).every(([key, qty]) => recorded.get(key) === qty);
  if (existing.salesmanId !== input.salesmanId || !sameLines) throw new KonsiPushError("REPLAY_MISMATCH", existing.orderNo);
  return { orderId: existing.id, orderNo: existing.orderNo };
}

const EXISTING_SELECT = {
  id: true,
  orderNo: true,
  storeId: true,
  origin: true,
  salesmanId: true,
  lines: { select: { itemId: true, variantSku: true, qty: true } },
} as const;

type ExistingPush = {
  id: string;
  orderNo: string;
  storeId: string;
  origin: string;
  salesmanId: string | null;
  lines: Array<{ itemId: string; variantSku: string | null; qty: unknown }>;
};

/**
 * An admin sends stock to a KONSI store without a salesman order: one serializable transaction
 * creates a KONSI field-sales order (`origin: ADMIN`, no visit) and approves it through the same
 * core a normal konsi approve uses, so the lines are reserved and priced exactly as if a salesman
 * had raised them. From there it is an ordinary approved konsi order — a delivery shipment carries
 * it, and completing that shipment is what moves the stock. Nothing here moves stock, raises a
 * receivable or posts a journal.
 *
 * Every input check runs before the first write, and every refusal throws. A short line fails the
 * whole push with `InsufficientStockError`, and a store whose credit exposure is over its limit
 * fails it with `CreditLimitExceededError` unless an override reason is given — either way leaving
 * no order behind. Both of those checks run inside the shared approve core, after the order row is
 * written, so it is the transaction's rollback that removes the order. The idempotency key is the caller's
 * to keep stable across retries of one submission; a replay must carry the same salesman and lines and
 * returns the order it created, while a changed one is refused with `REPLAY_MISMATCH`. Two
 * concurrent submissions of one key both return the order the first one committed: the loser's
 * unique violation is caught outside the transaction and answered with the winner.
 */
export async function createKonsiPushOrder(input: CreateKonsiPushOrderInput): Promise<PushResult> {
  try {
    return await runSerializable(async (tx) => {
      const existing = await tx.fieldSalesOrder.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: EXISTING_SELECT,
      });
      if (existing) return replayOrConflict(existing, input);

      const store = await tx.store.findUnique({ where: { id: input.storeId }, select: { termsType: true, isActive: true } });
      if (!store) throw new KonsiPushError("NOT_FOUND");
      if (store.termsType !== "KONSI") throw new KonsiPushError("NOT_KONSI");
      if (!store.isActive) throw new KonsiPushError("STORE_INACTIVE");

      if (!(await isSellThroughSalesmanCandidate(tx, input.salesmanId))) throw new KonsiPushError("SALESMAN_INVALID");

      if (input.lines.length === 0) throw new KonsiPushError("NO_LINES");
      const itemIds = Array.from(new Set(input.lines.map((l) => l.itemId)));
      const items = await tx.item.findMany({
        where: { id: { in: itemIds }, isActive: true, type: "FINISHED_GOOD" },
        select: { id: true, nameId: true, variants: true },
      });
      const itemById = new Map(items.map((i) => [i.id, i]));
      const seen = new Set<string>();
      for (const line of input.lines) {
        const variantSku = line.variantSku ?? "";
        const key = `${line.itemId}::${variantSku}`;
        if (!Number.isInteger(line.qty) || line.qty <= 0) throw new KonsiPushError("BAD_QTY", key);
        if (seen.has(key)) throw new KonsiPushError("DUPLICATE", key);
        seen.add(key);
        const item = itemById.get(line.itemId);
        if (!item) throw new KonsiPushError("UNKNOWN_ITEM", key);
        /**
         * Stock is per variant for an item with SKU variants: a "" line would reserve against a
         * pooled variantless row and land StoreStock on "", where per-variant SPG sales and the gap
         * tests never see it. So such an item takes only its own variant SKUs, and a variantless
         * item takes only "" — `isStockableVariantKey` is the one spelling of that rule, shared with
         * the push page's own filter over the same two suggestion lists.
         */
        if (!isStockableVariantKey(item.variants, variantSku)) throw new KonsiPushError("NO_INVENTORY", key);
        if (!(await findExistingInventoryValueRow(tx, line.itemId, variantSku))) throw new KonsiPushError("NO_INVENTORY", key);
      }

      const orderNo = await generateDocNumber("KONSI", tx);
      const order = await tx.fieldSalesOrder.create({
        data: {
          orderNo,
          orderType: "KONSI",
          origin: "ADMIN",
          storeId: input.storeId,
          salesmanId: input.salesmanId,
          visitId: null,
          status: "PENDING_APPROVAL",
          subtotal: 0,
          total: 0,
          note: input.note?.trim() || null,
          idempotencyKey: input.idempotencyKey,
          lines: {
            create: input.lines.map((line) => ({
              itemId: line.itemId,
              variantSku: line.variantSku ?? "",
              productName: itemById.get(line.itemId)!.nameId,
              qty: line.qty,
              unitPrice: 0,
              lineTotal: 0,
            })),
          },
        },
        select: { id: true },
      });

      await approveKonsiOrderInTx(tx, {
        orderId: order.id,
        approvedById: input.pushedById,
        creditOverrideReason: input.creditOverrideReason,
      });

      return { orderId: order.id, orderNo };
    });
  } catch (e) {
    if (!isUniqueViolationOn(e, "idempotencyKey")) throw e;
    const winner = await prisma.fieldSalesOrder.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: EXISTING_SELECT,
    });
    if (!winner) throw e;
    return replayOrConflict(winner, input);
  }
}
