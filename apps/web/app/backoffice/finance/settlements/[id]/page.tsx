import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getSettlementById } from "@/lib/finance/settlement/queries";
import { tandaiSettlementGanda } from "@/lib/finance/settlement/persist";
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

  const p = (await tandaiSettlementGanda([settlement.id]))[settlement.id];
  const ganda = p
    ? { id: p.id, fileName: p.fileName, uploadedAtIso: p.uploadedAt.toISOString(), uploadedByName: p.uploadedByName }
    : null;

  return <SettlementDetailClient settlement={settlement} canManage={canManage} ganda={ganda} />;
}
