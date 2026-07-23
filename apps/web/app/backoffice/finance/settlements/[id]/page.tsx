import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getSettlementById } from "@/lib/finance/settlement/queries";
import { SettlementDetailClient } from "./SettlementDetailClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function SettlementDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.SETTLEMENTS_VIEW)) {
    redirect("/backoffice");
  }

  const { id } = await params;
  const settlement = await getSettlementById(id);
  if (!settlement) notFound();

  const canManage = hasPermission(permissions, PERMISSIONS.SETTLEMENTS_MANAGE);

  return <SettlementDetailClient settlement={settlement} canManage={canManage} />;
}
