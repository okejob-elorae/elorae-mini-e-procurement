import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listStores } from "@/lib/stores/queries";
import { listPendingStoreChangeStoreIds } from "@/lib/store-changes/queries";
import { StoreListClient } from "./StoreListClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    search?: string;
    showInactive?: string;
    page?: string;
    pageSize?: string;
  }>;
};

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];

function parsePageSize(raw: string | undefined): number {
  const n = parseInt(raw ?? "", 10);
  return ALLOWED_PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

export default async function StoresPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const search = sp.search?.trim() ?? "";
  const showInactive = sp.showInactive === "1";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = parsePageSize(sp.pageSize);

  const { items, totalCount } = await listStores(
    { activeOnly: !showInactive, search: search || undefined },
    { page, pageSize },
  );

  const pendingSet = await listPendingStoreChangeStoreIds(items.map((s) => s.id));

  return (
    <StoreListClient
      stores={items}
      totalCount={totalCount}
      search={search}
      showInactive={showInactive}
      page={page}
      pageSize={pageSize}
      pendingStoreIds={Array.from(pendingSet)}
    />
  );
}
