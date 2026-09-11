import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listPendingCollections, getCollectionSubmission, listCollectorCandidates } from "@/lib/finance/collections/queries";
import { listStoreOptions } from "@/lib/stores/queries";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { CollectionsQueuePageClient, type CollectionQueueRow } from "./CollectionsQueuePageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    collectorId?: string;
    storeId?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
};

export default async function CollectionsQueuePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.COLLECTIONS_MANAGE)) {
    redirect("/backoffice");
  }
  const canVerify = hasPermission(permissions, PERMISSIONS.PAYMENTS_MANAGE);

  const sp = await searchParams;
  const collectorId = sp.collectorId?.trim() || undefined;
  const storeId = sp.storeId?.trim() || undefined;
  const dateFrom = parseDateOnly(sp.from ?? "");
  const dateTo = parseDateOnlyEnd(sp.to ?? "");
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = DEFAULT_PAGE_SIZE;

  try {
    const [{ rows, total }, collectors, storeOptions] = await Promise.all([
      listPendingCollections({ collectorId, storeId, dateFrom, dateTo, page, pageSize }),
      listCollectorCandidates(),
      listStoreOptions(),
    ]);

    /**
     * `listPendingCollections` deliberately omits the proof photo, note and live outstanding —
     * those only exist on `getCollectionSubmission`. The queue page is where the proof photo has
     * to be viewable per row, so read the detail for every row on this page (bounded by
     * `pageSize`) rather than adding a client round trip for it.
     */
    const details = await Promise.all(rows.map((r) => getCollectionSubmission(r.id)));

    const queueRows: CollectionQueueRow[] = rows.map((r, i) => {
      const d = details[i];
      return {
        id: r.id,
        receivableId: r.receivableId,
        storeName: r.storeName,
        docNo: r.docNo,
        collectorName: r.collectorName,
        amount: r.amount,
        method: r.method,
        paidAt: r.paidAt,
        createdAt: r.createdAt,
        note: d?.note ?? null,
        proofUrl: d?.proofUrl ?? null,
        liveOutstanding: d?.liveOutstanding ?? r.amount,
      };
    });

    return (
      <CollectionsQueuePageClient
        rows={queueRows}
        total={total}
        collectors={collectors}
        storeOptions={storeOptions}
        collectorId={collectorId ?? ""}
        storeId={storeId ?? ""}
        dateFrom={sp.from ?? ""}
        dateTo={sp.to ?? ""}
        page={page}
        pageSize={pageSize}
        canVerify={canVerify}
        loadError={false}
      />
    );
  } catch (err) {
    /**
     * The error card is the only user-facing signal, and it names no cause — without this the
     * container log holds nothing at all about why the page is blank.
     */
    console.error("[collections-queue] list query failed", err);
    return (
      <CollectionsQueuePageClient
        rows={[]}
        total={0}
        collectors={[]}
        storeOptions={[]}
        collectorId={collectorId ?? ""}
        storeId={storeId ?? ""}
        dateFrom={sp.from ?? ""}
        dateTo={sp.to ?? ""}
        page={page}
        pageSize={pageSize}
        canVerify={canVerify}
        loadError={true}
      />
    );
  }
}
