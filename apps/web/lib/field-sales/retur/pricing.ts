import type { Prisma, PrismaClient } from "@elorae/db";
import { matchKey } from "@/lib/items/variant-rows";
import { deliveredLineNetValues } from "@/lib/field-sales/delivery/undelivered-residual";
import { effectiveUnitPrice, classifyPriceCandidates } from "./pricing-rules";

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

export type PriceCandidate = {
  deliveryLineId: string;
  deliveryId: string;
  docNo: string;
  deliveredAt: Date;
  qty: number;
  /** The line's NET delivered value — what the store was billed for it, exact to the sen. */
  netValue: number;
  unitPrice: number;
};

/**
 * What a price read needs from one delivery line: its own figures, plus its delivery's header
 * discount and every sibling line, because the line's share of the order discount is allocated
 * across the whole delivery. Siblings come ordered by id so the allocation's tie-break is stable.
 */
const PRICED_DELIVERY_LINE_SELECT = {
  id: true,
  deliveryId: true,
  qty: true,
  lineTotal: true,
  discountAmount: true,
} as const;

const PRICED_DELIVERY_SELECT = {
  docNo: true,
  deliveredAt: true,
  discountAmount: true,
  lines: { select: { id: true, lineTotal: true, discountAmount: true }, orderBy: { id: "asc" } },
} as const;

type PricedDeliveryLineRow = {
  id: string;
  deliveryId: string;
  qty: number;
  lineTotal: Prisma.Decimal | null;
  discountAmount: Prisma.Decimal;
  delivery: {
    docNo: string;
    deliveredAt: Date;
    discountAmount: Prisma.Decimal;
    lines: Array<{ id: string; lineTotal: Prisma.Decimal | null; discountAmount: Prisma.Decimal }>;
  };
};

/**
 * Every delivery line that shipped this exact item + variant to this store, newest delivery
 * first, priced from the line's NET delivered value (`deliveredLineNetValues`: gross `lineTotal`
 * less the line's own discount and its share of the delivery's order discount) rather than the
 * gross `lineTotal` or `unitPrice`. A null lineTotal is a line that cannot price anything and is
 * skipped rather than credited at zero.
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
      ...PRICED_DELIVERY_LINE_SELECT,
      delivery: { select: PRICED_DELIVERY_SELECT },
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
      ...PRICED_DELIVERY_LINE_SELECT,
      itemId: true,
      variantSku: true,
      delivery: { select: { ...PRICED_DELIVERY_SELECT, order: { select: { storeId: true } } } },
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

function toPriceCandidate(r: PricedDeliveryLineRow): PriceCandidate | null {
  const net = netDeliveryLineValue(r);
  if (net === null) return null;
  const unitPrice = effectiveUnitPrice(net, r.qty);
  if (unitPrice === null) return null;
  return {
    deliveryLineId: r.id,
    deliveryId: r.deliveryId,
    docNo: r.delivery.docNo,
    deliveredAt: r.delivery.deliveredAt,
    qty: r.qty,
    netValue: net,
    unitPrice,
  };
}

/**
 * The line's net delivered value, or null when it cannot price anything: a null `lineTotal`, or a
 * net below zero (a line discount larger than the line's own goods after its order-discount
 * share), which would credit the store a negative amount and is left for an admin to price.
 */
function netDeliveryLineValue(r: PricedDeliveryLineRow): number | null {
  if (r.lineTotal === null) return null;
  const nets = deliveredLineNetValues({
    discountAmount: r.delivery.discountAmount.toNumber(),
    lines: r.delivery.lines.map((l) => ({
      lineTotal: l.lineTotal === null ? 0 : l.lineTotal.toNumber(),
      discountAmount: l.discountAmount.toNumber(),
    })),
  });
  const index = r.delivery.lines.findIndex((l) => l.id === r.id);
  if (index === -1) return null;
  const net = nets[index];
  return net < 0 ? null : net;
}

/**
 * The per-unit credit price of ONE named delivery line, by the same rule `listPriceCandidates`
 * applies: null when the line is gone or cannot price anything. For a caller that already holds
 * an admin's chosen `priceDeliveryLineId` and must not re-scope it by store, item and variant.
 */
export async function deliveryLineUnitPrice(
  client: PrismaClientOrTx,
  deliveryLineId: string,
): Promise<number | null> {
  const row = await client.fieldSalesDeliveryLine.findUnique({
    where: { id: deliveryLineId },
    select: { ...PRICED_DELIVERY_LINE_SELECT, delivery: { select: PRICED_DELIVERY_SELECT } },
  });
  if (!row) return null;
  const candidate = toPriceCandidate(row);
  return candidate === null ? null : candidate.unitPrice;
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
