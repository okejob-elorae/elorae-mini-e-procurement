import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listSettlements } from "@/lib/finance/settlement/queries";
import { tandaiSettlementGanda } from "@/lib/finance/settlement/persist";
import type { UnggahanPertamaTampil } from "./ganda";
import { SettlementsPageClient } from "./SettlementsPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ page?: string }>;
};

export default async function SettlementsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.SETTLEMENTS_VIEW)) {
    redirect("/backoffice");
  }

  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = DEFAULT_PAGE_SIZE;

  const { items, totalCount } = await listSettlements({ page, pageSize });
  const canManage = hasPermission(permissions, PERMISSIONS.SETTLEMENTS_MANAGE);

  // Kembaran yang tersimpan sebelum penjaga unggah ganda ada: ditandai di daftar.
  const tanda = await tandaiSettlementGanda(items.map((i) => i.id));
  const ganda: Record<string, UnggahanPertamaTampil> = {};
  for (const [id, p] of Object.entries(tanda)) {
    ganda[id] = { id: p.id, fileName: p.fileName, uploadedAtIso: p.uploadedAt.toISOString(), uploadedByName: p.uploadedByName };
  }

  return (
    <SettlementsPageClient
      items={items}
      totalCount={totalCount}
      page={page}
      pageSize={pageSize}
      canManage={canManage}
      ganda={ganda}
    />
  );
}
