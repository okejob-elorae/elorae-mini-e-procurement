import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { prisma } from "@elorae/db";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listStores, parseStoreLocationFilter, parseStoreNpwpFilter } from "@/lib/stores/queries";
import { listPendingStoreChangeStoreIds } from "@/lib/store-changes/queries";
import { parseRadiusSetting, resolveEffectiveRadius } from "@/lib/pwa/checkin-radius";
import { StoreListClient } from "./StoreListClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    search?: string;
    showInactive?: string;
    location?: string;
    npwp?: string;
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
  const location = parseStoreLocationFilter(sp.location);
  const npwpFilter = parseStoreNpwpFilter(sp.npwp);

  const [{ items, totalCount }, globalRadiusRow] = await Promise.all([
    listStores(
      { activeOnly: !showInactive, search: search || undefined, location, npwp: npwpFilter },
      { page, pageSize },
    ),
    prisma.systemSetting.findUnique({ where: { key: "checkin.radiusMeters" } }),
  ]);
  const globalRadius = parseRadiusSetting(globalRadiusRow?.value);
  const radiusByStoreId: Record<string, { meters: number; custom: boolean } | null> = {};
  for (const s of items) {
    radiusByStoreId[s.id] =
      s.lat === null || s.lng === null
        ? null
        : {
            meters: resolveEffectiveRadius(s.checkinRadiusMeters, globalRadius),
            custom: s.checkinRadiusMeters !== null,
          };
  }

  const pendingSet = await listPendingStoreChangeStoreIds(items.map((s) => s.id));

  return (
    <StoreListClient
      stores={items}
      totalCount={totalCount}
      search={search}
      showInactive={showInactive}
      location={location ?? ""}
      npwp={npwpFilter ?? ""}
      radiusByStoreId={radiusByStoreId}
      page={page}
      pageSize={pageSize}
      pendingStoreIds={Array.from(pendingSet)}
    />
  );
}
