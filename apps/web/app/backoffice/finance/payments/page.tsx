import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listPayments } from "@/lib/finance/ar/queries";
import { listStoreOptions } from "@/lib/stores/queries";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { PaymentsPageClient } from "./PaymentsPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    storeId?: string;
    method?: string;
    status?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
};

const METHOD_VALUES = ["CASH", "TRANSFER", "RETUR_OFFSET"] as const;
const STATUS_VALUES = ["POSTED", "VOIDED"] as const;

function parseMethod(raw: string | undefined): (typeof METHOD_VALUES)[number] | undefined {
  return raw && (METHOD_VALUES as readonly string[]).includes(raw) ? (raw as (typeof METHOD_VALUES)[number]) : undefined;
}

function parseStatus(raw: string | undefined): (typeof STATUS_VALUES)[number] | undefined {
  return raw && (STATUS_VALUES as readonly string[]).includes(raw) ? (raw as (typeof STATUS_VALUES)[number]) : undefined;
}

export default async function PaymentsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.PAYMENTS_MANAGE)) {
    redirect("/backoffice");
  }

  const sp = await searchParams;
  const storeId = sp.storeId?.trim() || undefined;
  const method = parseMethod(sp.method);
  const status = parseStatus(sp.status);
  const dateFrom = parseDateOnly(sp.from ?? "");
  const dateTo = parseDateOnlyEnd(sp.to ?? "");
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = DEFAULT_PAGE_SIZE;

  try {
    const [{ rows, total }, storeOptions] = await Promise.all([
      listPayments({ storeId, method, status, dateFrom, dateTo, page, pageSize }),
      listStoreOptions(),
    ]);

    return (
      <PaymentsPageClient
        rows={rows}
        total={total}
        storeOptions={storeOptions}
        storeId={storeId ?? ""}
        method={method ?? "ALL"}
        status={status ?? "ALL"}
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
    console.error("[payments] list query failed", err);
    return (
      <PaymentsPageClient
        rows={[]}
        total={0}
        storeOptions={[]}
        storeId={storeId ?? ""}
        method={method ?? "ALL"}
        status={status ?? "ALL"}
        dateFrom={sp.from ?? ""}
        dateTo={sp.to ?? ""}
        page={page}
        pageSize={pageSize}
        loadError={true}
      />
    );
  }
}
