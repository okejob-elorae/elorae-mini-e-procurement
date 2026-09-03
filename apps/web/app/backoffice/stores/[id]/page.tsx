import { notFound, redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getStore, listVisitsForStore, listVisitPhotosForVisits } from "@/lib/stores/queries";
import { getPendingStoreChangeRequest } from "@/lib/store-changes/queries";
import { getStoreOrderSummary, getStoreSentItems } from "@/lib/field-sales/queries";
import { getStoreStockCard } from "@/lib/inventory/store-stock-card";
import { listStoreStocktakes } from "@/lib/stores/stocktake/queries";
import { getInTransitAdminReturnQty } from "@/lib/field-sales/retur/queries";
import { listAssortmentGaps, listAssortmentLines } from "@/lib/stores/assortment/queries";
import { computeStoreCreditExposure } from "@/lib/finance/ar/credit-exposure";
import { getStorePiutangSummary, type StorePiutangSummary } from "@/lib/finance/ar/queries";
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
  const canManageFieldReturns = hasPermission(perms, PERMISSIONS.FIELD_RETURNS_MANAGE);
  const canViewReceivables = hasPermission(perms, PERMISSIONS.RECEIVABLES_VIEW);
  const piutangAsOf = new Date();
  const piutang: StorePiutangSummary | null = canViewReceivables
    ? await getStorePiutangSummary(store.id, piutangAsOf)
    : null;
  const creditExposure =
    store.creditLimit !== null
      ? await computeStoreCreditExposure(prisma, store.id).then((e) => ({ exposure: e.total, headroom: store.creditLimit! - e.total }))
      : null;
  const visits = await listVisitsForStore(store.id, 50);
  const photosByVisit = await listVisitPhotosForVisits(visits.map((v) => v.id));
  const pending = await getPendingStoreChangeRequest(store.id);
  const orders = await getStoreOrderSummary(store.id);
  const sentItems = await getStoreSentItems(store.id);
  const stockCard = store.termsType === "KONSI" ? await getStoreStockCard(store.id) : null;
  const inTransitAdminReturn =
    store.termsType === "KONSI" ? await getInTransitAdminReturnQty(store.id) : { raisedQty: 0, receivedQty: 0 };
  const assortmentGaps = store.termsType === "KONSI" ? await listAssortmentGaps(store.id) : [];
  const stocktakes =
    store.termsType === "KONSI"
      ? await listStoreStocktakes({ storeId: store.id, page: 1, perPage: STOCKTAKE_HISTORY_PAGE_SIZE })
      : null;
  /**
   * The assortment lines are only ever rendered as an editable list for a KONSI store — a PUTUS
   * store's card shows a static explanation instead (see `StoreAssortmentCard`'s `termsType`
   * branch), so there is nothing to fetch there. A viewer with no `stores:manage` never sees the
   * card at all, so the list is skipped for them too.
   */
  const assortmentLines =
    canEdit && store.termsType === "KONSI" ? await listAssortmentLines(store.id) : [];
  /**
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
      canManageFieldReturns={canManageFieldReturns}
      creditExposure={creditExposure}
      piutang={piutang}
      piutangAsOfIso={piutangAsOf.toISOString()}
      pendingChange={pending ? { requestId: pending.id, requestedByLabel: pending.requestedByLabel, proposed: pending.proposed, old: pending.old } : null}
      orders={orders}
      sentItems={sentItems}
      stockCard={
        stockCard
          ? {
              rows: stockCard.rows,
              negativeCount: stockCard.negativeCount,
              inTransitAdminReturn,
              movements: stockCard.movements.map(({ occurredAt, ...m }) => ({ ...m, occurredAtIso: occurredAt.toISOString() })),
              gaps: assortmentGaps,
            }
          : null
      }
      assortment={
        canEdit
          ? {
              lines: assortmentLines.map(({ createdAt, ...line }) => ({ ...line, createdAtIso: createdAt.toISOString() })),
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
