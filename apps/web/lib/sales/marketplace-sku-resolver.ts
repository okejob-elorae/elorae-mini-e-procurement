import type { PrismaClient } from "@elorae/db";
import { deriveParentSku } from "@/lib/forecast/sku-utils";
import {
  type ErpVariantIndex,
  type ErpVariantRef,
  loadJubelioVariantIndex,
  normalizeOtherSourceSku,
} from "@/lib/reconciliation/umkm-sku-bridge";

export type ResolveConfidence = "EXACT" | "HEURISTIC" | "UNMAPPED";

export interface ResolveInput {
  variantSku: string;
  size?: string;
  channel?: "SHOPEE" | "TIKTOK";
}

export interface ResolveResult {
  itemId: string | null;
  parentItemSku: string | null;
  erpVariantSku: string | null;
  jubelioItemId: number | null;
  confidence: ResolveConfidence;
}

export type ResolutionStatus = "MAPPED" | "UNMAPPED" | "AMBIGUOUS";

export function resolutionStatusFromResolve(
  result: ResolveResult
): ResolutionStatus {
  if (result.itemId) return "MAPPED";
  return "UNMAPPED";
}

function toMappedResult(
  ref: ErpVariantRef,
  confidence: "EXACT" | "HEURISTIC",
  erpVariantSku: string
): ResolveResult {
  return {
    itemId: ref.itemId,
    parentItemSku: ref.parentItemSku,
    erpVariantSku,
    jubelioItemId: ref.jubelioItemId,
    confidence,
  };
}

export function resolveMarketplaceSku(
  input: ResolveInput,
  index: ErpVariantIndex
): ResolveResult {
  const variantSku = input.variantSku.trim();
  if (!variantSku) {
    return {
      itemId: null,
      parentItemSku: null,
      erpVariantSku: null,
      jubelioItemId: null,
      confidence: "UNMAPPED",
    };
  }

  const size = input.size ?? "";

  const directRef =
    index.byErpVariantSku.get(variantSku) ??
    index.byJubelioItemCode.get(variantSku);
  if (directRef) {
    return toMappedResult(directRef, "EXACT", directRef.erpVariantSku);
  }

  const normalized = normalizeOtherSourceSku(variantSku, size, index);
  if (normalized) {
    const ref = index.byErpVariantSku.get(normalized.erpVariantSku);
    if (ref) {
      return toMappedResult(ref, "HEURISTIC", normalized.erpVariantSku);
    }
  }

  return {
    itemId: null,
    parentItemSku: deriveParentSku(variantSku),
    erpVariantSku: normalized?.erpVariantSku ?? null,
    jubelioItemId: null,
    confidence: "UNMAPPED",
  };
}

export function resolveMarketplaceSkuBatch(
  inputs: ResolveInput[],
  index: ErpVariantIndex
): ResolveResult[] {
  return inputs.map((input) => resolveMarketplaceSku(input, index));
}

export { loadJubelioVariantIndex };

export async function loadResolverIndex(
  prisma: PrismaClient
): Promise<ErpVariantIndex> {
  return loadJubelioVariantIndex(prisma);
}
