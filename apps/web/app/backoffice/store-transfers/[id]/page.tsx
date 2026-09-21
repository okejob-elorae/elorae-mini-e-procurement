import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getStoreTransferById } from "@/lib/stores/transfer/queries";
import { StoreTransferDetailClient } from "./StoreTransferDetailClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function StoreTransferDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const transfer = await getStoreTransferById(id);
  if (!transfer) notFound();

  const canManage = hasPermission(perms, PERMISSIONS.STORES_MANAGE);

  return <StoreTransferDetailClient transfer={transfer} canManage={canManage} />;
}
