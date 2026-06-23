import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  listJubelioCouriersPaged,
  type CourierSortField,
  type CourierSortDir,
} from "@/app/actions/jubelio-couriers";
import { CouriersPageClient } from "./CouriersPageClient";

export const dynamic = "force-dynamic";

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];
const SORT_FIELDS: CourierSortField[] = ["id", "name", "syncedAt"];
const SORT_DIRS: CourierSortDir[] = ["asc", "desc"];

type PageProps = {
  searchParams: Promise<{
    search?: string;
    sortField?: string;
    sortDir?: string;
    page?: string;
    pageSize?: string;
  }>;
};

function parseSortField(raw: string | undefined): CourierSortField {
  return SORT_FIELDS.includes(raw as CourierSortField) ? (raw as CourierSortField) : "name";
}

function parseSortDir(raw: string | undefined): CourierSortDir {
  return SORT_DIRS.includes(raw as CourierSortDir) ? (raw as CourierSortDir) : "asc";
}

function parsePageSize(raw: string | undefined): number {
  const n = parseInt(raw ?? "", 10);
  return ALLOWED_PAGE_SIZES.includes(n) ? n : 10;
}

export default async function JubelioCouriersPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const sp = await searchParams;
  const search = sp.search?.trim() || undefined;
  const sortField = parseSortField(sp.sortField);
  const sortDir = parseSortDir(sp.sortDir);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = parsePageSize(sp.pageSize);

  const { couriers, totalCount } = await listJubelioCouriersPaged({
    search,
    sortField,
    sortDir,
    page,
    pageSize,
  });

  return (
    <CouriersPageClient
      couriers={couriers}
      totalCount={totalCount}
      search={search ?? ""}
      sortField={sortField}
      sortDir={sortDir}
      page={page}
      pageSize={pageSize}
    />
  );
}
