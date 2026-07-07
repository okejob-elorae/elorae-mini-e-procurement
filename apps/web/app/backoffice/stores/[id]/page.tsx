import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getStore, listVisitsForStore, listVisitPhotosForVisits } from "@/lib/stores/queries";
import { getPendingStoreChangeRequest } from "@/lib/store-changes/queries";
import { StoreDetailView } from "./StoreDetailView";

export default async function EditStorePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const store = await getStore(id);
  if (!store) notFound();

  const canEdit = hasPermission(perms, PERMISSIONS.STORES_MANAGE);
  const visits = await listVisitsForStore(store.id, 50);
  const photosByVisit = await listVisitPhotosForVisits(visits.map((v) => v.id));
  const pending = await getPendingStoreChangeRequest(store.id);

  return (
    <StoreDetailView
      store={store}
      canEdit={canEdit}
      pendingChange={pending ? { requestId: pending.id, requestedByLabel: pending.requestedByLabel, proposed: pending.proposed, old: pending.old } : null}
      visits={visits.map(v => ({
        id: v.id,
        checkinAtIso: v.checkinAt.toISOString(),
        checkoutAtIso: v.checkoutAt ? v.checkoutAt.toISOString() : null,
        checkinLat: v.checkinLat,
        checkinLng: v.checkinLng,
        autoClosed: v.autoClosed,
        userLabel: v.user.name ?? v.user.email,
        photos: (photosByVisit.get(v.id) ?? []).map(p => ({
          id: p.id, url: p.url, caption: p.caption, capturedAtIso: p.capturedAt.toISOString(),
        })),
      }))}
    />
  );
}
