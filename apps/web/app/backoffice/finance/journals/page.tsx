import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { listJournals } from "@/lib/finance/journals/queries";
import { JournalsPageClient } from "./JournalsPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    page?: string;
    from?: string;
    to?: string;
    source?: string;
    q?: string;
  }>;
};

export default async function JournalsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.JOURNALS_VIEW)) {
    redirect("/backoffice");
  }

  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = DEFAULT_PAGE_SIZE;

  const manualOnly = sp.source === "manual";
  const search = sp.q?.trim() || undefined;

  const { items, totalCount } = await listJournals(
    {
      from: parseDateOnly(sp.from ?? ""),
      to: parseDateOnlyEnd(sp.to ?? ""),
      manualOnly,
      search,
    },
    { page, pageSize },
  );

  const canManage = hasPermission(permissions, PERMISSIONS.JOURNALS_MANAGE);

  return (
    <JournalsPageClient
      items={items}
      totalCount={totalCount}
      page={page}
      pageSize={pageSize}
      canManage={canManage}
      filters={{
        from: sp.from ?? "",
        to: sp.to ?? "",
        source: sp.source ?? "",
        q: sp.q ?? "",
      }}
    />
  );
}
