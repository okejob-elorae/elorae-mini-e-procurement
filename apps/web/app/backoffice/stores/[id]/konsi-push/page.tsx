import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getStore } from "@/lib/stores/queries";
import { listStoreGapSuggestions, listStoreNeverSentSuggestions } from "@/lib/field-sales/queries";
import { listSellThroughSalesmanCandidates, defaultSellThroughSalesmanId } from "@/lib/konsi-sell-through/salesman-candidates";
import { KonsiPushForm } from "./KonsiPushForm";

export default async function KonsiPushPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) redirect("/backoffice");

  const { id } = await params;
  const store = await getStore(id);
  if (!store || store.termsType !== "KONSI" || !store.isActive) notFound();

  const [gaps, neverSent, salesmen, defaultSalesmanId] = await Promise.all([
    listStoreGapSuggestions(store.id),
    listStoreNeverSentSuggestions(store.id),
    listSellThroughSalesmanCandidates(),
    defaultSellThroughSalesmanId(store.id),
  ]);

  return (
    <KonsiPushForm
      store={{ id: store.id, name: store.name }}
      gaps={gaps}
      neverSent={neverSent}
      salesmen={salesmen}
      defaultSalesmanId={defaultSalesmanId}
    />
  );
}
