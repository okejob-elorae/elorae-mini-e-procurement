import type { Prisma, PrismaClient } from "@elorae/db";
import { effectiveUnitPrice, classifyPriceCandidates } from "./pricing-rules";

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

export type PriceCandidate = {
  deliveryLineId: string;
  deliveryId: string;
  docNo: string;
  deliveredAt: Date;
  qty: number;
  lineTotal: number;
  unitPrice: number;
};

/**
 * Every delivery line that shipped this exact item + variant to this store, newest delivery
 * first, priced from lineTotal (net of the line's pro-rated discount and its share of the
 * order discount) rather than the gross unitPrice. A null lineTotal is a line that cannot
 * price anything and is skipped rather than credited at zero.
 */
export async function listPriceCandidates(
  client: PrismaClientOrTx,
  input: { storeId: string; itemId: string; variantSku: string },
): Promise<PriceCandidate[]> {
  const rows = await client.fieldSalesDeliveryLine.findMany({
    where: {
      itemId: input.itemId,
      variantSku: input.variantSku,
      delivery: { order: { storeId: input.storeId } },
    },
    select: {
      id: true,
      deliveryId: true,
      qty: true,
      lineTotal: true,
      delivery: { select: { docNo: true, deliveredAt: true } },
    },
    orderBy: { delivery: { deliveredAt: "desc" } },
  });

  const out: PriceCandidate[] = [];
  for (const r of rows) {
    if (r.lineTotal === null) continue;
    const unitPrice = effectiveUnitPrice(r.lineTotal.toNumber(), r.qty);
    if (unitPrice === null) continue;
    out.push({
      deliveryLineId: r.id,
      deliveryId: r.deliveryId,
      docNo: r.delivery.docNo,
      deliveredAt: r.delivery.deliveredAt,
      qty: r.qty,
      lineTotal: r.lineTotal.toNumber(),
      unitPrice,
    });
  }
  return out;
}

/**
 * Resolves a single credit price for this item + variant at this store: AUTO when every
 * delivery priced it identically, AMBIGUOUS when deliveries disagree (the caller must pick
 * one), UNPRICEABLE when nothing was ever delivered.
 */
export async function resolveLinePrice(
  client: PrismaClientOrTx,
  input: { storeId: string; itemId: string; variantSku: string },
): Promise<
  | { kind: "AUTO"; price: number; candidate: PriceCandidate }
  | { kind: "AMBIGUOUS"; candidates: PriceCandidate[] }
  | { kind: "UNPRICEABLE" }
> {
  const candidates = await listPriceCandidates(client, input);
  const verdict = classifyPriceCandidates(candidates.map((c) => c.unitPrice));
  if (verdict.kind === "AUTO") {
    return { kind: "AUTO", price: verdict.price, candidate: candidates[0] };
  }
  if (verdict.kind === "AMBIGUOUS") {
    return { kind: "AMBIGUOUS", candidates };
  }
  return { kind: "UNPRICEABLE" };
}
