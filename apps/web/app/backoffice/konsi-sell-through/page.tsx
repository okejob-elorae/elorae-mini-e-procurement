import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listSellThroughs, type SellThroughStatusValue } from "@/lib/konsi-sell-through/queries";
import { listStoreOptions } from "@/lib/stores/queries";
import { SellThroughPageClient } from "./SellThroughPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    storeId?: string;
    status?: string;
    page?: string;
    pageSize?: string;
  }>;
};

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];
const STATUS_VALUES: ReadonlySet<string> = new Set(["DRAFT", "APPROVED", "CANCELLED"]);

function parsePageSize(raw: string | undefined): number {
  const n = parseInt(raw ?? "", 10);
  return ALLOWED_PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

function parseStatus(raw: string | undefined): SellThroughStatusValue | undefined {
  return raw && STATUS_VALUES.has(raw) ? (raw as SellThroughStatusValue) : undefined;
}

export default async function KonsiSellThroughPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const storeId = sp.storeId?.trim() || undefined;
  const status = parseStatus(sp.status);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = parsePageSize(sp.pageSize);

  const [{ items, total }, storeOptions] = await Promise.all([
    listSellThroughs({ storeId, status, page, pageSize }),
    listStoreOptions(),
  ]);

  return (
    <SellThroughPageClient
      items={items}
      total={total}
      storeOptions={storeOptions}
      storeId={storeId ?? ""}
      status={status ?? ""}
      page={page}
      pageSize={pageSize}
    />
  );
}
