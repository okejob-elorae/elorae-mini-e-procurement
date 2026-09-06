import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getSettlementForApproval } from "@/lib/finance/ar-settlement/queries";
import { SettlementApprovalClient } from "./SettlementApprovalClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function SettlementApprovalPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.COLLECTIONS_MANAGE)) {
    redirect("/backoffice");
  }

  const { id } = await params;
  const settlement = await getSettlementForApproval(id);
  if (!settlement) notFound();

  return <SettlementApprovalClient settlement={settlement} />;
}
