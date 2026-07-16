import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listVanSales } from "@/lib/canvassing/sale-queries";
import { listCanvassers } from "@/lib/canvassing/queries";
import { VanSalesListClient } from "./VanSalesListClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    salesmanId?: string;
    from?: string;
    to?: string;
    page?: string;
    pageSize?: string;
  }>;
};

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];

function parsePageSize(raw: string | undefined): number {
  const n = parseInt(raw ?? "", 10);
  return ALLOWED_PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

function parseDate(raw: string | undefined, endOfDay: boolean): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(`${raw}T${endOfDay ? "23:59:59.999" : "00:00:00"}`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export default async function VanSalesPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.CANVASSING_MANAGE)) redirect("/backoffice");

  const sp = await searchParams;
  const salesmanId = sp.salesmanId?.trim() || undefined;
  const from = parseDate(sp.from, false);
  const to = parseDate(sp.to, true);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = parsePageSize(sp.pageSize);

  const [{ items, totalCount }, canvassers] = await Promise.all([
    listVanSales({ salesmanId, from, to }, { page, pageSize }),
    listCanvassers(),
  ]);

  return (
    <VanSalesListClient
      sales={items}
      totalCount={totalCount}
      salesmen={canvassers.map((c) => ({ id: c.id, label: c.name }))}
      salesmanId={salesmanId ?? ""}
      from={sp.from ?? ""}
      to={sp.to ?? ""}
      page={page}
      pageSize={pageSize}
    />
  );
}
