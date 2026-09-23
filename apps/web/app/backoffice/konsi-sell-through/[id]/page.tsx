import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getSellThrough } from "@/lib/konsi-sell-through/queries";
import { SellThroughDetailClient } from "./SellThroughDetailClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function SellThroughDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const report = await getSellThrough(id);
  if (!report) notFound();

  const canManage = hasPermission(perms, PERMISSIONS.STORES_MANAGE);

  return <SellThroughDetailClient report={report} canManage={canManage} />;
}
