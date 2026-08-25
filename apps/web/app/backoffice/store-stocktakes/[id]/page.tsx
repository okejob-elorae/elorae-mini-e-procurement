import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getStoreStocktakeById } from "@/lib/stores/stocktake/queries";
import { StocktakeDetailClient } from "./StocktakeDetailClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function StoreStocktakeDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const stocktake = await getStoreStocktakeById(id);
  if (!stocktake) notFound();

  const canManage = hasPermission(perms, PERMISSIONS.STORES_MANAGE);

  return <StocktakeDetailClient stocktake={stocktake} canManage={canManage} />;
}
