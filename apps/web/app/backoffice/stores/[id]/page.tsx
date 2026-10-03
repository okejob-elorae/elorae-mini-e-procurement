import { notFound, redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getStore, listVisitsForStore, listVisitPhotosForVisits } from "@/lib/stores/queries";
import { detailKunjunganToko } from "@/lib/stores/visit-queries";
import { getPendingStoreChangeRequest } from "@/lib/store-changes/queries";
import { getStoreOrderSummary, getStoreSentItems } from "@/lib/field-sales/queries";
import { formatDisplayDateTime } from "@/lib/date-only";
import { stokToko } from "@/lib/spg/queries";
import { gerakanStokToko } from "@/lib/spg/kantor-queries";
import { StoreDetailView } from "./StoreDetailView";
import { catatanTokoUntuk } from "@/lib/stores/catatan-queries";

export default async function StoreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const store = await getStore(id);
  if (!store) notFound();

  const canEdit = hasPermission(perms, PERMISSIONS.STORES_MANAGE);
  const visits = await listVisitsForStore(store.id, 50);
  const [photosByVisit, detailKunjungan] = await Promise.all([
    listVisitPhotosForVisits(visits.map((v) => v.id)),
    detailKunjunganToko(visits.map((v) => v.id)),
  ]);
  const pending = await getPendingStoreChangeRequest(store.id);
  const orders = await getStoreOrderSummary(store.id);
  const sentItems = await getStoreSentItems(store.id);
  const [area, pemegang, stok, gerakan] = await Promise.all([
    store.groupId ? prisma.storeGroup.findUnique({ where: { id: store.groupId }, select: { code: true, name: true } }) : null,
    store.salesmanId ? prisma.user.findUnique({ where: { id: store.salesmanId }, select: { name: true, email: true } }) : null,
    // Buku stok toko (gerakan SPG). Toko tanpa SPG hanya mendapat keterangan kosong.
    stokToko(store.id),
    gerakanStokToko(store.id, 30),
  ]);

  // stores:view (dijaga di atas) = baca & tambah catatan; stores:manage = kelola semua catatan.
  const catatan = await catatanTokoUntuk(store.id, { userId: session.user.id ?? "", kelolaSemua: canEdit });

  return (
    <StoreDetailView
      store={store}
      canEdit={canEdit}
      catatan={catatan}
      pendingChange={pending ? { requestId: pending.id, requestedByLabel: pending.requestedByLabel, proposed: pending.proposed, old: pending.old } : null}
      orders={orders}
      sentItems={sentItems}
      stokToko={{
        stok,
        // Waktu diformat di server: format tanggal browser dan Node bisa berbeda.
        gerakan: gerakan.map((g) => ({ ...g, waktu: formatDisplayDateTime(g.waktu) })),
      }}
      pembagian={{
        area: area ? `${area.code} — ${area.name}` : null,
        pemegang: pemegang ? pemegang.name ?? pemegang.email : null,
      }}
      visits={visits.map(v => ({
        id: v.id,
        checkinAtIso: v.checkinAt.toISOString(),
        checkoutAtIso: v.checkoutAt ? v.checkoutAt.toISOString() : null,
        checkinLat: v.checkinLat,
        checkinLng: v.checkinLng,
        autoClosed: v.autoClosed,
        userLabel: v.user.name ?? v.user.email,
        checkinOutOfRadius: v.checkinOutOfRadius,
        checkinDistanceMeters: v.checkinDistanceMeters,
        hasil: detailKunjungan.get(v.id) ?? null,
        photos: (photosByVisit.get(v.id) ?? []).map(p => ({
          id: p.id, url: p.url, caption: p.caption, capturedAtIso: p.capturedAt.toISOString(),
        })),
      }))}
    />
  );
}
