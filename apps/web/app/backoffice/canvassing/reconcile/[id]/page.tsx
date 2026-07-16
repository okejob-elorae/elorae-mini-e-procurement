import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getVanReconcileById } from "@/lib/canvassing/reconcile-queries";
import { ReconcileDetailClient } from "./ReconcileDetailClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function VanReconcileDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.CANVASSING_MANAGE)) redirect("/backoffice");

  const { id } = await params;
  const reconcile = await getVanReconcileById(id);
  if (!reconcile) notFound();

  return <ReconcileDetailClient reconcile={reconcile} />;
}
