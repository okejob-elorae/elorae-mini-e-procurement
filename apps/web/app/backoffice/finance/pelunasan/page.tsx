import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import {
  listSettlementQueue,
  listSettlementSalesmanCandidates,
  type SettlementStatusValue,
} from "@/lib/finance/ar-settlement/queries";
import { listStoreOptions } from "@/lib/stores/queries";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { SettlementQueuePageClient } from "./SettlementQueuePageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    storeId?: string;
    salesmanId?: string;
    status?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
};

const STATUS_VALUES = ["PENDING", "APPROVED", "REJECTED"] as const;

/**
 * The queue exists for the `PENDING` backlog, so an absent `status` param means `PENDING` rather
 * than "everything" — but an APPROVED document still has to be reachable, since its detail view is
 * the only place the variance-override reason is readable. `ALL` is therefore an explicit choice,
 * not the default.
 */
function parseStatus(raw: string | undefined): SettlementStatusValue | "ALL" {
  if (raw === "ALL") return "ALL";
  if (raw && (STATUS_VALUES as readonly string[]).includes(raw)) return raw as SettlementStatusValue;
  return "PENDING";
}

export default async function SettlementQueuePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.COLLECTIONS_MANAGE)) {
    redirect("/backoffice");
  }

  const sp = await searchParams;
  const storeId = sp.storeId?.trim() || undefined;
  const salesmanId = sp.salesmanId?.trim() || undefined;
  const status = parseStatus(sp.status);
  const dateFrom = parseDateOnly(sp.from ?? "");
  const dateTo = parseDateOnlyEnd(sp.to ?? "");
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = DEFAULT_PAGE_SIZE;

  try {
    const [{ rows, total }, salesmen, storeOptions] = await Promise.all([
      listSettlementQueue({
        storeId,
        salesmanId,
        status: status === "ALL" ? undefined : status,
        dateFrom,
        dateTo,
        page,
        pageSize,
      }),
      listSettlementSalesmanCandidates(),
      listStoreOptions(),
    ]);

    return (
      <SettlementQueuePageClient
        rows={rows}
        total={total}
        salesmen={salesmen}
        storeOptions={storeOptions}
        storeId={storeId ?? ""}
        salesmanId={salesmanId ?? ""}
        status={status}
        dateFrom={sp.from ?? ""}
        dateTo={sp.to ?? ""}
        page={page}
        pageSize={pageSize}
        loadError={false}
      />
    );
  } catch (err) {
    /**
     * The error card is the only user-facing signal, and it names no cause — without this the
     * container log holds nothing at all about why the page is blank.
     */
    console.error("[settlement-queue] list query failed", err);
    return (
      <SettlementQueuePageClient
        rows={[]}
        total={0}
        salesmen={[]}
        storeOptions={[]}
        storeId={storeId ?? ""}
        salesmanId={salesmanId ?? ""}
        status={status}
        dateFrom={sp.from ?? ""}
        dateTo={sp.to ?? ""}
        page={page}
        pageSize={pageSize}
        loadError={true}
      />
    );
  }
}
