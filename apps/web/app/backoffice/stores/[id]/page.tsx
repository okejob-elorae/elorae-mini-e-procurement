import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getStore, listVisitsForStore, listVisitPhotosForVisits } from "@/lib/stores/queries";
import { getPendingStoreChangeRequest } from "@/lib/store-changes/queries";
import { getStoreOrderSummary, getStoreSentItems } from "@/lib/field-sales/queries";
import { getStoreStockCard } from "@/lib/inventory/store-stock-card";
import { listStoreStocktakes } from "@/lib/stores/stocktake/queries";
import { StoreDetailView } from "./StoreDetailView";

const STOCKTAKE_HISTORY_PAGE_SIZE = 10;
const OPEN_STOCKTAKE_STATUSES = new Set(["DRAFT", "PENDING_VERIFICATION"]);

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
  const photosByVisit = await listVisitPhotosForVisits(visits.map((v) => v.id));
  const pending = await getPendingStoreChangeRequest(store.id);
  const orders = await getStoreOrderSummary(store.id);
  const sentItems = await getStoreSentItems(store.id);
  const stockCard = store.termsType === "KONSI" ? await getStoreStockCard(store.id) : null;
  const stocktakes =
    store.termsType === "KONSI"
      ? await listStoreStocktakes({ storeId: store.id, page: 1, perPage: STOCKTAKE_HISTORY_PAGE_SIZE })
      : null;
  /*
   * A store can only ever have ONE open (DRAFT / PENDING_VERIFICATION) document at a time —
   * `openKey`'s unique constraint enforces that, and creating a new one is refused while one is
   * already open. That means the open document, if any, is always the most recently created row
   * — the first one in this desc-by-createdAt page — so no second query is needed to find it.
   */
  const openStocktakeId =
    stocktakes && stocktakes.rows[0] && OPEN_STOCKTAKE_STATUSES.has(stocktakes.rows[0].status)
      ? stocktakes.rows[0].id
      : null;

  return (
    <StoreDetailView
      store={store}
      canEdit={canEdit}
      pendingChange={pending ? { requestId: pending.id, requestedByLabel: pending.requestedByLabel, proposed: pending.proposed, old: pending.old } : null}
      orders={orders}
      sentItems={sentItems}
      stockCard={
        stockCard
          ? {
              rows: stockCard.rows,
              negativeCount: stockCard.negativeCount,
              movements: stockCard.movements.map(({ occurredAt, ...m }) => ({ ...m, occurredAtIso: occurredAt.toISOString() })),
            }
          : null
      }
      stocktakes={
        stocktakes
          ? {
              rows: stocktakes.rows.map((s) => ({
                id: s.id,
                docNo: s.docNo,
                status: s.status,
                countedAtIso: s.countedAt.toISOString(),
                lineCount: s.lineCount,
                countedLineCount: s.countedLineCount,
              })),
              total: stocktakes.total,
              openId: openStocktakeId,
            }
          : null
      }
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
        photos: (photosByVisit.get(v.id) ?? []).map(p => ({
          id: p.id, url: p.url, caption: p.caption, capturedAtIso: p.capturedAt.toISOString(),
        })),
      }))}
    />
  );
}
