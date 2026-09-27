import { notFound, redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getStore } from "@/lib/stores/queries";
import {
  listStoreGapSuggestions,
  listStoreNeverSentSuggestions,
  type KonsiAssortmentGapSuggestion,
  type KonsiSuggestion,
} from "@/lib/field-sales/queries";
import { listSellThroughSalesmanCandidates, defaultSellThroughSalesmanId } from "@/lib/konsi-sell-through/salesman-candidates";
import { isStockableVariantKey } from "@/lib/items/variants";
import { KonsiPushForm } from "./KonsiPushForm";

export default async function KonsiPushPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) redirect("/backoffice");

  const { id } = await params;
  const store = await getStore(id);
  if (!store || store.termsType !== "KONSI" || !store.isActive) notFound();

  /**
   * The suggestions are a convenience, so a failing suggestion query degrades to an empty list and
   * a muted note rather than taking the page down — the admin can still add products by hand. The
   * salesman list is not optional (nothing can be submitted without one), so its failure stays fatal.
   */
  const [[gapsResult, neverSentResult], salesmen, defaultSalesmanId] = await Promise.all([
    Promise.allSettled([listStoreGapSuggestions(store.id), listStoreNeverSentSuggestions(store.id)]),
    listSellThroughSalesmanCandidates(),
    defaultSellThroughSalesmanId(store.id),
  ]);
  if (gapsResult.status === "rejected") {
    console.error("[konsi-push] listStoreGapSuggestions failed", { storeId: store.id, error: gapsResult.reason });
  }
  if (neverSentResult.status === "rejected") {
    console.error("[konsi-push] listStoreNeverSentSuggestions failed", { storeId: store.id, error: neverSentResult.reason });
  }

  const gaps = gapsResult.status === "fulfilled" ? gapsResult.value : [];
  const neverSent = neverSentResult.status === "fulfilled" ? neverSentResult.value : [];
  const [stageableGaps, stageableNeverSent] = await filterStageableSuggestions(gaps, neverSent);

  return (
    <KonsiPushForm
      store={{ id: store.id, name: store.name }}
      gaps={stageableGaps}
      neverSent={stageableNeverSent}
      gapsFailed={gapsResult.status === "rejected"}
      neverSentFailed={neverSentResult.status === "rejected"}
      salesmen={salesmen}
      defaultSalesmanId={defaultSalesmanId}
    />
  );
}

/**
 * The writer refuses a `""` row for an item with SKU variants (it would reserve against a pooled
 * variantless row the per-variant paths never see) and a non-empty row that names no real variant
 * SKU — both `NO_INVENTORY`. Either list can surface such a row: the never-sent core builds from
 * raw `InventoryValue` rows, so a variant item stocked only on a pooled `null` row shows up as a
 * `""` suggestion, and a gap row can name a stale SKU on an item whose variants changed since the
 * assortment line was set. Dropping them here, through the same `isStockableVariantKey` predicate
 * the writer enforces, means a ticked row can never come back refused.
 */
async function filterStageableSuggestions(
  gaps: KonsiAssortmentGapSuggestion[],
  neverSent: KonsiSuggestion[],
): Promise<[KonsiAssortmentGapSuggestion[], KonsiSuggestion[]]> {
  const itemIds = Array.from(new Set([...gaps.map((g) => g.itemId), ...neverSent.map((n) => n.itemId)]));
  if (itemIds.length === 0) return [gaps, neverSent];

  const items = await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, variants: true } });
  const variantsByItemId = new Map(items.map((i) => [i.id, i.variants]));
  const stageable = (itemId: string, variantSku: string) => isStockableVariantKey(variantsByItemId.get(itemId), variantSku);

  return [
    gaps.filter((g) => stageable(g.itemId, g.variantSku)),
    neverSent.filter((n) => stageable(n.itemId, n.variantSku)),
  ];
}
