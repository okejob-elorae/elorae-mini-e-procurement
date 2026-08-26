import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listReceivables } from "@/lib/finance/ar/queries";
import { listStoreOptions } from "@/lib/stores/queries";
import { listCanvassers } from "@/lib/canvassing/queries";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { AGING_BUCKETS, type AgingBucket } from "@/lib/finance/ar/aging";
import { PiutangPageClient } from "./PiutangPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    storeId?: string;
    salesmanId?: string;
    status?: string;
    bucket?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
};

const STATUS_VALUES = ["OUTSTANDING", "PARTIAL", "PAID", "WRITTEN_OFF"] as const;

function parseStatus(raw: string | undefined): (typeof STATUS_VALUES)[number] | undefined {
  return raw && (STATUS_VALUES as readonly string[]).includes(raw)
    ? (raw as (typeof STATUS_VALUES)[number])
    : undefined;
}

function parseBucket(raw: string | undefined): AgingBucket | undefined {
  return raw && (AGING_BUCKETS as readonly string[]).includes(raw) ? (raw as AgingBucket) : undefined;
}

function emptyBucketTotals(): Record<AgingBucket, number> {
  return AGING_BUCKETS.reduce((acc, b) => ({ ...acc, [b]: 0 }), {} as Record<AgingBucket, number>);
}

export default async function PiutangPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.RECEIVABLES_VIEW)) {
    redirect("/backoffice");
  }

  const sp = await searchParams;
  const storeId = sp.storeId?.trim() || undefined;
  const salesmanId = sp.salesmanId?.trim() || undefined;
  const status = parseStatus(sp.status);
  const bucket = parseBucket(sp.bucket);
  const dateFrom = parseDateOnly(sp.from ?? "");
  const dateTo = parseDateOnlyEnd(sp.to ?? "");
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = DEFAULT_PAGE_SIZE;
  /**
   * Read once and threaded through both the query and the client, so the table's per-row
   * `isOverdue` colouring is computed against the exact same instant the server used for
   * `daysOverdue` and the aging buckets — never a fresh `new Date()` on the client.
   */
  const asOf = new Date();

  try {
    const [{ rows, total, bucketTotals, grandOutstanding }, storeOptions, canvassers] = await Promise.all([
      listReceivables({ storeId, salesmanId, status, bucket, dateFrom, dateTo, page, pageSize, asOf }),
      listStoreOptions(),
      listCanvassers(),
    ]);

    return (
      <PiutangPageClient
        rows={rows}
        total={total}
        bucketTotals={bucketTotals}
        grandOutstanding={grandOutstanding}
        storeOptions={storeOptions}
        salesmen={canvassers.map((c) => ({ id: c.id, name: c.name }))}
        storeId={storeId ?? ""}
        salesmanId={salesmanId ?? ""}
        status={status ?? "ALL"}
        bucket={bucket}
        dateFrom={sp.from ?? ""}
        dateTo={sp.to ?? ""}
        page={page}
        pageSize={pageSize}
        asOf={asOf}
        loadError={false}
      />
    );
  } catch (err) {
    /**
     * The error card is the only user-facing signal, and it names no cause — without this the
     * container log holds nothing at all about why the page is blank.
     */
    console.error("[piutang] list query failed", err);
    return (
      <PiutangPageClient
        rows={[]}
        total={0}
        bucketTotals={emptyBucketTotals()}
        grandOutstanding={0}
        storeOptions={[]}
        salesmen={[]}
        storeId={storeId ?? ""}
        salesmanId={salesmanId ?? ""}
        status={status ?? "ALL"}
        bucket={bucket}
        dateFrom={sp.from ?? ""}
        dateTo={sp.to ?? ""}
        page={page}
        pageSize={pageSize}
        asOf={asOf}
        loadError={true}
      />
    );
  }
}
