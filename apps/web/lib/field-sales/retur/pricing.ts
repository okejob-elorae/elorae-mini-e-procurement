import type { Prisma, PrismaClient } from "@elorae/db";
import { matchKey } from "@/lib/items/variant-rows";
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
    const candidate = toPriceCandidate(r);
    if (candidate) out.push(candidate);
  }
  return out;
}

/**
 * One call for many (store, item, variant) keys, for a list screen that would otherwise fire one
 * `listPriceCandidates` per line. Each key's candidates are exactly what `listPriceCandidates`
 * returns for it, in the same order. The variant is matched case-insensitively, like the
 * per-line query, whose column sits on a case-insensitive collation.
 */
export async function listPriceCandidatesForKeys(
  client: PrismaClientOrTx,
  keys: Array<{ storeId: string; itemId: string; variantSku: string }>,
): Promise<Map<string, PriceCandidate[]>> {
  const out = new Map<string, PriceCandidate[]>();
  if (keys.length === 0) return out;

  const wanted = new Set(keys.map((k) => priceCandidateKey(k)));
  const rows = await client.fieldSalesDeliveryLine.findMany({
    where: {
      itemId: { in: Array.from(new Set(keys.map((k) => k.itemId))) },
      delivery: { order: { storeId: { in: Array.from(new Set(keys.map((k) => k.storeId))) } } },
    },
    select: {
      id: true,
      itemId: true,
      variantSku: true,
      deliveryId: true,
      qty: true,
      lineTotal: true,
      delivery: { select: { docNo: true, deliveredAt: true, order: { select: { storeId: true } } } },
    },
    orderBy: { delivery: { deliveredAt: "desc" } },
  });

  for (const r of rows) {
    const key = priceCandidateKey({
      storeId: r.delivery.order.storeId,
      itemId: r.itemId,
      variantSku: r.variantSku,
    });
    if (!wanted.has(key)) continue;
    const candidate = toPriceCandidate(r);
    if (!candidate) continue;
    const bucket = out.get(key);
    if (bucket) bucket.push(candidate);
    else out.set(key, [candidate]);
  }
  return out;
}

/** Grouping key shared by `listPriceCandidatesForKeys` and its callers. */
export function priceCandidateKey(input: { storeId: string; itemId: string; variantSku: string }): string {
  return `${input.storeId}::${input.itemId}::${matchKey(input.variantSku)}`;
}

function toPriceCandidate(r: {
  id: string;
  deliveryId: string;
  qty: number;
  lineTotal: Prisma.Decimal | null;
  delivery: { docNo: string; deliveredAt: Date };
}): PriceCandidate | null {
  if (r.lineTotal === null) return null;
  const unitPrice = effectiveUnitPrice(r.lineTotal.toNumber(), r.qty);
  if (unitPrice === null) return null;
  return {
    deliveryLineId: r.id,
    deliveryId: r.deliveryId,
    docNo: r.delivery.docNo,
    deliveredAt: r.delivery.deliveredAt,
    qty: r.qty,
    lineTotal: r.lineTotal.toNumber(),
    unitPrice,
  };
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
