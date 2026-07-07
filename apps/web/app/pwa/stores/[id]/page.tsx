import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getStore, listVisitsForStore, getActiveVisit, listVisitPhotos } from "@/lib/stores/queries";
import { getPendingStoreChangeRequest } from "@/lib/store-changes/queries";
import { StoreDetailShell } from "./StoreDetailShell";

export const dynamic = "force-dynamic";

export default async function PwaStoreDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const { id } = await params;
  const store = await getStore(id);
  if (!store) notFound();

  const [active, history] = await Promise.all([
    getActiveVisit(session.user.id),
    listVisitsForStore(store.id, 20),
  ]);

  const activeForStore = active && active.storeId === store.id ? active : null;
  const activePhotos = activeForStore ? await listVisitPhotos(activeForStore.id) : [];
  const pending = await getPendingStoreChangeRequest(store.id);

  return (
    <StoreDetailShell
      store={{
        id: store.id,
        code: store.code,
        name: store.name,
        address: store.address,
        phone: store.phone,
        contactName: store.contactName,
        termsType: store.termsType,
        paymentTempo: store.paymentTempo,
        marginPercent: store.marginPercent,
        lat: store.lat,
        lng: store.lng,
      }}
      active={active ? {
        id: active.id,
        storeId: active.storeId,
        storeName: active.store.name,
      } : null}
      activePhotos={activePhotos.map((p) => ({
        id: p.id,
        url: p.url,
        caption: p.caption,
        capturedAtIso: p.capturedAt.toISOString(),
      }))}
      history={history.map(v => ({
        id: v.id,
        checkinAtIso: v.checkinAt.toISOString(),
        checkoutAtIso: v.checkoutAt ? v.checkoutAt.toISOString() : null,
        checkinLat: v.checkinLat,
        checkinLng: v.checkinLng,
        autoClosed: v.autoClosed,
        userLabel: v.user.name ?? v.user.email,
      }))}
      pending={pending ? { proposed: pending.proposed, old: pending.old, requestedByLabel: pending.requestedByLabel } : null}
    />
  );
}
