import { notFound, redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getStore } from "@/lib/stores/queries";
import { listStoreGapSuggestions, listStoreNeverSentSuggestions } from "@/lib/field-sales/queries";
import { listSellThroughSalesmanCandidates, defaultSellThroughSalesmanId } from "@/lib/konsi-sell-through/salesman-candidates";
import { filterStageableSuggestions } from "@/lib/field-sales/stageable-suggestions";
import { computeStoreCreditExposure } from "@/lib/finance/ar/credit-exposure";
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

  /**
   * A display preview only, so the form can ask for an override reason up front; the writer
   * re-checks live at submit and is the authority. Exposure alone, never the push's own value,
   * matching the konsi approve gate. Degrades to null rather than taking the page down.
   */
  let creditCheck: { exposure: number; limit: number; overLimit: boolean } | null = null;
  const limit = store.creditLimit;
  if (limit !== null) {
    try {
      const exposure = await computeStoreCreditExposure(prisma, store.id);
      creditCheck = { exposure: exposure.total, limit, overLimit: exposure.total > limit };
    } catch (error) {
      console.error("[konsi-push] credit-limit check failed", { storeId: store.id, error });
    }
  }

  return (
    <KonsiPushForm
      store={{ id: store.id, name: store.name }}
      gaps={stageableGaps}
      neverSent={stageableNeverSent}
      gapsFailed={gapsResult.status === "rejected"}
      neverSentFailed={neverSentResult.status === "rejected"}
      salesmen={salesmen}
      defaultSalesmanId={defaultSalesmanId}
      creditCheck={creditCheck}
    />
  );
}
