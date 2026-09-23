import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getStoreStocktakeById } from "@/lib/stores/stocktake/queries";
import { getStore } from "@/lib/stores/queries";
import { getSellThroughEligibility } from "@/lib/konsi-sell-through/queries";
import { StocktakeDetailClient } from "./StocktakeDetailClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function StoreStocktakeDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const stocktake = await getStoreStocktakeById(id);
  if (!stocktake) notFound();

  const canManage = hasPermission(perms, PERMISSIONS.STORES_MANAGE);

  /**
   * Only fetched for an APPROVED stocktake of a KONSI store — the only combination the
   * sell-through feature applies to. Anywhere else (open stocktake, PUTUS store) the report
   * card renders nothing, rather than surfacing a "not eligible" reason for a case that was
   * never actionable in the first place.
   */
  let sellThroughEligibility: Awaited<ReturnType<typeof getSellThroughEligibility>> | null = null;
  if (stocktake.status === "APPROVED") {
    const store = await getStore(stocktake.storeId);
    if (store?.termsType === "KONSI") {
      sellThroughEligibility = await getSellThroughEligibility(stocktake.id);
    }
  }

  return (
    <StocktakeDetailClient
      stocktake={stocktake}
      canManage={canManage}
      sellThroughEligibility={sellThroughEligibility}
    />
  );
}
