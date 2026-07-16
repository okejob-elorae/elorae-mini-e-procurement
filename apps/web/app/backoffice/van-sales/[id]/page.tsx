import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getVanSaleById } from "@/lib/canvassing/sale-queries";
import { VanSaleDetailClient } from "./VanSaleDetailClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function VanSaleDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.CANVASSING_MANAGE)) redirect("/backoffice");

  const { id } = await params;
  const sale = await getVanSaleById(id);
  if (!sale) notFound();

  return <VanSaleDetailClient sale={sale} />;
}
