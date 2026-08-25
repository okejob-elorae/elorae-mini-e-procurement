import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listStoreStocktakes, type StoreStocktakeStatusValue } from "@/lib/stores/stocktake/queries";
import { StoreStocktakesPageClient } from "./StoreStocktakesPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    q?: string;
    status?: string;
    page?: string;
    pageSize?: string;
  }>;
};

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];
const STATUS_VALUES: ReadonlySet<string> = new Set(["DRAFT", "PENDING_VERIFICATION", "APPROVED", "CANCELLED"]);

function parsePageSize(raw: string | undefined): number {
  const n = parseInt(raw ?? "", 10);
  return ALLOWED_PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

function parseStatus(raw: string | undefined): StoreStocktakeStatusValue | undefined {
  return raw && STATUS_VALUES.has(raw) ? (raw as StoreStocktakeStatusValue) : undefined;
}

export default async function StoreStocktakesPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const status = parseStatus(sp.status);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = parsePageSize(sp.pageSize);

  const { rows, total } = await listStoreStocktakes({ q, status, page, perPage: pageSize });

  return (
    <StoreStocktakesPageClient
      rows={rows}
      total={total}
      q={q ?? ""}
      status={status ?? ""}
      page={page}
      pageSize={pageSize}
    />
  );
}
