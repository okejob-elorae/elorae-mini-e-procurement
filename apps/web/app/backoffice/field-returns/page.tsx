import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canViewFieldReturns } from "@/lib/field-sales/retur/access";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listFieldReturns, type FieldReturnOrigin, type FieldReturnStatus } from "@/lib/field-sales/retur/queries";
import { FieldReturnsPageClient } from "./FieldReturnsPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    q?: string;
    origin?: string;
    creditFilter?: string;
    status?: string;
    page?: string;
    pageSize?: string;
  }>;
};

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set(["FIELD", "ADMIN"]);
const ALLOWED_CREDIT_FILTERS: ReadonlySet<string> = new Set(["AVAILABLE", "APPLIED"]);

/* The "hide cancelled" view (every status except CANCELLED); any other value is a single status. */
const OPEN_STATUS_FILTER = "ACTIVE";
const STATUS_RECORD: Record<FieldReturnStatus, true> = {
  PENDING_WAREHOUSE_RECEIVING: true,
  MISMATCH_PENDING_RESOLUTION: true,
  PENDING_APPROVAL: true,
  APPROVED: true,
  CANCELLED: true,
};
const ALLOWED_STATUSES = Object.keys(STATUS_RECORD) as FieldReturnStatus[];

function parseStatusFilter(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (raw === OPEN_STATUS_FILTER || (ALLOWED_STATUSES as readonly string[]).includes(raw)) return raw;
  return undefined;
}

function parsePageSize(raw: string | undefined): number {
  const n = parseInt(raw ?? "", 10);
  return ALLOWED_PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

function parseOrigin(raw: string | undefined): FieldReturnOrigin | undefined {
  return raw && ALLOWED_ORIGINS.has(raw) ? (raw as FieldReturnOrigin) : undefined;
}

function parseCreditFilter(raw: string | undefined): "AVAILABLE" | "APPLIED" | undefined {
  return raw && ALLOWED_CREDIT_FILTERS.has(raw) ? (raw as "AVAILABLE" | "APPLIED") : undefined;
}

export default async function FieldReturnsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!canViewFieldReturns(session.user.permissions ?? [])) redirect("/backoffice");

  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const origin = parseOrigin(sp.origin);
  const creditFilter = parseCreditFilter(sp.creditFilter);
  const status = parseStatusFilter(sp.status);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = parsePageSize(sp.pageSize);

  const { rows, total } = await listFieldReturns({
    q,
    origin,
    creditFilter,
    ...(status === OPEN_STATUS_FILTER
      ? { excludeStatuses: ["CANCELLED" as const] }
      : status !== undefined
        ? { statuses: [status as FieldReturnStatus] }
        : {}),
    page,
    perPage: pageSize,
  });

  return (
    <FieldReturnsPageClient
      rows={rows}
      total={total}
      q={q ?? ""}
      origin={origin ?? ""}
      creditFilter={creditFilter ?? ""}
      status={status ?? ""}
      page={page}
      pageSize={pageSize}
    />
  );
}
